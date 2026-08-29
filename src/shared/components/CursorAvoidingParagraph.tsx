// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  layoutNextLine,
  type PreparedTextWithSegments,
  prepareWithSegments,
} from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  type PreparedRichInline,
  prepareRichInline,
} from "@chenglou/pretext/rich-inline";
import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePrefersReducedMotion } from "./motion/usePrefersReducedMotion";

type Point = { x: number; y: number };

type CursorAvoidanceRegion = {
  left: number;
  width: number;
};

type CursorAvoidanceSegment = CursorAvoidanceRegion & {
  text: string;
};

type CursorAvoidanceLine = {
  segments: CursorAvoidanceSegment[];
  text: string;
};

type PreparedPreformattedLine = {
  prepared: PreparedTextWithSegments;
  text: string;
};

type InlineLeaf = {
  render: (text: string, key: string) => ReactNode;
  text: string;
};

type CursorAvoidingTag =
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "li"
  | "p"
  | "pre"
  | "td"
  | "th";

type RichCursorFragment = {
  itemIndex: number;
  left: number;
  text: string;
};

type RichCursorSegment = CursorAvoidanceRegion & {
  fragments: RichCursorFragment[];
};

type RichCursorLine = {
  segments: RichCursorSegment[];
  text: string;
};

const DEFAULT_RADIUS = 48;
const MINIMUM_USABLE_WIDTH = 72;

function cursorAvoidanceRegions(
  containerWidth: number,
  lineTop: number,
  lineHeight: number,
  point: Point,
  radius = DEFAULT_RADIUS,
): CursorAvoidanceRegion[] {
  const width = Math.max(1, containerWidth);
  const distanceFromLine = Math.abs(point.y - (lineTop + lineHeight / 2));
  if (distanceFromLine >= radius) return [{ left: 0, width }];

  const halfChord = Math.sqrt(Math.max(0, radius ** 2 - distanceFromLine ** 2));
  const gap = 8;
  const leftEnd = Math.max(0, Math.min(width, point.x - halfChord - gap));
  const rightStart = Math.max(0, Math.min(width, point.x + halfChord + gap));
  const regions = [
    { left: 0, width: leftEnd },
    { left: rightStart, width: width - rightStart },
  ].filter((region) => region.width >= MINIMUM_USABLE_WIDTH);

  // Em uma coluna estreita nenhum dos lados pode comportar uma palavra
  // razoável; nesse caso o texto mantém a largura total e continua legível.
  if (regions.length === 0) return [{ left: 0, width }];

  // Se só um lado é utilizável, não force uma coluna estreita com palavras
  // quebradas. Quando os dois lados cabem, preserve ambos em ordem horizontal
  // para que o cursor do Pretext faça a transferência no mesmo baseline.
  return regions;
}

/** Retorna o maior lado livre para manter compatibilidade com consumidores simples. */
export function cursorAvoidanceRegion(
  containerWidth: number,
  lineTop: number,
  lineHeight: number,
  point: Point,
  radius = DEFAULT_RADIUS,
): CursorAvoidanceRegion {
  const regions = cursorAvoidanceRegions(containerWidth, lineTop, lineHeight, point, radius);
  const [firstRegion, ...remainingRegions] = regions;
  return remainingRegions.reduce(
    (largest, region) => (region.width > largest.width ? region : largest),
    firstRegion ?? { left: 0, width: Math.max(1, containerWidth) },
  );
}

export function layoutCursorAvoidance(
  prepared: PreparedTextWithSegments,
  containerWidth: number,
  lineHeight: number,
  point: Point,
): CursorAvoidanceLine[] {
  const lines: CursorAvoidanceLine[] = [];
  const safeWidth = Math.max(1, containerWidth);
  const safeLineHeight = Math.max(1, lineHeight);
  let cursor = { graphemeIndex: 0, segmentIndex: 0 };
  let lineTop = 0;

  for (let index = 0; index < 1000; index += 1) {
    const segments: CursorAvoidanceSegment[] = [];
    let consumedText = "";
    let madeProgress = false;

    // Cada região recebe a continuação do mesmo cursor. Assim, quando a
    // circunferência corta uma linha, o texto ocupa primeiro a esquerda e
    // imediatamente continua na direita, sem duplicar nem descartar palavras.
    for (const region of cursorAvoidanceRegions(safeWidth, lineTop, safeLineHeight, point)) {
      const line = layoutNextLine(prepared, cursor, region.width);
      if (!line) break;

      const cursorAdvanced =
        line.end.segmentIndex !== cursor.segmentIndex ||
        line.end.graphemeIndex !== cursor.graphemeIndex;
      if (!cursorAdvanced) continue;

      segments.push({ ...region, text: line.text });
      consumedText += line.text;
      cursor = line.end;
      madeProgress = true;
    }

    if (!madeProgress) break;
    lines.push({ segments, text: consumedText });
    lineTop += safeLineHeight;
  }
  return lines;
}

/**
 * O cursor de texto do Pretext trabalha em uma linha física de cada vez.
 * Quebras explícitas do Markdown, portanto, são mantidas como fronteiras de
 * layout antes de aplicar as regiões variáveis do cursor.
 */
export function layoutPreformattedCursorAvoidance(
  preparedLines: PreparedPreformattedLine[],
  containerWidth: number,
  lineHeight: number,
  point: Point,
): CursorAvoidanceLine[] {
  const lines: CursorAvoidanceLine[] = [];
  const safeWidth = Math.max(1, containerWidth);
  const safeLineHeight = Math.max(1, lineHeight);
  let lineTop = 0;

  for (const preparedLine of preparedLines) {
    if (preparedLine.text.length === 0) {
      lines.push({ segments: [{ left: 0, text: "", width: safeWidth }], text: "" });
      lineTop += safeLineHeight;
      continue;
    }

    let cursor = { graphemeIndex: 0, segmentIndex: 0 };
    for (let index = 0; index < 1000; index += 1) {
      const segments: CursorAvoidanceSegment[] = [];
      let consumedText = "";
      let madeProgress = false;

      for (const region of cursorAvoidanceRegions(safeWidth, lineTop, safeLineHeight, point)) {
        const line = layoutNextLine(preparedLine.prepared, cursor, region.width);
        if (!line) break;
        const cursorAdvanced =
          line.end.segmentIndex !== cursor.segmentIndex ||
          line.end.graphemeIndex !== cursor.graphemeIndex;
        if (!cursorAdvanced) continue;

        segments.push({ ...region, text: line.text });
        consumedText += line.text;
        cursor = line.end;
        madeProgress = true;
      }

      if (!madeProgress) break;
      lines.push({ segments, text: consumedText });
      lineTop += safeLineHeight;
    }
  }
  return lines;
}

/**
 * Todo elemento inline do ReactMarkdown entra no fluxo: links, spans de
 * código e botões locais preservam seus próprios atributos ao serem clonados
 * para cada fragmento do Pretext. Só estruturas de bloco impedem o fluxo do
 * pai, pois recebem seu próprio CursorAvoidingParagraph.
 */
function inlineLeavesFromChildren(children: ReactNode): InlineLeaf[] | null {
  if (typeof children === "string" || typeof children === "number") {
    return [{ render: (text) => text, text: String(children) }];
  }
  if (Array.isArray(children)) {
    const leaves: InlineLeaf[] = [];
    for (const child of children) {
      const nested = inlineLeavesFromChildren(child);
      if (nested === null) return null;
      leaves.push(...nested);
    }
    return leaves;
  }
  if (!isValidElement<{ children?: ReactNode }>(children)) return null;
  if (children.type === Fragment) return inlineLeavesFromChildren(children.props.children);
  if (
    typeof children.type === "string" &&
    [
      "blockquote",
      "div",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "hr",
      "img",
      "li",
      "ol",
      "p",
      "pre",
      "table",
      "tbody",
      "td",
      "th",
      "thead",
      "tr",
      "ul",
    ].includes(children.type)
  ) {
    return null;
  }
  if (children.type === "br") return null;

  const nested = inlineLeavesFromChildren(children.props.children);
  if (nested === null) return null;
  return nested.map((leaf) => ({
    render: (text, key) => cloneElement(children, { key }, leaf.render(text, key)),
    text: leaf.text,
  }));
}

function textFromChildren(children: ReactNode): string | null {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) {
    const parts: string[] = [];
    for (const child of children) {
      const text = textFromChildren(child);
      if (text === null) return null;
      parts.push(text);
    }
    return parts.join("");
  }
  if (!isValidElement<{ children?: ReactNode }>(children)) return null;
  if (children.type === Fragment) return textFromChildren(children.props.children);
  if (children.type === "br") return "\n";
  if (typeof children.type !== "string" || children.type === "img" || children.type === "hr") {
    return null;
  }
  return textFromChildren(children.props.children);
}

function hasForcedLineBreak(children: ReactNode): boolean {
  if (Array.isArray(children)) return children.some(hasForcedLineBreak);
  if (!isValidElement<{ children?: ReactNode }>(children)) return false;
  if (children.type === "br") return true;
  return hasForcedLineBreak(children.props.children);
}

function textNodesIn(element: HTMLElement): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function fontFromStyles(styles: CSSStyleDeclaration): string {
  return `${styles.fontStyle} ${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
}

function letterSpacingFromStyles(styles: CSSStyleDeclaration): number {
  const letterSpacing = Number.parseFloat(styles.letterSpacing);
  return Number.isFinite(letterSpacing) ? letterSpacing : 0;
}

/** Layout manual de fragmentos Markdown inline, com cursor contínuo por região. */
export function layoutRichCursorAvoidance(
  prepared: PreparedRichInline,
  containerWidth: number,
  lineHeight: number,
  point: Point,
): RichCursorLine[] {
  const lines: RichCursorLine[] = [];
  const safeWidth = Math.max(1, containerWidth);
  const safeLineHeight = Math.max(1, lineHeight);
  let cursor = { graphemeIndex: 0, itemIndex: 0, segmentIndex: 0 };
  let lineTop = 0;

  for (let index = 0; index < 1000; index += 1) {
    const segments: RichCursorSegment[] = [];
    let text = "";
    let madeProgress = false;

    for (const region of cursorAvoidanceRegions(safeWidth, lineTop, safeLineHeight, point)) {
      const range = layoutNextRichInlineLineRange(prepared, region.width, cursor);
      if (!range) break;
      const line = materializeRichInlineLineRange(prepared, range);
      const cursorAdvanced =
        line.end.itemIndex !== cursor.itemIndex ||
        line.end.segmentIndex !== cursor.segmentIndex ||
        line.end.graphemeIndex !== cursor.graphemeIndex;
      if (!cursorAdvanced) continue;

      let fragmentLeft = region.left;
      const fragments = line.fragments.map((fragment) => {
        fragmentLeft += fragment.gapBefore;
        const result = { itemIndex: fragment.itemIndex, left: fragmentLeft, text: fragment.text };
        fragmentLeft += fragment.occupiedWidth;
        return result;
      });
      segments.push({ ...region, fragments });
      text += line.fragments.map((fragment) => fragment.text).join("");
      cursor = line.end;
      madeProgress = true;
    }

    if (!madeProgress) break;
    lines.push({ segments, text });
    lineTop += safeLineHeight;
  }
  return lines;
}

type CursorAvoidingParagraphProps = {
  as?: CursorAvoidingTag;
  children?: ReactNode;
  className?: string;
  enabled?: boolean;
  preformatted?: boolean;
  streaming?: boolean;
};

/**
 * Reorganiza cada bloco textual do Markdown durante o hover. O conteúdo de
 * fallback permanece montado, portanto cópia, links e semântica voltam ao
 * browser no instante em que o cursor sai do bloco.
 */
export function CursorAvoidingParagraph({
  as = "p",
  children,
  className,
  enabled = false,
  preformatted = false,
  streaming = false,
}: CursorAvoidingParagraphProps) {
  const forcedLineBreak = useMemo(() => hasForcedLineBreak(children), [children]);
  const inlineLeaves = useMemo(() => inlineLeavesFromChildren(children), [children]);
  const plainText = useMemo(() => textFromChildren(children), [children]);
  const usePreformattedFlow = preformatted || forcedLineBreak;
  const text = usePreformattedFlow
    ? plainText
    : (inlineLeaves?.map((leaf) => leaf.text).join("") ?? null);
  const reducedMotion = usePrefersReducedMotion();
  const elementRef = useRef<HTMLElement | null>(null);
  const pointerRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [measurement, setMeasurement] = useState<
    | {
        kind: "plain";
        lineHeight: number;
        preparedLines: PreparedPreformattedLine[];
        width: number;
      }
    | {
        kind: "rich";
        leaves: InlineLeaf[];
        lineHeight: number;
        prepared: PreparedRichInline;
        width: number;
      }
    | null
  >(null);

  const active = Boolean(text?.trim()) && enabled && !streaming && !reducedMotion;

  useEffect(() => {
    if (!active || !elementRef.current || typeof document === "undefined") {
      setMeasurement(null);
      setPointer(null);
      pointerRef.current = null;
      return;
    }
    const element = elementRef.current;
    const styles = window.getComputedStyle(element);
    const fontSize = Number.parseFloat(styles.fontSize) || 14;
    const lineHeight = Number.parseFloat(styles.lineHeight) || fontSize * 1.5;
    try {
      if (usePreformattedFlow) {
        if (plainText === null) {
          setMeasurement(null);
          return;
        }
        const font = fontFromStyles(styles);
        const letterSpacing = letterSpacingFromStyles(styles);
        const preparedLines = plainText.split("\n").map((text) => ({
          prepared: prepareWithSegments(text, font, { letterSpacing, whiteSpace: "pre-wrap" }),
          text,
        }));
        const measure = () => {
          const width = element.getBoundingClientRect().width;
          setMeasurement({ kind: "plain", lineHeight, preparedLines, width });
        };
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
      }

      const leaves = inlineLeaves;
      if (!leaves) {
        setMeasurement(null);
        return;
      }
      const textNodes = textNodesIn(element);
      if (textNodes.length !== leaves.length) {
        setMeasurement(null);
        return;
      }
      const prepared = prepareRichInline(
        leaves.map((leaf, index) => {
          const parent = textNodes[index]?.parentElement ?? element;
          const textStyles = window.getComputedStyle(parent);
          return {
            font: fontFromStyles(textStyles),
            letterSpacing: letterSpacingFromStyles(textStyles),
            text: leaf.text,
          };
        }),
      );
      const measure = () => {
        const width = element.getBoundingClientRect().width;
        setMeasurement({ kind: "rich", leaves, lineHeight, prepared, width });
      };
      measure();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    } catch {
      // SSR, WebView antigo ou Canvas indisponível: a prosa normal continua
      // sendo o fallback seguro e acessível.
      setMeasurement(null);
      return;
    }
  }, [active, inlineLeaves, plainText, usePreformattedFlow]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!active || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setPointer(pointerRef.current);
    });
  }

  const clearPointer = useCallback(() => {
    pointerRef.current = null;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    setPointer(null);
  }, []);

  function onPointerLeave() {
    clearPointer();
  }

  // Alguns WebViews não emitem pointerleave quando o conteúdo absoluto muda
  // sob o cursor. A verificação no documento encerra o estado assim que o
  // ponteiro realmente sai da caixa do bloco, sem esperar outro hover.
  useEffect(() => {
    if (!active || !pointer || typeof window === "undefined") return;
    const clearOutsideElement = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const bounds = elementRef.current?.getBoundingClientRect();
      if (
        !bounds ||
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        clearPointer();
      }
    };
    window.addEventListener("blur", clearPointer);
    document.addEventListener("pointermove", clearOutsideElement, true);
    return () => {
      window.removeEventListener("blur", clearPointer);
      document.removeEventListener("pointermove", clearOutsideElement, true);
    };
  }, [active, clearPointer, pointer]);

  const rootProps = {
    className,
    onPointerLeave: active ? onPointerLeave : undefined,
    onPointerMove: active ? onPointerMove : undefined,
    ref: elementRef,
  };

  if (!text || !measurement || !pointer || !active || measurement.width <= 0) {
    return createElement(as, rootProps, children);
  }

  if (measurement.kind === "plain") {
    const lines = layoutPreformattedCursorAvoidance(
      measurement.preparedLines,
      measurement.width,
      measurement.lineHeight,
      pointer,
    );
    if (lines.length === 0) return createElement(as, rootProps, children);
    return createElement(
      as,
      rootProps,
      <>
        <span className="block select-text">
          {lines.map((line) => (
            <span
              className="block"
              key={`${line.segments[0]?.left}-${line.text}`}
              style={{ height: `${measurement.lineHeight}px`, position: "relative" }}
            >
              {line.segments.map((segment) => (
                <span
                  className="absolute top-0 whitespace-pre-wrap"
                  key={`${segment.left}-${segment.text}`}
                  style={{ left: `${segment.left}px` }}
                >
                  {segment.text}
                </span>
              ))}
            </span>
          ))}
        </span>
        <span aria-hidden="true" className="sr-only">
          {children}
        </span>
      </>,
    );
  }

  const lines = layoutRichCursorAvoidance(
    measurement.prepared,
    measurement.width,
    measurement.lineHeight,
    pointer,
  );
  if (lines.length === 0) return createElement(as, rootProps, children);

  return createElement(
    as,
    rootProps,
    <>
      <span className="block select-text">
        {lines.map((line) => (
          <span
            className="block"
            key={`${line.segments[0]?.left}-${line.text}`}
            style={{ height: `${measurement.lineHeight}px`, position: "relative" }}
          >
            {line.segments.flatMap((segment) =>
              segment.fragments.map((fragment) => (
                <span
                  className="absolute top-0 whitespace-pre"
                  key={`${fragment.itemIndex}-${fragment.left}-${fragment.text}`}
                  style={{ left: `${fragment.left}px` }}
                >
                  {measurement.leaves[fragment.itemIndex]?.render(
                    fragment.text,
                    `${fragment.itemIndex}-${fragment.left}-${fragment.text}`,
                  )}
                </span>
              )),
            )}
          </span>
        ))}
      </span>
      <span aria-hidden="true" className="sr-only">
        {children}
      </span>
    </>,
  );
}

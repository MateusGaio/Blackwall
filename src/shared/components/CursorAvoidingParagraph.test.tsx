// MIT License — Copyright (c) 2026 Mateus Gaio

import { clearCache, prepareWithSegments } from "@chenglou/pretext";
import { prepareRichInline } from "@chenglou/pretext/rich-inline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cursorAvoidanceRegion,
  layoutCursorAvoidance,
  layoutPreformattedCursorAvoidance,
  layoutRichCursorAvoidance,
} from "./CursorAvoidingParagraph";

beforeEach(() => {
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      getContext() {
        return {
          font: "",
          measureText: (text: string) => ({ width: text.length * 8 }),
        };
      }
    },
  );
});

afterEach(() => {
  clearCache();
  vi.unstubAllGlobals();
});

describe("cursor text avoidance", () => {
  it("routes a line to the side with more room around the cursor", () => {
    const region = cursorAvoidanceRegion(640, 0, 24, { x: 520, y: 12 });

    expect(region.left).toBe(0);
    expect(region.width).toBeLessThan(640);
  });

  it("keeps the full width when the cursor is outside the line", () => {
    expect(cursorAvoidanceRegion(320, 0, 24, { x: 160, y: 100 })).toEqual({
      left: 0,
      width: 320,
    });
  });

  it("lays out prose with Pretext and keeps all source text", () => {
    const prepared = prepareWithSegments("one two three four", "14px sans-serif");
    const lines = layoutCursorAvoidance(prepared, 80, 20, { x: 10, y: 100 });

    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((line) => line.text).join("")).toBe("one two three four");
  });

  it("preserves explicit Markdown line breaks in pre-wrap blocks", () => {
    const lines = layoutPreformattedCursorAvoidance(
      ["linha um", "  linha dois"].map((text) => ({
        prepared: prepareWithSegments(text, "14px monospace", { whiteSpace: "pre-wrap" }),
        text,
      })),
      320,
      20,
      { x: 10, y: 100 },
    );

    expect(lines.map((line) => line.text)).toEqual(["linha um", "  linha dois"]);
  });

  it("continues on the right side of the same baseline", () => {
    const prepared = prepareWithSegments(
      "one two three four five six seven eight nine ten",
      "14px sans-serif",
    );
    const lines = layoutCursorAvoidance(prepared, 320, 20, { x: 160, y: 10 });
    const splitLine = lines.find((line) => line.segments.length === 2);

    expect(splitLine).toBeDefined();
    expect(splitLine?.segments[0]?.left).toBeLessThan(splitLine?.segments[1]?.left ?? 0);
    expect(lines.map((line) => line.text).join("")).toBe(
      "one two three four five six seven eight nine ten",
    );
  });

  it("keeps formatted Markdown fragments in the Pretext cursor flow", () => {
    const prepared = prepareRichInline([
      { font: "14px sans-serif", text: "Texto " },
      { font: "700 14px sans-serif", text: "forte" },
      { font: "14px sans-serif", text: " continua normalmente." },
    ]);
    const lines = layoutRichCursorAvoidance(prepared, 260, 20, { x: 130, y: 10 });

    expect(lines.some((line) => line.segments.length === 2)).toBe(true);
    expect(lines.flatMap((line) => line.segments).flatMap((segment) => segment.fragments)).toEqual(
      expect.arrayContaining([expect.objectContaining({ itemIndex: 1, text: "forte" })]),
    );
  });

  it("keeps link and inline-code fragments in the same Markdown flow", () => {
    const prepared = prepareRichInline([
      { font: "14px sans-serif", text: "Leia " },
      { break: "never", extraWidth: 8, font: "14px sans-serif", text: "documentação" },
      { font: "14px sans-serif", text: " e use " },
      { break: "never", extraWidth: 8, font: "12px monospace", text: "layoutNextLine" },
      { font: "14px sans-serif", text: "." },
    ]);
    const lines = layoutRichCursorAvoidance(prepared, 360, 20, { x: 180, y: 10 });

    expect(lines.flatMap((line) => line.segments).flatMap((segment) => segment.fragments)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemIndex: 1, text: "documentação" }),
        expect.objectContaining({ itemIndex: 3, text: "layoutNextLine" }),
      ]),
    );
  });
});

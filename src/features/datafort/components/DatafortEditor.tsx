// MIT License — Copyright (c) 2026 Mateus Gaio
import { autocompletion, type CompletionSource, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { useEffect, useRef } from "react";

type DatafortEditorProps = {
  fileId: string;
  initialContent: string;
  mode: "live" | "source";
  onChange: (content: string) => void;
  onSave: () => void;
  onAttachment?: (file: File) => Promise<string | null>;
  completionSource?: CompletionSource;
  readOnly?: boolean;
};

const hiddenMarkup = Decoration.mark({ class: "cm-datafort-markup-hidden" });

function markupDecorations(view: EditorView) {
  const ranges: Array<{ from: number; to: number }> = [];
  for (const visible of view.visibleRanges) {
    const text = view.state.sliceDoc(visible.from, visible.to);
    for (const match of text.matchAll(/(^|\n)(\s{0,3}#{1,6}\s)|\*\*|__|~~|==|\[\[|\]\]/g)) {
      const start = visible.from + (match.index ?? 0) + (match[1]?.length ?? 0);
      const token = match[2] ?? match[0];
      ranges.push({ from: start, to: start + token.length });
    }
  }
  ranges.sort((left, right) => left.from - right.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) builder.add(range.from, range.to, hiddenMarkup);
  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: ReturnType<typeof markupDecorations>;

    constructor(private readonly view: EditorView) {
      this.decorations = markupDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = markupDecorations(this.view);
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * Adapter isolado do CodeMirror. O documento inteiro vive no EditorState;
 * React recebe apenas um sinal de alteração para agendar o autosave.
 */
export function DatafortEditor({
  fileId,
  initialContent,
  mode,
  onChange,
  onSave,
  onAttachment,
  completionSource,
  readOnly = false,
}: DatafortEditorProps) {
  const hostRef = useRef<HTMLElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacksRef = useRef({ onAttachment, onChange, onSave, completionSource });
  const configRef = useRef({ initialContent, mode, readOnly });
  const livePreviewRef = useRef(new Compartment());
  callbacksRef.current = { onAttachment, onChange, onSave, completionSource };
  configRef.current = { initialContent, mode, readOnly };

  useEffect(() => {
    if (!hostRef.current) return;
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) callbacksRef.current.onChange(update.state.doc.toString());
    });
    const fileFromEvent = (event: ClipboardEvent | DragEvent) => {
      const files =
        "clipboardData" in event ? event.clipboardData?.files : event.dataTransfer?.files;
      const file = files?.[0];
      if (!file) return null;
      const extension = file.name.slice(file.name.lastIndexOf(".")).toLocaleLowerCase();
      return file.type.startsWith("image/") ||
        file.type.startsWith("audio/") ||
        file.type.startsWith("video/") ||
        extension === ".pdf" ||
        extension === ".md" ||
        file.type.startsWith("text/")
        ? file
        : null;
    };
    const attachmentHandlers = EditorView.domEventHandlers({
      drop: (event, view) => {
        const file = fileFromEvent(event);
        if (!file || !callbacksRef.current.onAttachment) return false;
        event.preventDefault();
        void callbacksRef.current.onAttachment(file).then((link) => {
          if (link) view.dispatch(view.state.replaceSelection(link));
        });
        return true;
      },
      paste: (event, view) => {
        const file = fileFromEvent(event);
        if (!file || !callbacksRef.current.onAttachment) return false;
        event.preventDefault();
        void callbacksRef.current.onAttachment(file).then((link) => {
          if (link) view.dispatch(view.state.replaceSelection(link));
        });
        return true;
      },
    });
    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        run: () => {
          callbacksRef.current.onSave();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...completionKeymap,
      indentWithTab,
    ]);
    const state = EditorState.create({
      doc: configRef.current.initialContent,
      extensions: [
        lineNumbers(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        markdown(),
        livePreviewRef.current.of(configRef.current.mode === "live" ? livePreviewPlugin : []),
        autocompletion({
          activateOnTyping: true,
          override: callbacksRef.current.completionSource
            ? [callbacksRef.current.completionSource]
            : undefined,
        }),
        attachmentHandlers,
        saveKeymap,
        updateListener,
        EditorView.editable.of(!configRef.current.readOnly),
        EditorState.readOnly.of(configRef.current.readOnly),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { fontFamily: "inherit", overflow: "auto", padding: "1rem 0" },
          ".cm-content": { minHeight: "100%", padding: "0 1.25rem 3rem" },
          ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#66666f" },
          ".cm-line": { padding: "0" },
          ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.025)" },
          ".cm-activeLineGutter": { backgroundColor: "transparent" },
          ".cm-selectionBackground, ::selection": { backgroundColor: "rgba(255,255,255,0.16)" },
        }),
      ],
    });
    const view = new EditorView({ parent: hostRef.current, state });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: livePreviewRef.current.reconfigure(mode === "live" ? livePreviewPlugin : []),
    });
  }, [mode]);

  return (
    <section
      aria-label={mode === "source" ? "Editor Markdown fonte" : "Editor Markdown Live Preview"}
      className="datafort-editor h-full min-h-0"
      data-editor-mode={mode}
      data-file-id={fileId}
      ref={hostRef}
    />
  );
}

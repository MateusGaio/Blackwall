// MIT License — Copyright (c) 2026 Mateus Gaio
type CompactIconKind =
  | "clip"
  | "close"
  | "copy"
  | "edit"
  | "files"
  | "graph"
  | "maximize"
  | "minimize"
  | "new-thread"
  | "panel"
  | "panel-right"
  | "providers"
  | "refresh"
  | "search"
  | "send"
  | "settings"
  | "stop"
  | "chevron";

const paths = {
  chevron: <path d="m6 9 6 6 6-6" />,
  clip: (
    <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  copy: <path d="M9 9h11v11H9V9ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />,
  files: <path d="M5 4h9l4 4v12H5V4Zm9 0v4h4M8 13h8M8 17h6" />,
  graph: (
    <path d="m7 6 5 3 5-3M7 18l5-3 5 3M12 9v6M5 5h4v4H5V5Zm10 0h4v4h-4V5ZM5 15h4v4H5v-4Zm10 0h4v4h-4v-4Z" />
  ),
  maximize: <rect height="12" rx="1.5" width="12" x="6" y="6" />,
  minimize: <path d="M5 12h14" />,
  "new-thread": <path d="M12 5v14M5 12h14" />,
  panel: <path d="M4 5h16v14H4V5Zm5 0v14M12 9l3 3-3 3" />,
  "panel-right": <path d="M4 5h16v14H4V5Zm15 0v14M12 9l3 3-3 3" />,
  providers: (
    <path d="M5 4h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm0 9h14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1Zm2.5-7h.01M7.5 17h.01" />
  ),
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5" />,
  search: <path d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  settings: (
    <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-5.3 1 2.3 2.4.5 1.9-1.5 1.7 1.7-1.5 1.9.5 2.4 2.3 1v2.4l-2.3 1-.5 2.4 1.5 1.9-1.7 1.7-1.9-1.5-2.4.5-1 2.3h-2.4l-1-2.3-2.4-.5-1.9 1.5-1.7-1.7 1.5-1.9-.5-2.4-2.3-1v-2.4l2.3-1 .5-2.4-1.5-1.9 1.7-1.7 1.9 1.5 2.4-.5 1-2.3H12Z" />
  ),
  stop: <rect height="10" rx="1" width="10" x="7" y="7" />,
} as const;

export function CompactIcon({ kind }: { kind: CompactIconKind }) {
  return (
    // Autocontido: sem os atributos de apresentação o SVG usa fill preto
    // padrão do navegador e some no tema OLED (e sem dimensão vira gigante).
    // `currentColor` herda a cor do controle; o tamanho padrão é 16px e as
    // regras escopadas (.workspace-header-trigger svg etc.) continuam valendo.
    <svg
      aria-hidden="true"
      className="size-4 shrink-0"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {paths[kind]}
    </svg>
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio
type CompactIconKind =
  | "clip"
  | "copy"
  | "edit"
  | "files"
  | "graph"
  | "new-thread"
  | "panel"
  | "recent"
  | "refresh"
  | "send"
  | "settings"
  | "stop"
  | "workspace"
  | "chevron";

const paths = {
  chevron: <path d="m6 9 6 6 6-6" />,
  clip: (
    <path d="m21.4 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  ),
  copy: <path d="M9 9h11v11H9V9ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />,
  edit: <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3Z" />,
  files: <path d="M5 4h9l4 4v12H5V4Zm9 0v4h4M8 13h8M8 17h6" />,
  graph: (
    <path d="m7 6 5 3 5-3M7 18l5-3 5 3M12 9v6M5 5h4v4H5V5Zm10 0h4v4h-4V5ZM5 15h4v4H5v-4Zm10 0h4v4h-4v-4Z" />
  ),
  "new-thread": <path d="M12 5v14M5 12h14" />,
  panel: <path d="M4 5h16v14H4V5Zm5 0v14M12 9l3 3-3 3" />,
  recent: <path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6M4 4v4.6h4.6M12 7v5l3.5 2" />,
  refresh: <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v5h-5" />,
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  settings: (
    <path d="M12 8.3a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0-5.3 1 2.3 2.4.5 1.9-1.5 1.7 1.7-1.5 1.9.5 2.4 2.3 1v2.4l-2.3 1-.5 2.4 1.5 1.9-1.7 1.7-1.9-1.5-2.4.5-1 2.3h-2.4l-1-2.3-2.4-.5-1.9 1.5-1.7-1.7 1.5-1.9-.5-2.4-2.3-1v-2.4l2.3-1 .5-2.4-1.5-1.9 1.7-1.7 1.9 1.5 2.4-.5 1-2.3H12Z" />
  ),
  stop: <rect height="10" rx="1" width="10" x="7" y="7" />,
  workspace: <path d="M3.5 7.5h6l1.8 2H20.5v9.8H3.5V7.5Zm0 0V5h6l1.8 2.5" />,
} as const;

export function CompactIcon({ kind }: { kind: CompactIconKind }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[kind]}
    </svg>
  );
}

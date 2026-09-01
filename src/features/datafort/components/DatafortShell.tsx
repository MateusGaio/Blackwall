// MIT License — Copyright (c) 2026 Mateus Gaio

import type { Completion, CompletionContext, CompletionSource } from "@codemirror/autocomplete";
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Eye,
  FileAudio,
  FileImage,
  Files,
  FileText,
  Folder,
  FolderOpen,
  LayoutTemplate,
  Link2,
  ListTree,
  Network,
  PanelRight,
  Paperclip,
  Plus,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Split,
  Star,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  createDatafortDocument,
  type DatafortDocument,
  type DatafortSettings,
  type DatafortTrashEntry,
  type DatafortTreeEntry,
  deleteDatafortDraft,
  deleteDatafortEntry,
  getDatafortAttachmentContent,
  getDatafortDraft,
  getDatafortSettings,
  getDatafortTree,
  getVault,
  listDatafortDocuments,
  listDatafortTrash,
  moveDatafortEntry,
  patchDatafortSettings,
  permanentlyDeleteDatafortTrash,
  restoreDatafortTrash,
  SidecarApiError,
  saveDatafortDraft,
  searchWorkspace,
  updateDatafortDocument,
  uploadDatafortAttachment,
} from "@/shared/api/sidecar";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { ProgressIndicator } from "@/shared/components/motion/ProgressIndicator";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { SafeMarkdown } from "@/shared/components/SafeMarkdown";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";
import { DatafortGraph } from "./DatafortGraph";
import { DatafortProperties, parseDatafortProperties } from "./DatafortProperties";

const DatafortEditor = lazy(() =>
  import("./DatafortEditor").then((module) => ({ default: module.DatafortEditor })),
);
const PdfPreview = lazy(() =>
  import("../../vault/components/PdfPreview").then((module) => ({ default: module.PdfPreview })),
);

type DatafortShellProps = {
  initialPath?: string | null;
  onExitToChat: () => void;
  workspaceId: string;
};

type RailSection =
  | "files"
  | "search"
  | "tags"
  | "favorites"
  | "templates"
  | "daily"
  | "trash"
  | "graph";
type EditorMode = "live" | "source" | "reading";
type SaveState = "saved" | "saving" | "editing" | "conflict";
type GraphFilter = "all" | "attachments" | "folders" | "orphans" | "tags" | "unresolved";

const railItems: Array<{ icon: typeof Files; id: RailSection; label: string }> = [
  { icon: Files, id: "files", label: "files" },
  { icon: Search, id: "search", label: "search" },
  { icon: Tag, id: "tags", label: "tags" },
  { icon: Star, id: "favorites", label: "favorites" },
  { icon: LayoutTemplate, id: "templates", label: "templates" },
  { icon: CalendarDays, id: "daily", label: "daily" },
  { icon: Trash2, id: "trash", label: "trash" },
  { icon: Network, id: "graph", label: "graph" },
];

function baseName(path: string) {
  const name = path.split("/").at(-1) ?? path;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

function documentTitle(document: DatafortDocument | null, path: string | null) {
  return document ? baseName(document.path) : path ? baseName(path) : "Datafort";
}

function stripFrontmatter(content: string) {
  return content.replace(/^(?:---\r?\n)[\s\S]*?\r?\n---\r?\n?/, "");
}

function outgoingLinks(content: string) {
  return [...content.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map(
    (match) => match[1]?.trim() ?? "",
  );
}

function headings(content: string) {
  return [...content.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    depth: match[1]?.length ?? 1,
    title: match[2]?.trim() ?? "",
  }));
}

function tagsFrom(content: string) {
  return [...new Set([...content.matchAll(/(^|\s)#([\w/-]+)/gm)].map((match) => `#${match[2]}`))];
}

function displayPath(path: string) {
  return path === "." ? "Workspace" : path;
}

function rememberedMode(layout: Record<string, unknown>, path: string): EditorMode {
  const modes = layout.modeByPath;
  if (!modes || typeof modes !== "object" || Array.isArray(modes)) return "live";
  const value = (modes as Record<string, unknown>)[path];
  return value === "source" || value === "reading" || value === "live" ? value : "live";
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="datafort-banner" role="alert">
      <span className="datafort-banner-dot" aria-hidden="true" />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        aria-label="Dismiss"
        className="datafort-icon-button"
        onClick={onDismiss}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function ExplorerTree({
  entries,
  onOpen,
  query,
}: {
  entries: DatafortTreeEntry[];
  onOpen: (path: string) => void;
  query: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return entries.filter((entry) => {
      if (normalized && !entry.path.toLocaleLowerCase().includes(normalized)) return false;
      const ancestors = entry.path.split("/").slice(0, -1);
      return !ancestors.some((_, index) => collapsed.has(ancestors.slice(0, index + 1).join("/")));
    });
  }, [collapsed, entries, query]);

  return (
    <div className="datafort-tree" role="tree">
      {filtered.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const depth = Math.max(0, entry.path.split("/").length - 1);
        const isCollapsed = collapsed.has(entry.path);
        return (
          <div
            className="datafort-tree-row"
            key={entry.path}
            role="treeitem"
            style={{ paddingLeft: `${depth * 12 + 4}px` }}
            tabIndex={-1}
          >
            {isDirectory ? (
              <button
                aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
                className="datafort-tree-chevron"
                onClick={() =>
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  })
                }
                type="button"
              >
                {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
            ) : (
              <span className="datafort-tree-chevron" aria-hidden="true" />
            )}
            <button
              className="datafort-tree-item"
              onClick={() => onOpen(entry.path)}
              title={entry.path}
              type="button"
            >
              {isDirectory ? (
                isCollapsed ? (
                  <Folder size={14} />
                ) : (
                  <FolderOpen size={14} />
                )
              ) : entry.kind === "attachment" ? (
                entry.name.match(/\.(png|jpe?g|gif|svg)$/i) ? (
                  <FileImage size={14} />
                ) : (
                  <FileAudio size={14} />
                )
              ) : (
                <FileText size={14} />
              )}
              <span className="truncate">{entry.name}</span>
              {!entry.writable && <span className="datafort-readonly-mark">RO</span>}
            </button>
          </div>
        );
      })}
      {filtered.length === 0 && <p className="datafort-empty-copy">Nenhum item encontrado.</p>}
    </div>
  );
}

function EditorPlaceholder() {
  return (
    <div aria-busy="true" className="space-y-3 p-6">
      <Skeleton className="h-7 max-w-sm" />
      <Skeleton className="h-4 max-w-xl" />
      <Skeleton className="h-4 max-w-lg" />
      <Skeleton className="h-4 max-w-2xl" />
      <ProgressIndicator className="mt-6 max-w-xs" label="Carregando editor" />
    </div>
  );
}

function AttachmentPreview({ path, workspaceId }: { path: string; workspaceId: string }) {
  const [preview, setPreview] = useState<{
    bytes?: Uint8Array;
    contentType: string;
    url?: string;
  } | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    setLoading(true);
    setPreview(null);
    setText(null);
    void getDatafortAttachmentContent(workspaceId, path)
      .then(({ bytes, contentType }) => {
        if (cancelled) return;
        if (contentType.startsWith("text/") || contentType === "application/json") {
          setText(new TextDecoder().decode(bytes));
        } else if (contentType === "application/pdf") {
          setPreview({ bytes, contentType });
        } else {
          const blobBytes = new Uint8Array(bytes.byteLength);
          blobBytes.set(bytes);
          objectUrl = URL.createObjectURL(new Blob([blobBytes.buffer], { type: contentType }));
          setPreview({ contentType, url: objectUrl });
        }
      })
      .catch(() => {
        if (!cancelled) setText("Não foi possível carregar o preview deste anexo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, workspaceId]);

  if (loading)
    return (
      <div aria-busy="true" className="datafort-attachment-preview-loading">
        <Skeleton className="h-8 w-56" />
        <ProgressIndicator label="Carregando preview" />
      </div>
    );
  if (text !== null) return <pre className="datafort-attachment-text">{text}</pre>;
  if (!preview) return <p className="datafort-empty-copy">Preview indisponível.</p>;
  if (preview.contentType === "application/pdf" && preview.bytes)
    return (
      <Suspense fallback={<ProgressIndicator label="Carregando PDF" />}>
        <PdfPreview bytes={preview.bytes} />
      </Suspense>
    );
  if (preview.contentType.startsWith("image/") && preview.url)
    return <img alt={baseName(path)} className="datafort-attachment-image" src={preview.url} />;
  if (preview.contentType.startsWith("audio/") && preview.url)
    return (
      <audio className="datafort-attachment-media" controls src={preview.url}>
        <track kind="captions" />
      </audio>
    );
  if (preview.contentType.startsWith("video/") && preview.url)
    return (
      <video className="datafort-attachment-media" controls src={preview.url}>
        <track kind="captions" />
      </video>
    );
  if (!preview.url) return <p className="datafort-empty-copy">Preview indisponível.</p>;
  return (
    <a href={preview.url} rel="noreferrer" target="_blank">
      Abrir anexo
    </a>
  );
}

function SearchResults({
  onOpen,
  response,
}: {
  onOpen: (path: string) => void;
  response: import("@/shared/api/sidecar").WorkspaceSearchResponse | null;
}) {
  if (!response) return <p className="datafort-empty-copy">Digite para buscar no conhecimento.</p>;
  if (response.results.length === 0)
    return <p className="datafort-empty-copy">Nenhum resultado encontrado.</p>;
  return (
    <div className="datafort-search-results" aria-live="polite">
      <div className="datafort-search-meta">
        {response.mode === "hybrid" ? "Busca híbrida" : "Busca local"}
        {response.semanticUnavailable ? " · sem semântica" : ""}
      </div>
      {response.results.map(({ citation }) =>
        citation.source === "vault" ? (
          <button
            className="datafort-search-result"
            key={`${citation.source}-${citation.objectId}-${citation.chunkIndex}`}
            onClick={() => onOpen(citation.path)}
            type="button"
          >
            <strong>{citation.title || baseName(citation.path)}</strong>
            <span>{citation.path}</span>
            <small>{citation.excerpt}</small>
          </button>
        ) : citation.path ? (
          <button
            className="datafort-search-result"
            key={`${citation.source}-${citation.attachmentId}-${citation.chunkIndex}`}
            onClick={() => onOpen(citation.path ?? citation.filename)}
            type="button"
          >
            <strong>{citation.filename}</strong>
            <span>{citation.path}</span>
            <small>{citation.excerpt}</small>
          </button>
        ) : (
          <div
            className="datafort-search-result"
            key={`${citation.source}-${citation.attachmentId}-${citation.chunkIndex}`}
          >
            <strong>{citation.filename}</strong>
            <span>Anexo indexado</span>
            <small>{citation.excerpt}</small>
          </div>
        ),
      )}
    </div>
  );
}

function datafortCompletionSource(
  getCatalog: () => DatafortDocument[],
  getContent: () => string,
  onCreateMissingLink: (title: string) => void,
): CompletionSource {
  const inFenceOrComment = (context: CompletionContext) => {
    const before = context.state.sliceDoc(0, context.pos);
    if ((before.match(/^```/gm)?.length ?? 0) % 2 === 1) return true;
    const line = context.state.doc.lineAt(context.pos).text;
    const lineBeforeCursor = line.slice(
      0,
      context.pos - context.state.doc.lineAt(context.pos).from,
    );
    return (
      /^\s*%%/.test(lineBeforeCursor) ||
      lineBeforeCursor.lastIndexOf("%%") > lineBeforeCursor.lastIndexOf("\n")
    );
  };
  return (context) => {
    const catalog = getCatalog();
    const content = getContent();
    const notes = catalog.map((item) => ({
      aliases: parseDatafortProperties(item.content)
        .filter((property) => property.key.toLocaleLowerCase() === "aliases")
        .flatMap((property) => (Array.isArray(property.value) ? property.value : [])),
      label: baseName(item.path),
      path: item.path.replace(/\.(md|markdown)$/i, ""),
    }));
    const labels = new Map<string, number>();
    for (const note of notes) labels.set(note.label, (labels.get(note.label) ?? 0) + 1);
    if (inFenceOrComment(context)) return null;
    const aliasMatch = context.matchBefore(/\[\[[^\]\n|]*\|[^\]\n]*/);
    if (aliasMatch) {
      const query = aliasMatch.text.split("|").at(-1)?.toLocaleLowerCase() ?? "";
      return {
        from: aliasMatch.from + aliasMatch.text.lastIndexOf("|") + 1,
        options: notes
          .flatMap((note) =>
            note.aliases.map((alias) => ({
              detail: note.path,
              label: alias,
              type: "text" as const,
            })),
          )
          .filter((option) => option.label.toLocaleLowerCase().includes(query)),
      };
    }
    const headingMatch = context.matchBefore(/\[\[[^\]\n#|]+#[^\]\n|]*/);
    if (headingMatch) {
      const query = headingMatch.text.split("#").at(-1)?.toLocaleLowerCase() ?? "";
      const current = headings(content);
      return {
        from: headingMatch.from + headingMatch.text.lastIndexOf("#") + 1,
        options: current
          .filter((heading) => heading.title.toLocaleLowerCase().includes(query))
          .map((heading) => ({
            label: heading.title,
            detail: `H${heading.depth}`,
            type: "text" as const,
          })),
      };
    }
    const wikilinkMatch = context.matchBefore(/\[\[[^\]\n|#]*/);
    if (wikilinkMatch) {
      const query = wikilinkMatch.text.slice(2).toLocaleLowerCase();
      const options: Completion[] = notes
        .filter(
          (note) =>
            note.path.toLocaleLowerCase().includes(query) ||
            note.label.toLocaleLowerCase().includes(query),
        )
        .map((note) => ({
          detail: note.path,
          label: (labels.get(note.label) ?? 0) > 1 ? note.path : note.label,
          type: "text",
        }));
      if (query && options.length === 0)
        options.push({
          apply: () => {
            if (window.confirm(`Criar a nota "${wikilinkMatch.text.slice(2)}"?`))
              onCreateMissingLink(wikilinkMatch.text.slice(2));
          },
          detail: "novo documento",
          label: `Criar "${wikilinkMatch.text.slice(2)}"`,
          type: "keyword",
        });
      return { from: wikilinkMatch.from + 2, options };
    }
    const blockMatch = context.matchBefore(/\^[\w-]*/);
    if (blockMatch) {
      const query = blockMatch.text.slice(1).toLocaleLowerCase();
      const blockIds = [...content.matchAll(/^\^([\w-]+)\s*$/gm)].map((match) => match[1] ?? "");
      return {
        from: blockMatch.from + 1,
        options: blockIds
          .filter((id) => id.toLocaleLowerCase().includes(query))
          .map((id) => ({ label: id, type: "keyword" as const })),
      };
    }
    const tagMatch = context.matchBefore(/(?:^|\s)#[-\w/]*/);
    if (!tagMatch || (!context.explicit && tagMatch.from === tagMatch.to)) return null;
    const query = tagMatch.text.slice(tagMatch.text.lastIndexOf("#") + 1).toLocaleLowerCase();
    const tags = [
      ...new Set(
        catalog.flatMap((item) => [
          ...tagsFrom(item.content),
          ...parseDatafortProperties(item.content)
            .filter((property) => property.key.toLocaleLowerCase() === "tags")
            .flatMap((property) =>
              Array.isArray(property.value) ? property.value.map((value) => `#${value}`) : [],
            ),
        ]),
      ),
    ];
    return {
      from: tagMatch.from + tagMatch.text.lastIndexOf("#") + 1,
      options: tags
        .filter((tag) => tag.slice(1).toLocaleLowerCase().includes(query))
        .map((tag) => ({ label: tag.slice(1), type: "keyword" as const })),
    };
  };
}

function CenterEditor({
  attachmentPath,
  document,
  content,
  mode,
  onChange,
  onSave,
  onAttachment,
  completionSource,
  workspaceId,
}: {
  attachmentPath?: string | null;
  content: string;
  document: DatafortDocument | null;
  mode: EditorMode;
  onChange: (content: string) => void;
  onSave: () => void;
  onAttachment?: (file: File) => Promise<string | null>;
  completionSource?: CompletionSource;
  workspaceId: string;
}) {
  if (attachmentPath)
    return (
      <div className="datafort-attachment-preview">
        <div className="datafort-attachment-heading">
          <FileText size={14} />
          <span className="truncate">{attachmentPath}</span>
        </div>
        <AttachmentPreview path={attachmentPath} workspaceId={workspaceId} />
      </div>
    );
  if (!document) {
    return (
      <div className="datafort-empty-editor">
        <FileText size={28} strokeWidth={1.3} />
        <p>Selecione uma nota para começar.</p>
      </div>
    );
  }
  if (mode === "reading") {
    return (
      <div className="datafort-reading safe-markdown-scroll">
        <SafeMarkdown content={stripFrontmatter(content)} />
      </div>
    );
  }
  return (
    <Suspense fallback={<EditorPlaceholder />}>
      <DatafortEditor
        fileId={document.fileId}
        initialContent={content}
        mode={mode}
        onChange={onChange}
        onSave={onSave}
        onAttachment={onAttachment}
        completionSource={completionSource}
        readOnly={!document.writable}
      />
    </Suspense>
  );
}

function ModeTransition({
  children,
  mode,
}: {
  children: (mode: EditorMode) => ReactNode;
  mode: EditorMode;
}) {
  const [visibleMode, setVisibleMode] = useState(mode);
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (mode !== visibleMode) setShow(false);
  }, [mode, visibleMode]);

  return (
    <EnterExit
      className="h-full min-h-0"
      duration="fast"
      onExited={() => {
        setVisibleMode(mode);
        setShow(true);
      }}
      show={show}
    >
      {children(visibleMode)}
    </EnterExit>
  );
}

export default function DatafortShell({
  initialPath,
  onExitToChat,
  workspaceId,
}: DatafortShellProps) {
  const { t } = useTranslation();
  const [section, setSection] = useState<RailSection>("files");
  const [tree, setTree] = useState<DatafortTreeEntry[]>([]);
  const [settings, setSettings] = useState<DatafortSettings | null>(null);
  const [catalog, setCatalog] = useState<DatafortDocument[]>([]);
  const [trash, setTrash] = useState<DatafortTrashEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const selectedPathRef = useRef<string | null>(null);
  const settingsRef = useRef<DatafortSettings | null>(null);
  const layoutHydratedRef = useRef(false);
  const lastLayoutSaveRef = useRef("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [groupPaths, setGroupPaths] = useState<[string | null, string | null]>([null, null]);
  const [split, setSplit] = useState(false);
  const activeGroup: 0 | 1 = 0;
  const [document, setDocument] = useState<DatafortDocument | null>(null);
  const draftRef = useRef("");
  const [draftVersion, setDraftVersion] = useState(0);
  const [mode, setMode] = useState<EditorMode>("live");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [loading, setLoading] = useState(true);
  const [loadingDocument, setLoadingDocument] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [searchResponse, setSearchResponse] = useState<
    import("@/shared/api/sidecar").WorkspaceSearchResponse | null
  >(null);
  const [searching, setSearching] = useState(false);
  const [globalGraph, setGlobalGraph] = useState<import("@/shared/api/sidecar").VaultGraph | null>(
    null,
  );
  const [localDepth, setLocalDepth] = useState<1 | 2 | 3>(1);
  const [graphFilter, setGraphFilter] = useState<GraphFilter>("all");
  const [attachmentUpload, setAttachmentUpload] = useState<{
    name: string;
    percent: number;
  } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [showProperties, setShowProperties] = useState(true);
  const [conflictHash, setConflictHash] = useState<string | null>(null);
  const [documentReloadToken, setDocumentReloadToken] = useState(0);
  const [editorMountKey, setEditorMountKey] = useState(0);
  const saveInFlightRef = useRef(false);
  const attachmentAbortRef = useRef<AbortController | null>(null);
  const attachmentFileInputRef = useRef<HTMLInputElement | null>(null);
  const treeRef = useRef<DatafortTreeEntry[]>([]);
  const catalogCompletionRef = useRef<DatafortDocument[]>([]);
  const contentCompletionRef = useRef("");
  const inspectorPanelRef = useRef<PanelImperativeHandle | null>(null);

  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

  treeRef.current = tree;

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (showProperties) inspectorPanelRef.current?.expand();
    else inspectorPanelRef.current?.collapse();
  }, [showProperties]);

  const reloadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextTree] = await Promise.all([
        getDatafortSettings(workspaceId),
        getDatafortTree(workspaceId),
      ]);
      setSettings(nextSettings);
      setTree(nextTree.entries);
      const nextCatalog = await listDatafortDocuments(workspaceId);
      setCatalog(nextCatalog);
      const validPaths = new Set(
        nextTree.entries
          .filter((entry) => entry.kind === "file" || entry.kind === "attachment")
          .map((entry) => entry.path),
      );
      if (!layoutHydratedRef.current) {
        const layout = nextSettings.layout;
        const storedTabs = Array.isArray(layout.tabs)
          ? layout.tabs.filter(
              (path): path is string => typeof path === "string" && validPaths.has(path),
            )
          : [];
        const storedGroups = Array.isArray(layout.groupPaths)
          ? layout.groupPaths.map((path) =>
              typeof path === "string" && validPaths.has(path) ? path : null,
            )
          : [null, null];
        const storedSelected =
          initialPath && validPaths.has(initialPath)
            ? initialPath
            : typeof layout.selectedPath === "string" && validPaths.has(layout.selectedPath)
              ? layout.selectedPath
              : (storedTabs[0] ??
                nextTree.entries.find((entry) => entry.kind === "file")?.path ??
                null);
        setTabs(storedTabs.length > 0 ? storedTabs : storedSelected ? [storedSelected] : []);
        setGroupPaths([storedGroups[0] ?? null, storedGroups[1] ?? null]);
        setSplit(layout.split === true);
        setSelectedPath(storedSelected);
        layoutHydratedRef.current = true;
      } else {
        const currentPath = selectedPathRef.current;
        if (currentPath && !validPaths.has(currentPath)) setSelectedPath(null);
        if (!currentPath) {
          const first = nextTree.entries.find((entry) => entry.kind === "file")?.path ?? null;
          if (first) setSelectedPath(first);
        }
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [initialPath, t, workspaceId]);

  useEffect(() => {
    void reloadWorkspace();
  }, [reloadWorkspace]);

  const openPath = useCallback(
    (path: string, group?: 0 | 1) => {
      const targetGroup = group ?? activeGroup;
      const entry = tree.find((item) => item.path === path);
      if (entry?.kind === "directory") return;
      setSelectedPath(path);
      setGroupPaths((current) => {
        const next: [string | null, string | null] = [...current];
        next[targetGroup] = path;
        return next;
      });
      setTabs((current) => (current.includes(path) ? current : [...current, path]));
      setSection("files");
    },
    [tree],
  );

  const createMissingLink = useCallback(
    (title: string) => {
      const normalized = title.trim();
      if (!normalized) return;
      void createDatafortDocument(workspaceId, { title: normalized })
        .then(async (created) => {
          await reloadWorkspace();
          openPath(created.path);
        })
        .catch((reason) =>
          setError(reason instanceof Error ? reason.message : t("datafort.loadFailed")),
        );
    },
    [openPath, reloadWorkspace, t, workspaceId],
  );

  useEffect(() => {
    if (!selectedPath || documentReloadToken < 0) return;
    const selectedEntry = treeRef.current.find((entry) => entry.path === selectedPath);
    if (selectedEntry?.kind === "attachment") {
      draftRef.current = "";
      setDocument(null);
      setConflictHash(null);
      setSaveState("saved");
      setLoadingDocument(false);
      return;
    }
    let cancelled = false;
    setLoadingDocument(true);
    void Promise.all([
      listDatafortDocuments(workspaceId, selectedPath),
      treeRef.current.find((entry) => entry.path === selectedPath)?.fileId
        ? getDatafortDraft(
            workspaceId,
            treeRef.current.find((entry) => entry.path === selectedPath)?.fileId ?? "",
          )
        : Promise.resolve(null),
    ])
      .then(([documents, draft]) => {
        if (cancelled) return;
        const next = documents[0] ?? null;
        if (!next) return;
        draftRef.current = draft?.content ?? next.content;
        setDocument({ ...next, content: draftRef.current });
        setMode(rememberedMode(settingsRef.current?.layout ?? {}, next.path));
        setConflictHash(null);
        setSaveState("saved");
        setEditorMountKey((current) => current + 1);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoadingDocument(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentReloadToken, selectedPath, t, workspaceId]);

  const saveDocument = useCallback(async () => {
    if (!document?.writable || saveInFlightRef.current) return null;
    if (saveState === "saved") return document;
    saveInFlightRef.current = true;
    setSaveState("saving");
    try {
      await saveDatafortDraft(workspaceId, {
        content: draftRef.current,
        fileId: document.fileId,
        path: document.path,
      });
      const next = await updateDatafortDocument(workspaceId, {
        content: draftRef.current,
        expectedHash: document.contentHash,
        fileId: document.fileId,
        path: document.path,
      });
      await deleteDatafortDraft(workspaceId, document.fileId);
      setDocument(next);
      draftRef.current = next.content;
      setConflictHash(null);
      setSaveState("saved");
      setCatalog((current) => current.map((item) => (item.fileId === next.fileId ? next : item)));
      setTree((current) =>
        current.map((item) =>
          item.path === next.path ? { ...item, managed: next.managed } : item,
        ),
      );
      return next;
    } catch (reason) {
      if (reason instanceof SidecarApiError && reason.errorCode === "datafort_conflict") {
        setConflictHash(reason.currentHash ?? null);
        setSaveState("conflict");
      } else {
        setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
        setSaveState("editing");
      }
      return null;
    } finally {
      saveInFlightRef.current = false;
    }
  }, [document, saveState, t, workspaceId]);

  useEffect(() => {
    if (draftVersion === 0 || saveState !== "editing") return;
    const timer = window.setTimeout(() => void saveDocument(), 800);
    return () => window.clearTimeout(timer);
  }, [draftVersion, saveDocument, saveState]);

  async function createNote() {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    try {
      const created = await createDatafortDocument(workspaceId, { title });
      setNewTitle("");
      await reloadWorkspace();
      openPath(created.path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function createDailyNote() {
    if (creating) return;
    const directory = settings?.dailyDirectory ?? "Blackwall Vault/Daily";
    const date = new Date().toISOString().slice(0, 10);
    const path = `${directory}/${date}.md`;
    setCreating(true);
    try {
      const existing = await listDatafortDocuments(workspaceId, path);
      const daily =
        existing[0] ??
        (await (async () => {
          let content = `# ${date}\n\n`;
          if (settings?.dailyTemplatePath) {
            const template = await listDatafortDocuments(workspaceId, settings.dailyTemplatePath);
            content =
              template[0]?.content
                .replaceAll("{{title}}", date)
                .replaceAll("{{date}}", date)
                .replaceAll("{{time}}", new Date().toLocaleTimeString()) ?? content;
          }
          return createDatafortDocument(workspaceId, { content, directory, path, title: date });
        })());
      await reloadWorkspace();
      openPath(daily.path);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function attachFile(file: File) {
    if (!document?.writable || attachmentUpload) return null;
    const controller = new AbortController();
    attachmentAbortRef.current = controller;
    setAttachmentUpload({ name: file.name, percent: 20 });
    try {
      const attachment = await uploadDatafortAttachment(file, workspaceId, controller.signal);
      setAttachmentUpload({ name: file.name, percent: 100 });
      setTree((current) =>
        current.some((entry) => entry.path === attachment.path)
          ? current
          : [
              ...current,
              {
                fileId: attachment.fileId,
                kind: "attachment" as const,
                managed: false,
                name: attachment.filename,
                path: attachment.path,
                size: attachment.byteSize,
                writable: false,
              },
            ],
      );
      return `![[${attachment.path}]]`;
    } catch (reason) {
      if (!(reason instanceof Error && reason.name === "AbortError"))
        setError(reason instanceof Error ? reason.message : "Não foi possível anexar o arquivo.");
      return null;
    } finally {
      attachmentAbortRef.current = null;
      setAttachmentUpload(null);
    }
  }

  function insertAttachmentLink(link: string) {
    const separator = draftRef.current.endsWith("\n") ? "" : "\n";
    draftRef.current = `${draftRef.current}${separator}${link}\n`;
    setSaveState("editing");
    setDraftVersion((current) => current + 1);
    setEditorMountKey((current) => current + 1);
  }

  function cancelAttachmentUpload() {
    attachmentAbortRef.current?.abort();
    setAttachmentUpload(null);
  }

  async function moveSelected() {
    if (!document) return;
    const destination = window.prompt(t("datafort.movePrompt"), document.path);
    if (!destination || destination === document.path) return;
    try {
      const saved = await saveDocument();
      const currentDocument = saved ?? document;
      await moveDatafortEntry(workspaceId, {
        expectedHash: currentDocument.contentHash,
        sourcePath: currentDocument.path,
        targetPath: destination,
      });
      setSelectedPath(destination);
      setTabs((current) =>
        current.map((path) => (path === currentDocument.path ? destination : path)),
      );
      setGroupPaths(
        (current) =>
          current.map((path) => (path === currentDocument.path ? destination : path)) as [
            string | null,
            string | null,
          ],
      );
      await reloadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.moveFailed"));
    }
  }

  async function trashSelected() {
    if (!document) return;
    if (!window.confirm(`${t("datafort.sendToTrash")}: ${documentTitle(document, selectedPath)}?`))
      return;
    try {
      const saved = await saveDocument();
      const currentDocument = saved ?? document;
      await deleteDatafortEntry(workspaceId, {
        expectedHash: currentDocument.contentHash,
        path: currentDocument.path,
      });
      setTabs((current) => current.filter((path) => path !== currentDocument.path));
      setSelectedPath(null);
      setDocument(null);
      await reloadWorkspace();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
    }
  }

  const loadTrash = useCallback(async () => {
    try {
      setTrash(await listDatafortTrash(workspaceId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("datafort.loadFailed"));
    }
  }, [t, workspaceId]);

  useEffect(() => {
    if (section === "trash") void loadTrash();
  }, [loadTrash, section]);

  const currentContent = document ? draftRef.current : "";
  const selectedAttachmentPath =
    tree.find((entry) => entry.path === selectedPath && entry.kind === "attachment")?.path ?? null;
  catalogCompletionRef.current = catalog;
  contentCompletionRef.current = currentContent;
  const links = useMemo(() => outgoingLinks(currentContent), [currentContent]);
  const currentHeadings = useMemo(() => headings(currentContent), [currentContent]);
  const currentTags = useMemo(() => tagsFrom(currentContent), [currentContent]);
  const completionSource = useMemo(
    () =>
      datafortCompletionSource(
        () => catalogCompletionRef.current,
        () => contentCompletionRef.current,
        createMissingLink,
      ),
    [createMissingLink],
  );
  const localGraph = useMemo(() => {
    if (!document) return { edges: [], files: [], nodes: [] };
    const all = catalog.some((item) => item.fileId === document.fileId)
      ? catalog
      : [...catalog, document];
    const docsByName = new Map(all.map((item) => [baseName(item.path).toLocaleLowerCase(), item]));
    const related = new Map<string, DatafortDocument>([[document.fileId, document]]);
    let frontier = [document];
    for (let depth = 0; depth < localDepth; depth += 1) {
      frontier = frontier
        .flatMap((item) =>
          outgoingLinks(item.content)
            .map((link) => docsByName.get(baseName(link).toLocaleLowerCase()))
            .filter((item): item is DatafortDocument => Boolean(item)),
        )
        .filter((item) => !related.has(item.fileId));
      for (const item of frontier) related.set(item.fileId, item);
    }
    const unique = [...related.values()];
    const nodeIds = new Set(unique.map((item) => item.fileId));
    return {
      edges: unique.flatMap((item) =>
        outgoingLinks(item.content).flatMap((link) => {
          const target = docsByName.get(baseName(link).toLocaleLowerCase());
          return target && nodeIds.has(target.fileId)
            ? [{ source: item.fileId, target: target.fileId }]
            : [];
        }),
      ),
      files: unique.map((item) => ({
        content: item.content,
        headings: headings(item.content).map((heading) => heading.title),
        path: item.path,
        title: baseName(item.path),
      })),
      nodes: unique.map((item) => ({
        id: item.fileId,
        label: baseName(item.path),
        path: item.path,
      })),
    };
  }, [catalog, document, localDepth]);
  const filteredGlobalGraph = useMemo(() => {
    if (!globalGraph) return null;
    const files = [...globalGraph.files];
    const nodes = [...globalGraph.nodes];
    const edges = [...globalGraph.edges];
    const knownTargets = new Set(
      files.flatMap((file) => [file.path, baseName(file.path), file.path.replace(/\.md$/i, "")]),
    );
    const nodesByPath = new Map(nodes.map((node) => [node.path, node]));
    for (const file of files) {
      const source = nodesByPath.get(file.path);
      if (!source) continue;
      for (const link of outgoingLinks(file.content)) {
        if (knownTargets.has(link) || knownTargets.has(baseName(link))) continue;
        const unresolvedId = `unresolved:${file.path}:${link}`;
        if (!nodes.some((node) => node.id === unresolvedId)) {
          nodes.push({ id: unresolvedId, label: `? ${link}`, path: "" });
          edges.push({ source: source.id, target: unresolvedId });
        }
      }
    }
    for (const entry of tree.filter((item) => item.kind === "attachment")) {
      const id = `attachment:${entry.path}`;
      if (!nodes.some((node) => node.id === id)) {
        nodes.push({ id, label: entry.name, path: entry.path });
        files.push({ content: "", headings: [], path: entry.path, title: entry.name });
      }
      for (const file of globalGraph.files) {
        const source = nodesByPath.get(file.path);
        if (
          source &&
          new RegExp(
            `!\\[\\[${entry.path.replace(/[.*+?^${}()|[\\]\\]/g, "\\\\$&")}(?:\\|[^\\]]+)?\\]\\]`,
          ).test(file.content)
        )
          edges.push({ source: source.id, target: id });
      }
    }
    if (graphFilter === "all") return { edges, files, nodes };
    const edgeCount = new Map<string, number>();
    for (const edge of edges) {
      edgeCount.set(edge.source, (edgeCount.get(edge.source) ?? 0) + 1);
      edgeCount.set(edge.target, (edgeCount.get(edge.target) ?? 0) + 1);
    }
    const visible = new Set(
      nodes
        .filter((node) => {
          if (graphFilter === "attachments") return node.id.startsWith("attachment:");
          if (graphFilter === "unresolved") return node.id.startsWith("unresolved:");
          if (graphFilter === "orphans") return !edgeCount.has(node.id);
          if (graphFilter === "folders") return Boolean(node.path?.includes("/"));
          const file = files.find((item) => item.path === node.path);
          return Boolean(
            file &&
              (tagsFrom(file.content).length ||
                parseDatafortProperties(file.content).some(
                  (property) => property.key.toLocaleLowerCase() === "tags",
                )),
          );
        })
        .map((node) => node.id),
    );
    return {
      edges: edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
      files: files.filter((file) =>
        visible.has(nodes.find((node) => node.path === file.path)?.id ?? ""),
      ),
      nodes: nodes.filter((node) => visible.has(node.id)),
    };
  }, [globalGraph, graphFilter, tree]);

  useEffect(() => {
    if (section !== "search" || !query.trim()) {
      setSearchResponse(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchWorkspace(workspaceId, query.trim(), 20)
        .then((response) => {
          if (!cancelled) setSearchResponse(response);
        })
        .catch((reason) => {
          if (!cancelled)
            setError(reason instanceof Error ? reason.message : "Não foi possível pesquisar.");
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, section, workspaceId]);

  useEffect(() => {
    if (section !== "graph") return;
    let cancelled = false;
    void getVault(workspaceId)
      .then((nextGraph) => {
        if (!cancelled) setGlobalGraph(nextGraph);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Não foi possível carregar o grafo.");
      });
    return () => {
      cancelled = true;
    };
  }, [section, workspaceId]);
  const favoritePaths = useMemo(() => {
    const value = settings?.layout.favoritePaths;
    return new Set(
      Array.isArray(value) ? value.filter((path): path is string => typeof path === "string") : [],
    );
  }, [settings]);
  const backlinks = useMemo(
    () =>
      catalog
        .filter(
          (item) =>
            item.fileId !== document?.fileId &&
            outgoingLinks(item.content).some((link) => link === baseName(document?.path ?? "")),
        )
        .map((item) => baseName(item.path)),
    [catalog, document],
  );
  const visibleEntries = useMemo(() => {
    if (section === "search") return tree;
    if (section === "favorites") return tree.filter((entry) => favoritePaths.has(entry.path));
    return tree;
  }, [favoritePaths, section, tree]);
  const collectionEntries = useMemo(() => {
    const prefix =
      section === "templates"
        ? settings?.templateDirectory
        : section === "daily"
          ? settings?.dailyDirectory
          : null;
    return prefix
      ? tree.filter((entry) => entry.path === prefix || entry.path.startsWith(`${prefix}/`))
      : [];
  }, [section, settings, tree]);

  async function persistLayout(layout: Record<string, unknown>) {
    if (!settings) return;
    setSettings((current) =>
      current ? { ...current, layout: { ...current.layout, ...layout } } : current,
    );
    await patchDatafortSettings(workspaceId, { layout: { ...settings.layout, ...layout } }).catch(
      () => undefined,
    );
  }

  useEffect(() => {
    if (!settings || !layoutHydratedRef.current) return;
    const nextLayout = {
      ...settingsRef.current?.layout,
      groupPaths,
      selectedPath,
      split,
      tabs,
    };
    const serialized = JSON.stringify(nextLayout);
    if (serialized === lastLayoutSaveRef.current) return;
    lastLayoutSaveRef.current = serialized;
    void patchDatafortSettings(workspaceId, { layout: nextLayout }).catch(() => undefined);
  }, [groupPaths, selectedPath, settings, split, tabs, workspaceId]);

  function changeEditorMode(nextMode: EditorMode) {
    setMode(nextMode);
    const path = document?.path ?? selectedPath;
    if (!settings || !path) return;
    const modes =
      settings.layout.modeByPath &&
      typeof settings.layout.modeByPath === "object" &&
      !Array.isArray(settings.layout.modeByPath)
        ? (settings.layout.modeByPath as Record<string, unknown>)
        : {};
    void persistLayout({ modeByPath: { ...modes, [path]: nextMode } });
  }

  function toggleFavorite(path: string) {
    const next = new Set(favoritePaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    void persistLayout({ favoritePaths: [...next] });
  }

  function renderEditorColumn(path: string | null, group: 0 | 1) {
    const columnDocument =
      path === document?.path ? document : (catalog.find((item) => item.path === path) ?? null);
    const isActive = path === selectedPath;
    return (
      <section className={`datafort-editor-column ${isActive ? "is-active" : ""}`}>
        <div className="datafort-column-label">
          <button onClick={() => path && openPath(path, group)} type="button">
            <FileText size={13} />
            <span className="truncate">{documentTitle(columnDocument, path)}</span>
          </button>
          {group === 1 && (
            <button
              aria-label="Close split"
              className="datafort-icon-button"
              onClick={() => setSplit(false)}
              type="button"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {isActive && loadingDocument ? (
          <EditorPlaceholder />
        ) : isActive ? (
          <ModeTransition mode={mode}>
            {(visibleMode) => (
              <CenterEditor
                attachmentPath={isActive ? selectedAttachmentPath : null}
                content={currentContent}
                document={document}
                mode={visibleMode}
                onChange={(content) => {
                  draftRef.current = content;
                  setSaveState("editing");
                  setDraftVersion((current) => current + 1);
                }}
                onSave={() => void saveDocument()}
                onAttachment={isActive ? attachFile : undefined}
                completionSource={isActive ? completionSource : undefined}
                workspaceId={workspaceId}
              />
            )}
          </ModeTransition>
        ) : (
          <div className="datafort-empty-editor">
            <span>Selecione esta aba para editar</span>
          </div>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div aria-busy="true" className="datafort-loading-shell">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-full w-full" />
        <ProgressIndicator label={t("datafort.loading")} />
      </div>
    );
  }

  return (
    <EnterExit className="h-full min-h-0" duration="base" show>
      <main aria-label={t("datafort.title")} className="datafort-shell">
        <header className="datafort-topbar">
          <div className="flex min-w-0 items-center gap-2">
            <button
              aria-label={t("datafort.exit")}
              className="datafort-icon-button"
              onClick={onExitToChat}
              type="button"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="datafort-brand-mark" aria-hidden="true">
              ◈
            </div>
            <div className="min-w-0">
              <div className="datafort-title">{t("datafort.title")}</div>
              <div className="datafort-subtitle truncate">
                {settings?.newNoteDirectory ?? "Blackwall Vault/Notes"}
              </div>
            </div>
          </div>
          <div className="datafort-topbar-actions">
            <button
              className="datafort-quiet-button"
              disabled={!document?.writable || Boolean(attachmentUpload)}
              onClick={() => attachmentFileInputRef.current?.click()}
              type="button"
            >
              <Paperclip size={14} /> Anexar
            </button>
            <input
              accept="image/*,audio/*,video/*,.pdf,.md,.txt,.json,.yaml,.yml"
              aria-label="Escolher anexo"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void attachFile(file).then((link) => {
                    if (link) insertAttachmentLink(link);
                  });
              }}
              ref={attachmentFileInputRef}
              type="file"
            />
            <button
              className="datafort-quiet-button"
              onClick={() => void moveSelected()}
              disabled={!document}
              type="button"
            >
              <Link2 size={14} /> {t("datafort.move")}
            </button>
            <button
              aria-label={
                document && favoritePaths.has(document.path)
                  ? t("datafort.removeFavorite")
                  : t("datafort.favorite")
              }
              aria-pressed={document ? favoritePaths.has(document.path) : false}
              className={`datafort-quiet-button ${document && favoritePaths.has(document.path) ? "is-active" : ""}`}
              disabled={!document}
              onClick={() => document && toggleFavorite(document.path)}
              type="button"
            >
              <Star size={14} />
            </button>
            <button
              className="datafort-quiet-button"
              onClick={() => void trashSelected()}
              disabled={!document}
              type="button"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="datafort-quiet-button"
              onClick={() => void saveDocument()}
              disabled={!document || saveState === "saved"}
              type="button"
            >
              <Save size={14} /> {t("datafort.save")}
            </button>
            <button
              className="datafort-quiet-button"
              onClick={() => setShowProperties((current) => !current)}
              type="button"
            >
              <PanelRight size={14} />
            </button>
          </div>
        </header>

        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
        {attachmentUpload && (
          <div className="datafort-upload-banner" role="status">
            <span className="truncate">Anexando {attachmentUpload.name}</span>
            <ProgressIndicator label="Progresso do anexo" value={attachmentUpload.percent} />
            <button
              className="datafort-quiet-button"
              onClick={cancelAttachmentUpload}
              type="button"
            >
              Cancelar
            </button>
          </div>
        )}

        <div className="datafort-body">
          <nav aria-label="Datafort sections" className="datafort-rail">
            {railItems.map(({ icon: Icon, id, label }) => (
              <button
                aria-label={t(`datafort.${label}`)}
                aria-pressed={section === id}
                className={`datafort-rail-button ${section === id ? "is-active" : ""}`}
                key={id}
                onClick={() => setSection(id)}
                title={t(`datafort.${label}`)}
                type="button"
              >
                <Icon size={16} strokeWidth={section === id ? 2 : 1.5} />
                <span className="sr-only">{t(`datafort.${label}`)}</span>
              </button>
            ))}
          </nav>

          <ResizablePanelGroup
            className="min-h-0 flex-1"
            onLayoutChanged={(layout) =>
              void persistLayout({
                explorer: layout["datafort-explorer"] ?? 0,
                inspector: layout["datafort-inspector"] ?? 0,
              })
            }
            orientation="horizontal"
          >
            <ResizablePanel
              className="datafort-explorer-panel"
              defaultSize={(settings?.layout.explorer as number | undefined) ?? 22}
              id="datafort-explorer"
              minSize={16}
            >
              <aside className="datafort-explorer">
                <div className="datafort-panel-heading">
                  <div>
                    <span className="datafort-eyebrow">
                      {section === "files" ? t("datafort.files") : t(`datafort.${section}`)}
                    </span>
                    <span className="datafort-count">
                      {tree.filter((entry) => entry.kind === "file").length}
                    </span>
                  </div>
                  <button
                    aria-label={t("datafort.newNote")}
                    className="datafort-icon-button"
                    onClick={() => setSection("files")}
                    type="button"
                  >
                    <Plus size={15} />
                  </button>
                </div>
                <div className="datafort-explorer-content">
                  {section === "files" || section === "search" || section === "favorites" ? (
                    <>
                      {(section === "search" || section === "files") && (
                        <label className="datafort-search-box">
                          <Search size={14} />
                          <input
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Buscar no workspace"
                            value={query}
                          />
                        </label>
                      )}
                      {section === "files" && (
                        <div className="datafort-create-note">
                          <input
                            aria-label={t("datafort.noteTitle")}
                            onChange={(event) => setNewTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") void createNote();
                            }}
                            placeholder={t("datafort.noteTitle")}
                            value={newTitle}
                          />
                          <button
                            aria-label={t("datafort.createNote")}
                            disabled={!newTitle.trim() || creating}
                            onClick={() => void createNote()}
                            type="button"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                      )}
                      {section === "search" ? (
                        searching ? (
                          <div aria-busy="true" className="space-y-2 p-2">
                            <Skeleton className="h-12" />
                            <Skeleton className="h-12" />
                            <ProgressIndicator label="Pesquisando no workspace" />
                          </div>
                        ) : (
                          <SearchResults onOpen={openPath} response={searchResponse} />
                        )
                      ) : (
                        <ExplorerTree entries={visibleEntries} onOpen={openPath} query={query} />
                      )}
                    </>
                  ) : section === "trash" ? (
                    <div className="datafort-trash-list">
                      {trash.length === 0 && <p className="datafort-empty-copy">Lixeira vazia.</p>}
                      {trash.map((entry) => (
                        <div className="datafort-trash-row" key={entry.entryId}>
                          <div className="min-w-0">
                            <strong className="truncate">{baseName(entry.originalPath)}</strong>
                            <span className="truncate">{entry.originalPath}</span>
                          </div>
                          <div className="flex gap-1">
                            <button
                              aria-label={t("datafort.restore")}
                              className="datafort-icon-button"
                              onClick={() =>
                                void restoreDatafortTrash(workspaceId, entry.entryId)
                                  .then(loadTrash)
                                  .then(reloadWorkspace)
                              }
                              type="button"
                            >
                              <RotateCcw size={13} />
                            </button>
                            <button
                              aria-label={t("datafort.deleteForever")}
                              className="datafort-icon-button danger"
                              onClick={() =>
                                void permanentlyDeleteDatafortTrash(
                                  workspaceId,
                                  entry.entryId,
                                ).then(loadTrash)
                              }
                              type="button"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : section === "templates" || section === "daily" ? (
                    <>
                      {section === "daily" && (
                        <button
                          className="datafort-quiet-button mb-3 w-full justify-center"
                          disabled={creating}
                          onClick={() => void createDailyNote()}
                          type="button"
                        >
                          <CalendarDays size={14} /> Criar nota de hoje
                        </button>
                      )}
                      <ExplorerTree entries={collectionEntries} onOpen={openPath} query={query} />
                    </>
                  ) : (
                    <div className="datafort-rail-placeholder">
                      <Tag size={20} />
                      <p>Esta coleção será preenchida conforme você organiza o workspace.</p>
                    </div>
                  )}
                </div>
                <div className="datafort-explorer-footer">
                  <label className="datafort-scope-toggle">
                    <span>{t("datafort.knowledgeScope")}</span>
                    <select
                      onChange={(event) =>
                        void patchDatafortSettings(workspaceId, {
                          explorerScope: event.target.value as DatafortSettings["explorerScope"],
                        }).then((next) => {
                          setSettings(next);
                          void reloadWorkspace();
                        })
                      }
                      value={settings?.explorerScope ?? "knowledge"}
                    >
                      <option value="knowledge">{t("datafort.onlyKnowledge")}</option>
                      <option value="all">{t("datafort.allFiles")}</option>
                    </select>
                  </label>
                  <label className="datafort-external-toggle">
                    <input
                      checked={settings?.externalMarkdownWriteEnabled ?? false}
                      onChange={(event) =>
                        void patchDatafortSettings(workspaceId, {
                          externalMarkdownWriteEnabled: event.target.checked,
                        }).then(setSettings)
                      }
                      type="checkbox"
                    />
                    <span>{t("datafort.externalWriteEnabled")}</span>
                  </label>
                  <div className="datafort-explorer-path">
                    <Settings2 size={12} />{" "}
                    {displayPath(settings?.newNoteDirectory ?? "Blackwall Vault/Notes")}
                  </div>
                </div>
              </aside>
            </ResizablePanel>
            <ResizableHandle withHandle aria-label="Resize explorer" />

            <ResizablePanel
              className="min-w-0"
              defaultSize={Math.max(
                38,
                100 -
                  ((settings?.layout.explorer as number | undefined) ?? 22) -
                  (showProperties ? ((settings?.layout.inspector as number | undefined) ?? 23) : 0),
              )}
              id="datafort-editor"
              minSize={30}
            >
              <section className="datafort-center">
                <div className="datafort-tabs" role="tablist">
                  {tabs.map((path) => (
                    <div
                      className={`datafort-tab ${path === selectedPath ? "is-active" : ""}`}
                      key={path}
                    >
                      <button onClick={() => openPath(path)} role="tab" type="button">
                        <FileText size={13} />
                        <span className="truncate">{baseName(path)}</span>
                      </button>
                      <button
                        aria-label={`${t("datafort.closeTab")} ${baseName(path)}`}
                        className="datafort-tab-close"
                        onClick={() => {
                          setTabs((current) => current.filter((item) => item !== path));
                          if (selectedPath === path)
                            setSelectedPath(tabs.find((item) => item !== path) ?? null);
                        }}
                        type="button"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      aria-label="Split editor"
                      aria-pressed={split}
                      className={`datafort-icon-button ${split ? "is-active" : ""}`}
                      onClick={() => {
                        setSplit((current) => !current);
                        if (!split) setGroupPaths([selectedPath, selectedPath]);
                      }}
                      type="button"
                    >
                      <Split size={14} />
                    </button>
                    <fieldset className="datafort-mode-switch">
                      <legend className="sr-only">Editor mode</legend>
                      {(["live", "source", "reading"] as const).map((nextMode) => (
                        <button
                          className={mode === nextMode ? "is-active" : ""}
                          key={nextMode}
                          onClick={() => changeEditorMode(nextMode)}
                          type="button"
                        >
                          {nextMode === "live" ? (
                            <Eye size={12} />
                          ) : nextMode === "source" ? (
                            <FileText size={12} />
                          ) : (
                            <Eye size={12} />
                          )}
                          {t(`datafort.${nextMode === "live" ? "livePreview" : nextMode}`)}
                        </button>
                      ))}
                    </fieldset>
                  </div>
                </div>
                {saveState === "conflict" && (
                  <div className="datafort-conflict" role="alert">
                    <span>{t("datafort.conflict")}</span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setDocumentReloadToken((current) => current + 1);
                        }}
                        type="button"
                      >
                        {t("datafort.reload")}
                      </button>
                      <button
                        onClick={() => void navigator.clipboard?.writeText(draftRef.current)}
                        type="button"
                      >
                        {t("datafort.copyDraft")}
                      </button>
                    </div>
                    {conflictHash && <span className="sr-only">{conflictHash}</span>}
                  </div>
                )}
                <div className="datafort-editor-stage" key={editorMountKey}>
                  {section === "graph" ? (
                    <div className="datafort-global-graph">
                      <div className="datafort-global-graph-heading">
                        <div>
                          <strong>Grafo global</strong>
                          <span>Links entre todas as notas indexadas</span>
                        </div>
                        <label className="datafort-graph-filter">
                          <span className="sr-only">Filtro do grafo</span>
                          <select
                            aria-label="Filtrar grafo global"
                            onChange={(event) => setGraphFilter(event.target.value as GraphFilter)}
                            value={graphFilter}
                          >
                            <option value="all">Todos</option>
                            <option value="tags">Com tags</option>
                            <option value="folders">Em pastas</option>
                            <option value="attachments">Anexos</option>
                            <option value="orphans">Órfãos</option>
                            <option value="unresolved">Links não resolvidos</option>
                          </select>
                        </label>
                        <Network size={17} />
                      </div>
                      {filteredGlobalGraph ? (
                        <DatafortGraph graph={filteredGlobalGraph} onOpenPath={openPath} />
                      ) : (
                        <div aria-busy="true" className="datafort-graph-loading">
                          <Skeleton className="h-full w-full" />
                          <ProgressIndicator label="Carregando grafo global" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <EnterExit className="h-full min-h-0 w-full" duration="fast" show={split}>
                        <ResizablePanelGroup
                          className="h-full"
                          orientation="horizontal"
                          onLayoutChanged={(layout) => void persistLayout({ splitLayout: layout })}
                        >
                          <ResizablePanel defaultSize={50} minSize={25}>
                            {renderEditorColumn(groupPaths[0], 0)}
                          </ResizablePanel>
                          <ResizableHandle withHandle aria-label="Resize editor group" />
                          <ResizablePanel defaultSize={50} minSize={25}>
                            {renderEditorColumn(groupPaths[1], 1)}
                          </ResizablePanel>
                        </ResizablePanelGroup>
                      </EnterExit>
                      <EnterExit className="h-full min-h-0 w-full" duration="fast" show={!split}>
                        {renderEditorColumn(selectedPath, 0)}
                      </EnterExit>
                    </>
                  )}
                </div>
                <footer className="datafort-statusbar">
                  <span className={`datafort-save-status is-${saveState}`}>
                    <span className="datafort-status-dot" />
                    {t(
                      `datafort.${saveState === "conflict" ? "conflict" : saveState === "editing" ? "editing" : saveState === "saving" ? "saving" : "saved"}`,
                    )}
                  </span>
                  <span className="truncate">{document?.path ?? t("datafort.selectDocument")}</span>
                  <span>{mode === "live" ? t("datafort.livePreview") : t(`datafort.${mode}`)}</span>
                </footer>
              </section>
            </ResizablePanel>

            <ResizableHandle withHandle aria-label="Resize inspector" />
            <ResizablePanel
              className="datafort-inspector-panel"
              collapsible
              collapsedSize={0}
              defaultSize={(settings?.layout.inspector as number | undefined) ?? 23}
              id="datafort-inspector"
              maxSize={34}
              minSize={17}
              panelRef={inspectorPanelRef}
            >
              <EnterExit className="h-full min-h-0" duration="fast" show={showProperties}>
                <aside className="datafort-inspector">
                  <div className="datafort-inspector-header">
                    <span className="datafort-eyebrow">
                      {documentTitle(document, selectedPath)}
                    </span>
                    <button
                      aria-label="Close inspector"
                      className="datafort-icon-button"
                      onClick={() => setShowProperties(false)}
                      type="button"
                    >
                      <PanelRight size={14} />
                    </button>
                  </div>
                  <div className="datafort-inspector-section">
                    <DatafortProperties
                      content={currentContent}
                      onChange={(next) => {
                        draftRef.current = next;
                        setSaveState("editing");
                        setDraftVersion((current) => current + 1);
                      }}
                      readOnly={!document?.writable}
                    />
                  </div>
                  <div className="datafort-inspector-section">
                    <div className="datafort-inspector-heading">
                      <span>
                        <Link2 size={14} /> {t("datafort.backlinks")}
                      </span>
                      <span className="datafort-count">{backlinks.length}</span>
                    </div>
                    {backlinks.length === 0 ? (
                      <p className="datafort-empty-copy">{t("datafort.noLinks")}</p>
                    ) : (
                      backlinks.map((link) => (
                        <button
                          className="datafort-inspector-link"
                          key={link}
                          onClick={() =>
                            openPath(
                              catalog.find((item) => baseName(item.path) === link)?.path ?? link,
                            )
                          }
                          type="button"
                        >
                          <Link2 size={12} />
                          {link}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="datafort-inspector-section">
                    <div className="datafort-inspector-heading">
                      <span>
                        <Link2 size={14} /> {t("datafort.outgoing")}
                      </span>
                      <span className="datafort-count">{links.length}</span>
                    </div>
                    {links.length === 0 ? (
                      <p className="datafort-empty-copy">{t("datafort.noLinks")}</p>
                    ) : (
                      links.map((link) => (
                        <button
                          className="datafort-inspector-link"
                          key={link}
                          onClick={() =>
                            openPath(
                              catalog.find((item) => baseName(item.path) === baseName(link))
                                ?.path ?? link,
                            )
                          }
                          type="button"
                        >
                          <Link2 size={12} />
                          {link}
                        </button>
                      ))
                    )}
                  </div>
                  <div className="datafort-inspector-section">
                    <div className="datafort-inspector-heading">
                      <span>
                        <ListTree size={14} /> {t("datafort.outline")}
                      </span>
                      <span className="datafort-count">{currentHeadings.length}</span>
                    </div>
                    {currentHeadings.map((heading) => (
                      <div
                        className="datafort-outline-row"
                        key={`${heading.depth}-${heading.title}`}
                        style={{ paddingLeft: `${heading.depth * 8}px` }}
                      >
                        {heading.title}
                      </div>
                    ))}
                  </div>
                  <div className="datafort-inspector-section">
                    <div className="datafort-inspector-heading">
                      <span>
                        <Network size={14} /> {t("datafort.graph")}
                      </span>
                      <label className="datafort-graph-depth">
                        <span className="sr-only">Profundidade local</span>
                        <select
                          aria-label="Profundidade do grafo local"
                          onChange={(event) =>
                            setLocalDepth(Number(event.target.value) as 1 | 2 | 3)
                          }
                          value={localDepth}
                        >
                          <option value="1">1 nível</option>
                          <option value="2">2 níveis</option>
                          <option value="3">3 níveis</option>
                        </select>
                      </label>
                    </div>
                    {localGraph.nodes.length > 1 ? (
                      <DatafortGraph compact graph={localGraph} onOpenPath={openPath} />
                    ) : (
                      <p className="datafort-empty-copy">
                        Adicione links para formar o grafo local.
                      </p>
                    )}
                  </div>
                  <div className="datafort-inspector-section">
                    <div className="datafort-inspector-heading">
                      <span>
                        <Tag size={14} /> {t("datafort.tags")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {currentTags.length === 0 ? (
                        <p className="datafort-empty-copy">Sem tags.</p>
                      ) : (
                        currentTags.map((tag) => (
                          <span className="datafort-tag" key={tag}>
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                </aside>
              </EnterExit>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </main>
    </EnterExit>
  );
}

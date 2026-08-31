// MIT License — Copyright (c) 2026 Mateus Gaio

import { lazy, Suspense, type UIEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VaultMemory } from "../../../app/shell/VaultSlot";
import {
  getAttachmentContent,
  getSessionArtifacts,
  getWorkspaceFileContent,
  getWorkspaceFilePdf,
  getWorkspaceFileTree,
  type SessionArtifact,
  searchWorkspace,
  type VaultGraph,
  type VaultNoteDetail,
  type WorkspaceFilePreview,
  type WorkspaceSearchCitation,
  type WorkspaceSearchResponse,
  type WorkspaceTreeEntry,
} from "../../../shared/api/sidecar";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { ProgressIndicator } from "../../../shared/components/motion/ProgressIndicator";
import { Skeleton } from "../../../shared/components/motion/Skeleton";
import { SafeMarkdown } from "../../../shared/components/SafeMarkdown";
import { Button } from "../../../shared/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../../../shared/components/ui/resizable";
import { ScrollArea } from "../../../shared/components/ui/scroll-area";
import { cn } from "../../../shared/lib/utils";
import { VaultNoteIndex } from "./VaultNoteIndex";

const PdfPreview = lazy(() =>
  import("./PdfPreview").then((module) => ({ default: module.PdfPreview })),
);
const VaultNoteEditor = lazy(() =>
  import("./VaultNoteEditor").then((module) => ({ default: module.VaultNoteEditor })),
);
const workbenchMemoryByWorkspace = new Map<string, VaultMemory>();

type FileWorkbenchProps = {
  cursorAvoidanceEnabled: boolean;
  graph: VaultGraph;
  memory: VaultMemory;
  onMemoryChange: (memory: VaultMemory) => void;
  onSelectPath: (path: string | null) => void;
  refreshKey: number;
  selectedPath: string | null;
  sessionId: string | null;
  workspaceId: string;
};

type DirectoryState = {
  entries: WorkspaceTreeEntry[];
  limited: boolean;
  path: string;
};

type AttachmentSelection = {
  filename: string;
  id: string;
};

type PreviewState =
  | {
      content: string;
      kind: WorkspaceFilePreview["kind"];
      name: string;
      path: string;
      size: number;
    }
  | { bytes: Uint8Array; kind: "pdf"; name: string; path: string; size: number };

const treeRowClass =
  "flex w-full items-center gap-1.5 rounded py-1 pr-2 text-left text-[0.78rem] leading-none text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/40 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none";

function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "") || ".";
}

function pathName(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function fallbackFileLabel(name: string) {
  const stem = name.replace(/\.(md|markdown)$/i, "");
  if (!/[_-]/.test(stem)) return name;
  return stem
    .toLocaleLowerCase()
    .split(/[_-]+/)
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function fileLabel(name: string, graph: VaultGraph, path: string) {
  return graph.files.find((file) => file.path === path)?.title ?? fallbackFileLabel(name);
}

function pathAncestors(path: string) {
  const segments = normalizePath(path).split("/").filter(Boolean).slice(0, -1);
  const result: string[] = [];
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    result.push(current);
  }
  return result;
}

function isPdfPath(path: string) {
  return path.toLowerCase().endsWith(".pdf");
}

function isTextPath(path: string) {
  const lower = path.toLowerCase();
  return (
    /\.(c|cc|cpp|css|csv|go|h|hpp|html?|ini|java|js|json|jsx|md|markdown|mjs|py|rb|rs|sh|sql|toml|ts|tsx|txt|yaml|yml)$/.test(
      lower,
    ) || /(^|\/)(readme|license|makefile|dockerfile)$/i.test(path)
  );
}

function displayOperation(operation: SessionArtifact["operation"], t: (key: string) => string) {
  if (operation === "created") return t("vault.created");
  if (operation === "deleted") return t("vault.deleted");
  return t("vault.modified");
}

function citationLabel(citation: WorkspaceSearchCitation) {
  return citation.source === "vault" ? citation.path : citation.filename;
}

function citationExcerpt(citation: WorkspaceSearchCitation) {
  return citation.excerpt.replaceAll(/\s+/g, " ").trim();
}

function TreeGlyph({ kind }: { kind: "file" | "folder-open" | "folder-closed" }) {
  const path =
    kind === "file"
      ? "M5 4h9l4 4v12H5V4Zm9 0v4h4"
      : kind === "folder-open"
        ? "M3 6h5l2 2h11v10H3V6Zm0 8h18"
        : "M3 6h5l2 2h11v10H3V6Z";
  return (
    <svg
      aria-hidden="true"
      className="size-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.75"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  );
}

export function FileWorkbench({
  cursorAvoidanceEnabled,
  graph,
  memory,
  onMemoryChange,
  onSelectPath,
  refreshKey,
  selectedPath,
  sessionId,
  workspaceId,
}: FileWorkbenchProps) {
  const { t } = useTranslation();
  const [directories, setDirectories] = useState<Map<string, DirectoryState>>(new Map());
  const directoryCacheRef = useRef(new Map<string, DirectoryState>());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(new Set());
  const [directoryError, setDirectoryError] = useState("");
  const [artifacts, setArtifacts] = useState<SessionArtifact[]>([]);
  const [artifactsLoading, setArtifactsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<WorkspaceSearchResponse["results"]>([]);
  const [searchMode, setSearchMode] = useState<WorkspaceSearchResponse["mode"] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selectedAttachment, setSelectedAttachment] = useState<AttachmentSelection | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [editorMode, setEditorMode] = useState<"new" | { id: string } | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [noteIndexRefresh, setNoteIndexRefresh] = useState(0);
  const listWrapRef = useRef<HTMLDivElement | null>(null);
  const previewWrapRef = useRef<HTMLDivElement | null>(null);
  const rememberedMemory = workbenchMemoryByWorkspace.get(workspaceId);
  const initialMemory = rememberedMemory ? { ...rememberedMemory, ...memory } : memory;
  const memoryRef = useRef(initialMemory);
  const fileListScrollTopRef = useRef(initialMemory.fileListScrollTop);
  const noteScrollTopRef = useRef(initialMemory.noteScrollTop);
  const noteScrollTopsRef = useRef(initialMemory.noteScrollTops);
  const selectionBeforeSearchRef = useRef<{
    attachment: AttachmentSelection | null;
    path: string | null;
    scrollTop: number;
  }>({ attachment: null, path: null, scrollTop: 0 });
  memoryRef.current = memory;

  const loadDirectory = useCallback(
    async (requestedPath: string, force = false) => {
      const path = normalizePath(requestedPath);
      const cached = directoryCacheRef.current.get(path);
      if (cached && !force) {
        setDirectories((current) => new Map(current).set(path, cached));
        return cached;
      }
      setLoadingDirectories((current) => new Set(current).add(path));
      setDirectoryError("");
      try {
        const result = await getWorkspaceFileTree(workspaceId, path);
        directoryCacheRef.current.set(path, result);
        setDirectories((current) => new Map(current).set(path, result));
        return result;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : t("vault.couldNotReadFiles");
        setDirectoryError(message);
        throw reason;
      } finally {
        setLoadingDirectories((current) => {
          const next = new Set(current);
          next.delete(path);
          return next;
        });
      }
    },
    [t, workspaceId],
  );

  useEffect(() => {
    void refreshKey;
    directoryCacheRef.current.clear();
    setDirectories(new Map());
    setDirectoryError("");
    void loadDirectory(".", true).catch(() => undefined);
  }, [loadDirectory, refreshKey]);

  useEffect(() => {
    void refreshKey;
    let cancelled = false;
    if (!sessionId) {
      setArtifacts([]);
      setArtifactsLoading(false);
      return;
    }
    setArtifactsLoading(true);
    void getSessionArtifacts(workspaceId, sessionId)
      .then((next) => {
        if (!cancelled) setArtifacts(next);
      })
      .catch(() => {
        if (!cancelled) setArtifacts([]);
      })
      .finally(() => {
        if (!cancelled) setArtifactsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, sessionId, workspaceId]);

  useEffect(() => {
    void previewNonce;
    void refreshKey;
    let cancelled = false;
    const selection = selectedAttachment
      ? {
          kind: "attachment" as const,
          id: selectedAttachment.id,
          name: selectedAttachment.filename,
        }
      : selectedPath
        ? { kind: "workspace" as const, path: selectedPath, name: pathName(selectedPath) }
        : null;
    if (!selection) {
      setPreview(null);
      setPreviewError("");
      setPreviewLoading(false);
      return;
    }
    setPreview(null);
    setPreviewError("");
    setPreviewLoading(true);
    const load = async () => {
      try {
        if (selection.kind === "attachment") {
          const result = await getAttachmentContent(workspaceId, selection.id);
          const isPdf =
            result.contentType.includes("pdf") || selection.name.toLowerCase().endsWith(".pdf");
          if (isPdf) {
            if (!cancelled) {
              setPreview({
                bytes: result.bytes,
                kind: "pdf",
                name: selection.name,
                path: selection.name,
                size: result.bytes.byteLength,
              });
            }
          } else if (isTextPath(selection.name) || result.contentType.startsWith("text/")) {
            const content = new TextDecoder().decode(result.bytes);
            if (!cancelled) {
              setPreview({
                content,
                kind: selection.name.toLowerCase().endsWith(".md") ? "markdown" : "text",
                name: selection.name,
                path: selection.name,
                size: result.bytes.byteLength,
              });
            }
          } else {
            throw new Error(t("vault.unsupportedPreview"));
          }
          return;
        }
        if (isPdfPath(selection.path)) {
          const bytes = await getWorkspaceFilePdf(workspaceId, selection.path);
          if (!cancelled)
            setPreview({
              bytes,
              kind: "pdf",
              name: selection.name,
              path: selection.path,
              size: bytes.byteLength,
            });
          return;
        }
        const result = await getWorkspaceFileContent(workspaceId, selection.path);
        if (!cancelled) setPreview({ ...result, name: selection.name });
      } catch (reason) {
        if (!cancelled)
          setPreviewError(reason instanceof Error ? reason.message : t("vault.previewUnavailable"));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [previewNonce, refreshKey, selectedAttachment, selectedPath, t, workspaceId]);

  useEffect(() => {
    void preview;
    if (!selectedPath) return;
    const restore = () => {
      const viewport = previewWrapRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (!viewport) return;
      const top =
        memory.noteScrollTops[selectedPath] ??
        memory.noteScrollTop ??
        noteScrollTopsRef.current[selectedPath] ??
        noteScrollTopRef.current;
      viewport.scrollTop = top;
    };
    restore();
    const frame = requestAnimationFrame(restore);
    return () => cancelAnimationFrame(frame);
  }, [memory, preview, selectedPath]);

  useEffect(
    () => () => {
      const listViewport = listWrapRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      const previewViewport = previewWrapRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      const nextMemory = {
        fileListScrollTop: listViewport?.scrollTop ?? fileListScrollTopRef.current,
        noteScrollTop: previewViewport?.scrollTop ?? noteScrollTopRef.current,
        noteScrollTops: noteScrollTopsRef.current,
      };
      workbenchMemoryByWorkspace.set(workspaceId, nextMemory);
      onMemoryChange(nextMemory);
    },
    [onMemoryChange, workspaceId],
  );

  useEffect(() => {
    const listViewport = listWrapRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    const previewViewport = previewWrapRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    const syncList = () => {
      if (!listViewport) return;
      fileListScrollTopRef.current = listViewport.scrollTop;
      memoryRef.current = {
        ...memoryRef.current,
        fileListScrollTop: listViewport.scrollTop,
      };
      workbenchMemoryByWorkspace.set(workspaceId, memoryRef.current);
      onMemoryChange(memoryRef.current);
    };
    const syncPreview = () => {
      if (!previewViewport || !selectedPath) return;
      noteScrollTopRef.current = previewViewport.scrollTop;
      noteScrollTopsRef.current = {
        ...noteScrollTopsRef.current,
        [selectedPath]: previewViewport.scrollTop,
      };
      memoryRef.current = {
        ...memoryRef.current,
        noteScrollTop: previewViewport.scrollTop,
        noteScrollTops: noteScrollTopsRef.current,
      };
      workbenchMemoryByWorkspace.set(workspaceId, memoryRef.current);
      onMemoryChange(memoryRef.current);
    };
    listViewport?.addEventListener("scroll", syncList);
    previewViewport?.addEventListener("scroll", syncPreview);
    return () => {
      listViewport?.removeEventListener("scroll", syncList);
      previewViewport?.removeEventListener("scroll", syncPreview);
    };
  }, [onMemoryChange, selectedPath, workspaceId]);

  const visibleSearchResults = searchResults;
  const hasSearch = submittedQuery !== null;
  const selectedFile = selectedPath
    ? (graph.files.find((file) => file.path === selectedPath) ?? null)
    : null;

  useEffect(() => {
    void directories.get(".");
    if (selectedPath || hasSearch) return;
    const viewport = listWrapRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    if (viewport) viewport.scrollTop = memoryRef.current.fileListScrollTop;
  }, [directories, hasSearch, selectedPath]);

  async function revealPath(path: string) {
    setSelectedAttachment(null);
    for (const ancestor of pathAncestors(path)) {
      setExpanded((current) => new Set(current).add(ancestor));
      await loadDirectory(ancestor).catch(() => undefined);
    }
    onSelectPath(path);
  }

  function openTreeFile(path: string) {
    if (editorMode) return;
    setSelectedAttachment(null);
    onSelectPath(path);
  }

  function toggleDirectory(path: string) {
    const isExpanded = expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded) void loadDirectory(path).catch(() => undefined);
  }

  function trackListScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute("data-slot") !== "scroll-area-viewport") return;
    fileListScrollTopRef.current = target.scrollTop;
    memoryRef.current = { ...memoryRef.current, fileListScrollTop: target.scrollTop };
    workbenchMemoryByWorkspace.set(workspaceId, memoryRef.current);
    onMemoryChange(memoryRef.current);
  }

  function trackPreviewScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement | null;
    if (target?.getAttribute("data-slot") !== "scroll-area-viewport") return;
    if (!selectedPath) return;
    noteScrollTopRef.current = target.scrollTop;
    noteScrollTopsRef.current = {
      ...noteScrollTopsRef.current,
      [selectedPath]: target.scrollTop,
    };
    memoryRef.current = {
      ...memoryRef.current,
      noteScrollTop: target.scrollTop,
      noteScrollTops: noteScrollTopsRef.current,
    };
    workbenchMemoryByWorkspace.set(workspaceId, memoryRef.current);
    onMemoryChange(memoryRef.current);
  }

  async function submitSearch() {
    const query = searchQuery.trim();
    if (!query || searching) return;
    const viewport = listWrapRef.current?.querySelector<HTMLElement>(
      '[data-slot="scroll-area-viewport"]',
    );
    selectionBeforeSearchRef.current = {
      attachment: selectedAttachment,
      path: selectedPath,
      scrollTop: viewport?.scrollTop ?? memoryRef.current.fileListScrollTop,
    };
    setSubmittedQuery(query);
    setSearching(true);
    setSearchError("");
    setSelectedAttachment(null);
    try {
      const response = await searchWorkspace(workspaceId, query, 20, { includeLifecycle: true });
      setSearchResults(response.results);
      setSearchMode(response.mode);
    } catch (reason) {
      setSearchResults([]);
      setSearchMode(null);
      setSearchError(reason instanceof Error ? reason.message : t("vault.searchError"));
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    const previous = selectionBeforeSearchRef.current;
    setSearchQuery("");
    setSubmittedQuery(null);
    setSearchResults([]);
    setSearchMode(null);
    setSearchError("");
    setSelectedAttachment(previous.attachment);
    onSelectPath(previous.path);
    requestAnimationFrame(() => {
      const viewport = listWrapRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (viewport) viewport.scrollTop = previous.scrollTop;
    });
  }

  function openCitation(citation: WorkspaceSearchCitation) {
    if (editorMode) return;
    if (citation.source === "vault") void revealPath(citation.path);
    else {
      setSelectedAttachment({ filename: citation.filename, id: citation.attachmentId });
      onSelectPath(null);
    }
  }

  function renderDirectory(path: string, depth: number): React.ReactNode {
    const directory = directories.get(path);
    if (!directory) {
      if (loadingDirectories.has(path)) return <Skeleton className="mx-2 my-2 h-6" />;
      return null;
    }
    return directory.entries.map((entry) => {
      const isOpen = entry.kind === "directory" && expanded.has(entry.path);
      if (entry.kind === "directory") {
        return (
          <li key={entry.path}>
            <button
              aria-expanded={isOpen}
              aria-label={`${isOpen ? t("vault.collapseFolder") : t("vault.expandFolder")} ${entry.name}; ${isOpen ? "Recolher" : "Expandir"} ${entry.name}`}
              className={treeRowClass}
              onClick={() => toggleDirectory(entry.path)}
              style={{ paddingLeft: depth * 11 + 6 }}
              title={entry.path}
              type="button"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "transition-transform duration-[120ms] motion-reduce:transition-none",
                  isOpen && "rotate-90",
                )}
              >
                ▸
              </span>
              <TreeGlyph kind={isOpen ? "folder-open" : "folder-closed"} />
              <span className="truncate">{entry.name}</span>
            </button>
            {isOpen && (
              <ul
                className="m-0 list-none border-l border-neutral-800/50 p-0"
                style={{ marginLeft: depth * 11 + 15 }}
              >
                {renderDirectory(entry.path, depth + 1)}
              </ul>
            )}
          </li>
        );
      }
      return (
        <li key={entry.path}>
          <button
            aria-current={selectedPath === entry.path ? "page" : undefined}
            aria-label={fileLabel(entry.name, graph, entry.path)}
            className={cn(
              treeRowClass,
              selectedPath === entry.path && "bg-neutral-800/60 text-foreground",
            )}
            onClick={() => openTreeFile(entry.path)}
            style={{ paddingLeft: depth * 11 + 6 }}
            title={entry.path}
            type="button"
          >
            <span aria-hidden="true" className="w-3 shrink-0" />
            <TreeGlyph kind="file" />
            <span className="truncate">{fileLabel(entry.name, graph, entry.path)}</span>
          </button>
        </li>
      );
    });
  }

  return (
    <section
      aria-label={t("vault.workspaceFiles")}
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2"
    >
      <search>
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submitSearch();
          }}
        >
          <label className="sr-only" htmlFor="vault-file-search">
            {t("vault.searchFiles")}
          </label>
          <input
            className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
            id="vault-file-search"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("vault.searchPlaceholder")}
            type="search"
            value={searchQuery}
          />
          <Button disabled={!searchQuery.trim() || searching} size="sm" type="submit">
            {t("vault.searchFiles")}
          </Button>
          {hasSearch && (
            <Button onClick={clearSearch} size="sm" type="button" variant="ghost">
              {t("vault.clearSearch")}
            </Button>
          )}
        </form>
      </search>
      {searchError && (
        <p className="px-1 text-xs text-destructive" role="alert">
          {searchError}
        </p>
      )}
      {searching && <ProgressIndicator label={t("vault.searchingFiles")} />}

      <ResizablePanelGroup className="min-h-0 flex-1" orientation="horizontal">
        <ResizablePanel className="min-h-0 min-w-0" defaultSize={36} minSize={23}>
          <div
            className="h-full min-h-0 min-w-0"
            onScrollCapture={trackListScroll}
            ref={listWrapRef}
          >
            <ScrollArea className="h-full">
              {hasSearch ? (
                <div className="p-1">
                  {searchMode === "lexical" && (
                    <p className="px-2 py-1 text-[0.68rem] text-muted-foreground">
                      {t("vault.lexicalSearch")}
                    </p>
                  )}
                  {!visibleSearchResults.length && !searching && (
                    <p className="p-2 text-sm text-muted-foreground">
                      {t("vault.noSearchResults")}
                    </p>
                  )}
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {visibleSearchResults.map(({ citation }) => (
                      <li
                        key={`${citation.source}:${citation.source === "vault" ? citation.path : citation.attachmentId}:${citation.chunkIndex}`}
                      >
                        <button
                          className="w-full rounded border border-border/60 px-2 py-1.5 text-left transition-colors duration-[120ms] hover:bg-neutral-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          onClick={() => openCitation(citation)}
                          type="button"
                        >
                          <span className="block truncate text-xs text-foreground">
                            {citationLabel(citation)}
                          </span>
                          <span className="mt-0.5 block line-clamp-2 text-[0.68rem] text-muted-foreground">
                            {citationExcerpt(citation)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="p-1">
                  <VaultNoteIndex
                    onNewNote={() => {
                      setSelectedAttachment(null);
                      setEditorMode("new");
                      setEditorVisible(true);
                    }}
                    onOpenNote={(note) => {
                      setSelectedAttachment(null);
                      onSelectPath(note.path);
                      setEditorMode({ id: note.portentId });
                      setEditorVisible(true);
                    }}
                    onSelectPath={(path) => {
                      setEditorMode(null);
                      void revealPath(path);
                    }}
                    refreshKey={refreshKey + noteIndexRefresh}
                    workspaceId={workspaceId}
                  />
                  <section
                    aria-label={t("vault.generatedByAgent")}
                    className="mb-2 border-b border-border/60 pb-2"
                  >
                    <h2 className="px-2 py-1 font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase">
                      {t("vault.generatedByAgent")}
                    </h2>
                    {artifactsLoading && <Skeleton className="mx-2 my-1 h-6" />}
                    {!artifactsLoading && !artifacts.length && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">
                        {t("vault.noSessionArtifacts")}
                      </p>
                    )}
                    <ul className="m-0 grid list-none gap-0.5 p-0">
                      {artifacts.map((artifact) => (
                        <li key={artifact.path}>
                          <button
                            className={cn(
                              treeRowClass,
                              selectedPath === artifact.path && "bg-neutral-800/60 text-foreground",
                            )}
                            onClick={() => void revealPath(artifact.path)}
                            title={artifact.path}
                            type="button"
                          >
                            <TreeGlyph kind="file" />
                            <span className="min-w-0 flex-1 truncate">
                              {pathName(artifact.path)}
                            </span>
                            <span
                              className={cn(
                                "shrink-0 text-[0.62rem]",
                                artifact.operation === "deleted" && "text-destructive",
                              )}
                            >
                              {displayOperation(artifact.operation, t)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                  {directoryError && (
                    <p className="px-2 py-1 text-xs text-destructive" role="alert">
                      {directoryError}
                    </p>
                  )}
                  {directories.get(".")?.limited && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      {t("vault.treeLimited")}
                    </p>
                  )}
                  {!directories.has(".") && loadingDirectories.has(".") && (
                    <Skeleton className="mx-2 my-2 h-20" />
                  )}
                  {directories.has(".") && (
                    <ul className="m-0 grid list-none gap-0.5 p-0">{renderDirectory(".", 0)}</ul>
                  )}
                </div>
              )}
            </ScrollArea>
          </div>
        </ResizablePanel>
        <ResizableHandle aria-label={t("vault.resizeExplorer")} />
        <ResizablePanel className="min-h-0 min-w-0" minSize={34}>
          <section
            aria-label={t("vault.filePreview")}
            className="flex h-full min-h-0 min-w-0 flex-col"
          >
            <header className="min-w-0 border-b border-border/60 px-3 py-2">
              <p className="truncate font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground">
                {preview?.path ??
                  selectedPath ??
                  selectedAttachment?.filename ??
                  t("vault.selectFileToPreview")}
              </p>
              {(preview || selectedPath || selectedAttachment) && (
                <h2 className="mt-1 truncate text-sm font-medium">
                  {preview?.name ?? selectedAttachment?.filename ?? pathName(selectedPath ?? "")}
                </h2>
              )}
              {selectedFile?.managed && selectedFile.object?.id && !editorMode && (
                <Button
                  className="mt-2"
                  onClick={() => {
                    setEditorMode({ id: selectedFile.object?.id ?? "" });
                    setEditorVisible(true);
                  }}
                  size="xs"
                  variant="outline"
                >
                  {t("vault.editNote")}
                </Button>
              )}
              {selectedFile && selectedFile.managed === false && (
                <p className="mt-1 text-[0.68rem] text-muted-foreground">
                  {t("vault.externalFileReadOnly")}
                </p>
              )}
            </header>
            <div
              className="min-h-0 flex-1"
              onScrollCapture={trackPreviewScroll}
              ref={previewWrapRef}
            >
              <ScrollArea className="h-full">
                {editorMode && (
                  <Suspense
                    fallback={
                      <div className="p-3">
                        <Skeleton className="h-64" />
                      </div>
                    }
                  >
                    <VaultNoteEditor
                      onClose={() => setEditorVisible(false)}
                      onExited={() => {
                        setEditorMode(null);
                        setEditorVisible(false);
                      }}
                      onSaved={(note: VaultNoteDetail) => {
                        setNoteIndexRefresh((value) => value + 1);
                        onSelectPath(note.path);
                        setPreviewNonce((value) => value + 1);
                      }}
                      portentId={editorMode === "new" ? null : editorMode.id}
                      relationOptions={graph.files.flatMap((file) =>
                        file.managed && file.object?.id
                          ? [{ id: file.object.id, title: file.title }]
                          : [],
                      )}
                      visible={editorVisible}
                      workspaceId={workspaceId}
                    />
                  </Suspense>
                )}
                {!editorMode && (
                  <>
                    {previewLoading && (
                      <div aria-busy="true" className="p-3">
                        <Skeleton className="h-48" />
                      </div>
                    )}
                    {!previewLoading && previewError && (
                      <div className="p-3" role="alert">
                        <p className="text-sm text-destructive">{previewError}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("vault.previewMetadataHint")}
                        </p>
                        <Button
                          className="mt-3"
                          onClick={() => setPreviewNonce((value) => value + 1)}
                          size="sm"
                          variant="outline"
                        >
                          {t("vault.retryPreview")}
                        </Button>
                      </div>
                    )}
                    {!previewLoading && !previewError && !preview && (
                      <p className="p-3 text-sm text-muted-foreground">
                        {t("vault.selectFileToPreview")}
                      </p>
                    )}
                    <EnterExit
                      show={!previewLoading && Boolean(preview)}
                      className="min-h-0"
                      instant={false}
                    >
                      {preview?.kind === "pdf" ? (
                        <Suspense
                          fallback={
                            <div className="p-3">
                              <Skeleton className="h-48" />
                            </div>
                          }
                        >
                          <PdfPreview bytes={preview.bytes} />
                        </Suspense>
                      ) : preview ? (
                        <article className="vault-file-preview px-3 pb-6 pt-2">
                          {preview.kind === "markdown" ? (
                            <SafeMarkdown
                              content={preview.content}
                              cursorAvoidanceEnabled={cursorAvoidanceEnabled}
                              currentPath={preview.path}
                              files={graph.files}
                              onLocalLink={(path) => void revealPath(path)}
                            />
                          ) : (
                            <pre className="max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
                              {preview.content}
                            </pre>
                          )}
                        </article>
                      ) : null}
                    </EnterExit>
                  </>
                )}
              </ScrollArea>
            </div>
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  );
}

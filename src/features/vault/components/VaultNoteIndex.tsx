// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  listVaultDiagnostics,
  listVaultNotes,
  type VaultDiagnostic,
  type VaultNoteSummary,
} from "../../../shared/api/sidecar";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { Skeleton } from "../../../shared/components/motion/Skeleton";
import { Button } from "../../../shared/components/ui/button";
import { cn } from "../../../shared/lib/utils";

type VaultNoteIndexProps = {
  onNewNote: () => void;
  onOpenNote: (note: VaultNoteSummary) => void;
  onSelectPath: (path: string) => void;
  refreshKey: number;
  workspaceId: string;
};

type Filter = "all" | "inbox" | "organized" | "archived" | "problems";

const filterClass =
  "rounded px-1.5 py-1 text-[0.68rem] transition-colors duration-[120ms] hover:bg-neutral-800/50";

function noteStatusLabel(note: VaultNoteSummary, t: (key: string) => string) {
  if (note.status === "captured") return t("vault.statusCaptured");
  if (note.status === "archived") return t("vault.statusArchived");
  return t("vault.statusOrganized");
}

function DiagnosticRow({
  diagnostic,
  onSelectPath,
}: {
  diagnostic: VaultDiagnostic;
  onSelectPath: (path: string) => void;
}) {
  return (
    <li>
      <button
        className="w-full rounded border border-destructive/20 px-2 py-1.5 text-left hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => onSelectPath(diagnostic.path)}
        type="button"
      >
        <span className="block truncate text-xs text-destructive">{diagnostic.code}</span>
        <span className="mt-0.5 block truncate text-[0.68rem] text-muted-foreground">
          {diagnostic.path}
        </span>
      </button>
    </li>
  );
}

export function VaultNoteIndex({
  onNewNote,
  onOpenNote,
  onSelectPath,
  refreshKey,
  workspaceId,
}: VaultNoteIndexProps) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<Filter>("all");
  const [notes, setNotes] = useState<VaultNoteSummary[]>([]);
  const [diagnostics, setDiagnostics] = useState<VaultDiagnostic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void refreshKey;
    let cancelled = false;
    setLoading(true);
    setError("");
    const load =
      filter === "problems"
        ? listVaultDiagnostics(workspaceId, { page: 1, pageSize: 25 }).then((result) => {
            if (!cancelled) setDiagnostics(result.diagnostics);
          })
        : listVaultNotes(workspaceId, {
            page: 1,
            pageSize: 50,
            status:
              filter === "inbox"
                ? "captured"
                : filter === "organized" || filter === "archived"
                  ? filter
                  : undefined,
          }).then((result) => {
            if (!cancelled) setNotes(result.notes);
          });
    void load
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t("vault.notesLoadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, refreshKey, t, workspaceId]);

  const filters: Array<[Filter, string]> = [
    ["all", t("vault.filterAll")],
    ["inbox", t("vault.filterInbox")],
    ["organized", t("vault.filterOrganized")],
    ["archived", t("vault.filterArchived")],
    ["problems", t("vault.filterProblems")],
  ];

  return (
    <section aria-label={t("vault.noteIndex")} className="mb-2 border-b border-border/60 pb-2">
      <div className="flex items-center justify-between gap-2 px-2 py-1">
        <h2 className="font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase">
          {t("vault.noteIndex")}
        </h2>
        <Button onClick={onNewNote} size="xs" variant="outline">
          {t("vault.newNote")}
        </Button>
      </div>
      <fieldset
        aria-label={t("vault.noteFilters")}
        className="m-0 flex min-w-0 flex-wrap gap-0.5 border-0 px-1 pb-1"
      >
        {filters.map(([value, label]) => (
          <button
            aria-pressed={filter === value}
            className={cn(filterClass, filter === value && "bg-neutral-800/70 text-foreground")}
            key={value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {label}
          </button>
        ))}
      </fieldset>
      {loading && (
        <div className="grid gap-1 px-2">
          <Skeleton className="h-7" />
          <Skeleton className="h-7" />
        </div>
      )}
      {!loading && error && (
        <p className="px-2 py-1 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && filter !== "problems" && !notes.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("vault.noNotesInFilter")}</p>
      )}
      {!loading && !error && filter !== "problems" && notes.length > 0 && (
        <ul className="m-0 grid list-none gap-0.5 p-1">
          {notes.map((note) => (
            <li key={note.portentId}>
              <button
                className="w-full rounded px-2 py-1.5 text-left hover:bg-neutral-800/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() => onOpenNote(note)}
                type="button"
              >
                <span className="block truncate text-xs text-foreground">{note.title}</span>
                <span className="mt-0.5 block truncate text-[0.65rem] text-muted-foreground">
                  {noteStatusLabel(note, t)} · {note.path}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!loading && !error && filter === "problems" && !diagnostics.length && (
        <p className="px-2 py-1 text-xs text-muted-foreground">{t("vault.noDiagnostics")}</p>
      )}
      {!loading && !error && filter === "problems" && diagnostics.length > 0 && (
        <EnterExit as="div" show className="px-1">
          <ul className="m-0 grid list-none gap-1 p-0">
            {diagnostics.map((diagnostic) => (
              <DiagnosticRow
                diagnostic={diagnostic}
                key={`${diagnostic.path}:${diagnostic.code}:${diagnostic.target ?? ""}`}
                onSelectPath={onSelectPath}
              />
            ))}
          </ul>
        </EnterExit>
      )}
    </section>
  );
}

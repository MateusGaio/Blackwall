// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createVaultNote,
  deleteVaultNote,
  getVaultNote,
  patchVaultNote,
  SidecarApiError,
  type VaultNoteDetail,
  type VaultNoteStatus,
  type VaultNoteType,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { ProgressIndicator } from "../../../shared/components/motion/ProgressIndicator";
import { Skeleton } from "../../../shared/components/motion/Skeleton";
import { SafeMarkdown } from "../../../shared/components/SafeMarkdown";
import { Button } from "../../../shared/components/ui/button";
import { Textarea } from "../../../shared/components/ui/textarea";

type VaultNoteEditorProps = {
  onClose: () => void;
  onExited: () => void;
  onSaved: (note: VaultNoteDetail) => void;
  portentId: string | null;
  relationOptions: Array<{ id: string; title: string }>;
  visible: boolean;
  workspaceId: string;
};

type Draft = {
  belongsTo: string | null;
  body: string;
  relatedTo: string[];
  status: VaultNoteStatus;
  title: string;
  type: VaultNoteType;
};

const emptyDraft: Draft = {
  belongsTo: null,
  body: "",
  relatedTo: [],
  status: "captured",
  title: "",
  type: "Note",
};

function draftFromNote(note: VaultNoteDetail): Draft {
  return {
    belongsTo: note.belongsTo?.portentId ?? null,
    body: note.body,
    relatedTo: note.relatedTo.map((target) => target.portentId),
    status: note.status,
    title: note.title,
    type: note.type,
  };
}

export function VaultNoteEditor({
  onClose,
  onExited,
  onSaved,
  portentId,
  relationOptions,
  visible,
  workspaceId,
}: VaultNoteEditorProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState<VaultNoteDetail | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(Boolean(portentId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflictHash, setConflictHash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"close" | "delete" | null>(null);
  const dirty = useMemo(
    () =>
      Boolean(
        note
          ? draft.body !== note.body ||
              draft.title !== note.title ||
              draft.type !== note.type ||
              draft.status !== note.status ||
              draft.belongsTo !== (note.belongsTo?.portentId ?? null) ||
              draft.relatedTo.join(",") !==
                note.relatedTo.map((target) => target.portentId).join(",")
          : draft.title || draft.body || draft.belongsTo || draft.relatedTo.length,
      ),
    [draft, note],
  );

  useEffect(() => {
    let cancelled = false;
    setError("");
    setConflictHash(null);
    if (!portentId) {
      setNote(null);
      setDraft(emptyDraft);
      setLoading(false);
      return;
    }
    setLoading(true);
    void getVaultNote(workspaceId, portentId)
      .then((next) => {
        if (!cancelled) {
          setNote(next);
          setDraft(draftFromNote(next));
        }
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t("vault.editorLoadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [portentId, t, workspaceId]);

  function requestClose() {
    if (dirty) setConfirm("close");
    else onClose();
  }

  async function save() {
    if (saving) return;
    if (portentId && !note) {
      setError(t("vault.editorLoadError"));
      return;
    }
    if (!draft.title.trim()) {
      setError(t("vault.editorTitleRequired"));
      return;
    }
    setSaving(true);
    setError("");
    setConflictHash(null);
    try {
      const result =
        portentId && note
          ? await patchVaultNote(workspaceId, portentId, {
              belongsTo: draft.belongsTo,
              body: draft.body,
              expectedHash: note.contentHash,
              relatedTo: draft.relatedTo,
              status: draft.status,
              title: draft.title,
              type: draft.type,
            })
          : await createVaultNote(workspaceId, {
              belongsTo: draft.belongsTo,
              body: draft.body,
              relatedTo: draft.relatedTo,
              status: draft.status,
              title: draft.title,
              type: draft.type,
            });
      setNote(result.note);
      setDraft(draftFromNote(result.note));
      onSaved(result.note);
    } catch (reason) {
      if (reason instanceof SidecarApiError && reason.errorCode === "vault_note_conflict") {
        setConflictHash(reason.currentHash ?? null);
        setError(t("vault.editorConflict"));
      } else setError(reason instanceof Error ? reason.message : t("vault.editorSaveError"));
    } finally {
      setSaving(false);
    }
  }

  async function reloadAfterConflict() {
    if (!portentId) return;
    setLoading(true);
    setError("");
    try {
      const next = await getVaultNote(workspaceId, portentId);
      setNote(next);
      setDraft(draftFromNote(next));
      setConflictHash(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("vault.editorLoadError"));
    } finally {
      setLoading(false);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(`# ${draft.title}\n\n${draft.body}`);
      setError(t("vault.editorDraftCopied"));
    } catch {
      setError(t("vault.editorCopyUnavailable"));
    }
  }

  async function remove() {
    if (!portentId || !note) return;
    setSaving(true);
    try {
      await deleteVaultNote(workspaceId, portentId, note.contentHash);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("vault.editorDeleteError"));
    } finally {
      setSaving(false);
      setConfirm(null);
    }
  }

  return (
    <EnterExit className="flex min-h-0 flex-1 flex-col" onExited={onExited} show={visible}>
      <section
        aria-label={t("vault.editorTitle")}
        className="flex min-h-0 flex-1 flex-col gap-3 p-3"
      >
        <header className="flex items-start justify-between gap-3 border-b border-border/60 pb-2">
          <div className="min-w-0">
            <p className="font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase">
              {portentId ? t("vault.editNote") : t("vault.newNote")}
            </p>
            <h2 className="truncate text-sm font-medium">
              {draft.title || t("vault.untitledNote")}
            </h2>
          </div>
          <Button onClick={requestClose} size="sm" variant="ghost">
            {t("vault.closeEditor")}
          </Button>
        </header>
        {loading && (
          <div aria-busy="true" className="grid gap-2">
            <Skeleton className="h-8" />
            <Skeleton className="h-52" />
          </div>
        )}
        {!loading && (
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid gap-3">
              <label className="grid gap-1 text-xs text-muted-foreground">
                {t("vault.noteTitle")}
                <input
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, title: event.target.value }))
                  }
                  value={draft.title}
                />
              </label>
              <div className="grid gap-2 rounded-lg border border-border/60 p-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("vault.belongsTo")}
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, belongsTo: event.target.value || null }))
                    }
                    value={draft.belongsTo ?? ""}
                  >
                    <option value="">{t("vault.noRelation")}</option>
                    {relationOptions
                      .filter((option) => option.id !== portentId)
                      .map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.title}
                        </option>
                      ))}
                  </select>
                </label>
                <fieldset className="grid gap-1">
                  <legend className="text-xs text-muted-foreground">{t("vault.relatedTo")}</legend>
                  {relationOptions
                    .filter((option) => option.id !== portentId)
                    .map((option) => (
                      <label
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                        key={option.id}
                      >
                        <input
                          checked={draft.relatedTo.includes(option.id)}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              relatedTo: event.target.checked
                                ? [...current.relatedTo, option.id]
                                : current.relatedTo.filter((id) => id !== option.id),
                            }))
                          }
                          type="checkbox"
                        />
                        <span className="truncate">{option.title}</span>
                      </label>
                    ))}
                </fieldset>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("vault.noteType")}
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        type: event.target.value as VaultNoteType,
                      }))
                    }
                    value={draft.type}
                  >
                    <option value="Note">Note</option>
                    <option value="Project">Project</option>
                    <option value="Event">Event</option>
                    <option value="Topic">Topic</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  {t("vault.noteStatus")}
                  <select
                    className="h-8 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        status: event.target.value as VaultNoteStatus,
                      }))
                    }
                    value={draft.status}
                  >
                    <option value="captured">{t("vault.statusCaptured")}</option>
                    <option value="organized">{t("vault.statusOrganized")}</option>
                    <option value="archived">{t("vault.statusArchived")}</option>
                  </select>
                </label>
              </div>
              <div className="grid gap-1 text-xs text-muted-foreground">
                {t("vault.noteBody")}
                <Textarea
                  aria-label={t("vault.noteBody")}
                  className="min-h-48 resize-y font-mono text-xs leading-relaxed"
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, body: event.target.value }))
                  }
                  value={draft.body}
                />
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/20 p-2">
                <p className="mb-2 text-xs text-muted-foreground">{t("vault.preview")}</p>
                <SafeMarkdown content={draft.body} currentPath={note?.path} files={[]} />
              </div>
            </div>
          </div>
        )}
        <EnterExit as="div" className="text-xs text-destructive" show={Boolean(error)}>
          <p aria-live="assertive" role="alert">
            {error}
            {conflictHash ? ` (${t("vault.currentHash")}: ${conflictHash.slice(0, 12)}…)` : ""}
          </p>
        </EnterExit>
        {saving && <ProgressIndicator label={t("vault.savingNote")} />}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <div className="flex gap-2">
            <Button
              disabled={saving || loading || (Boolean(portentId) && !note)}
              onClick={() => void save()}
              size="sm"
            >
              {t("vault.saveNote")}
            </Button>
            {portentId && (
              <Button
                disabled={saving || loading}
                onClick={() => setConfirm("delete")}
                size="sm"
                variant="destructive"
              >
                {t("vault.deleteNote")}
              </Button>
            )}
          </div>
          {conflictHash && (
            <div className="flex gap-2">
              <Button onClick={() => void reloadAfterConflict()} size="sm" variant="outline">
                {t("vault.reloadNote")}
              </Button>
              <Button onClick={() => void copyDraft()} size="sm" variant="ghost">
                {t("vault.copyDraft")}
              </Button>
            </div>
          )}
        </footer>
        {confirm === "close" && (
          <ConfirmDialog
            description={t("vault.discardDraftDescription")}
            onCancel={() => setConfirm(null)}
            onConfirm={onClose}
            title={t("vault.discardDraft")}
          />
        )}
        {confirm === "delete" && (
          <ConfirmDialog
            confirmLabel={t("vault.deleteNote")}
            description={t("vault.deleteNoteDescription")}
            onCancel={() => setConfirm(null)}
            onConfirm={() => void remove()}
            title={t("vault.deleteNote")}
          />
        )}
      </section>
    </EnterExit>
  );
}

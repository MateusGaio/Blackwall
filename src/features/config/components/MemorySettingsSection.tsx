// MIT License — Copyright (c) 2026 Mateus Gaio

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/shared/components/ConfirmDialog";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { ProgressIndicator } from "@/shared/components/motion/ProgressIndicator";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { Button } from "@/shared/components/ui/button";
import {
  approveMemoryCandidate,
  deleteProfileMemory,
  discardMemoryCandidate,
  getMemoryActivity,
  getMemorySettings,
  listProfileMemories,
  type MemoryActivity,
  type MemorySettings,
  type ProfileMemory,
  retryMemoryJob,
  updateMemorySettings,
  updateProfileMemory,
} from "../../../shared/api/sidecar";

const DISCLOSURE_VERSION = "f2.9-v1";

type MemorySettingsSectionProps = { profileId: string | null };

export function MemorySettingsSection({ profileId }: MemorySettingsSectionProps) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [memories, setMemories] = useState<ProfileMemory[]>([]);
  const [activity, setActivity] = useState<MemoryActivity | null>(null);
  const [filter, setFilter] = useState<"organized" | "captured" | "archived">("organized");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProfileMemory | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const reload = useCallback(async () => {
    if (!profileId) return;
    setLoading(true);
    setError("");
    try {
      const [nextSettings, nextMemories, nextActivity] = await Promise.all([
        getMemorySettings(profileId),
        listProfileMemories(profileId, filter),
        getMemoryActivity(profileId),
      ]);
      setSettings(nextSettings);
      setLimit(nextSettings.maxDailyJobs);
      setMemories(nextMemories.items);
      setActivity(nextActivity);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.memoryCouldNotLoad"));
    } finally {
      setLoading(false);
    }
  }, [filter, profileId, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const showInitialSkeleton = loading && !settings;

  const statusLabel = useMemo(() => {
    if (!settings?.automaticEnabled) return t("settings.memoryPaused");
    if (settings.pausedReason === "daily_limit") return t("settings.memoryDailyLimit");
    if (settings.pausedReason) return t("settings.memoryError");
    return t("settings.memoryActive");
  }, [settings, t]);

  async function saveSettings(enabled: boolean, acceptDisclosure = false) {
    if (!profileId) return;
    setBusy(true);
    setError("");
    try {
      const next = await updateMemorySettings(profileId, {
        acceptDisclosure,
        automaticEnabled: enabled,
        disclosureVersion: enabled ? DISCLOSURE_VERSION : undefined,
        maxDailyJobs: limit,
      });
      setSettings(next);
      setStatus(enabled ? t("settings.memoryEnabled") : t("settings.memoryDisabled"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.memoryCouldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  async function saveMemory(memory: ProfileMemory, statement: string) {
    if (!profileId) return;
    setBusy(true);
    setError("");
    try {
      await updateProfileMemory(profileId, memory.id, {
        expectedHash: memory.revisionHash,
        statement,
      });
      setEditing(null);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.memoryCouldNotSave"));
    } finally {
      setBusy(false);
    }
  }

  if (!profileId) return null;

  return (
    <div aria-busy={busy || loading} className="grid gap-6" data-testid="memory-settings-section">
      {busy && <ProgressIndicator label={t("motion.progressBusy")} />}
      <EnterExit duration="base" show={showInitialSkeleton}>
        <div className="grid gap-3" data-testid="memory-settings-skeleton">
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-44 rounded-[var(--radius-panel)]" />
          <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
        </div>
      </EnterExit>
      <EnterExit duration="base" show={!showInitialSkeleton}>
        <div className="grid gap-6">
          <section className="rounded-[var(--radius-panel)] border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                  {t("settings.memory")}
                </p>
                <h3 className="mt-1 text-sm font-medium">{t("settings.memoryLearningTitle")}</h3>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {t("settings.memoryLearningDescription")}
                </p>
              </div>
              <label className="flex shrink-0 items-center gap-2 text-xs">
                <input
                  aria-label={t("settings.memoryToggle")}
                  checked={Boolean(settings?.automaticEnabled)}
                  className="size-4 accent-foreground"
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.checked) setConfirmEnable(true);
                    else void saveSettings(false);
                  }}
                  type="checkbox"
                />
                {statusLabel}
              </label>
            </div>
            <div className="mt-5 grid gap-3 border-t border-border pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div>
                <label className="text-xs font-medium" htmlFor="memory-daily-limit">
                  {t("settings.memoryDailyLimitLabel")}
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.memoryDailyLimitDescription")}
                </p>
              </div>
              <input
                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-sm"
                id="memory-daily-limit"
                max={100}
                min={1}
                onChange={(event) =>
                  setLimit(Math.max(1, Math.min(100, Number(event.target.value) || 1)))
                }
                type="number"
                value={limit}
              />
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                disabled={busy}
                onClick={() => void saveSettings(Boolean(settings?.automaticEnabled))}
                size="sm"
                variant="secondary"
              >
                {t("settings.save")}
              </Button>
            </div>
            {status && (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                {status}
              </p>
            )}
            {error && (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {error}
              </p>
            )}
          </section>

          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">{t("settings.memoryLearnedTitle")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("settings.memoryLearnedDescription")}
                </p>
              </div>
              <fieldset aria-label={t("settings.memoryFilters")} className="flex gap-1">
                {(["organized", "captured", "archived"] as const).map((value) => (
                  <button
                    aria-pressed={filter === value}
                    className="rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
                    key={value}
                    onClick={() => setFilter(value)}
                    type="button"
                  >
                    {t(`settings.memoryFilter${value[0].toUpperCase()}${value.slice(1)}`)}
                  </button>
                ))}
              </fieldset>
            </div>
            {!memories.length && (
              <p className="rounded-md border border-dashed border-border p-5 text-sm text-muted-foreground">
                {t("settings.memoryEmpty")}
              </p>
            )}
            <div className="grid gap-2">
              {memories.map((memory) => (
                <EnterExit as="div" duration="base" key={memory.id} show>
                  <article className="rounded-md border border-border bg-card p-4">
                    {editing === memory.id ? (
                      <div className="grid gap-2">
                        <textarea
                          className="min-h-20 rounded-md border border-input bg-background p-2 text-sm"
                          onChange={(event) => setDraft(event.target.value)}
                          value={draft}
                        />
                        <div className="flex gap-2">
                          <Button
                            disabled={busy}
                            onClick={() => void saveMemory(memory, draft)}
                            size="sm"
                          >
                            {t("settings.save")}
                          </Button>
                          <Button onClick={() => setEditing(null)} size="sm" variant="ghost">
                            {t("settings.cancel")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm">{memory.statement}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {memory.kind} ·{" "}
                          {t("settings.memoryEvidence", { count: memory.evidenceCount })}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            onClick={() => {
                              setEditing(memory.id);
                              setDraft(memory.statement);
                            }}
                            size="sm"
                            variant="ghost"
                          >
                            {t("settings.edit")}
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void updateProfileMemory(profileId, memory.id, {
                                expectedHash: memory.revisionHash,
                                pinned: !memory.pinned,
                              })
                                .then(reload)
                                .catch((reason) =>
                                  setError(
                                    reason instanceof Error
                                      ? reason.message
                                      : t("settings.memoryCouldNotSave"),
                                  ),
                                )
                            }
                            size="sm"
                            variant="ghost"
                          >
                            {memory.pinned ? t("settings.memoryUnpin") : t("settings.memoryPin")}
                          </Button>
                          <Button
                            disabled={busy}
                            onClick={() =>
                              void updateProfileMemory(profileId, memory.id, {
                                expectedHash: memory.revisionHash,
                                status: memory.status === "archived" ? "organized" : "archived",
                              })
                                .then(reload)
                                .catch((reason) =>
                                  setError(
                                    reason instanceof Error
                                      ? reason.message
                                      : t("settings.memoryCouldNotSave"),
                                  ),
                                )
                            }
                            size="sm"
                            variant="ghost"
                          >
                            {memory.status === "archived"
                              ? t("settings.memoryRestore")
                              : t("settings.memoryArchive")}
                          </Button>
                          <Button onClick={() => setDeleteTarget(memory)} size="sm" variant="ghost">
                            {t("settings.delete")}
                          </Button>
                        </div>
                      </>
                    )}
                  </article>
                </EnterExit>
              ))}
            </div>
          </section>

          <section className="grid gap-3">
            <div>
              <h3 className="text-sm font-medium">{t("settings.memoryActivityTitle")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("settings.memoryActivityDescription")}
              </p>
            </div>
            {activity?.jobs.map((job) => (
              <div
                className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-xs"
                key={job.id}
              >
                <span>
                  {t(`settings.memoryJob${job.status[0].toUpperCase()}${job.status.slice(1)}`, {
                    defaultValue: job.status,
                  })}
                </span>
                {job.status === "failed" && (
                  <Button
                    onClick={() =>
                      void retryMemoryJob(profileId, job.id)
                        .then(reload)
                        .catch((reason) =>
                          setError(
                            reason instanceof Error
                              ? reason.message
                              : t("settings.memoryCouldNotSave"),
                          ),
                        )
                    }
                    size="sm"
                    variant="ghost"
                  >
                    {t("settings.memoryRetry")}
                  </Button>
                )}
              </div>
            ))}
            {activity?.candidates.map((candidate) => (
              <div className="rounded-md border border-border p-3" key={candidate.id}>
                <p className="text-sm">{candidate.body || t("settings.memoryCandidateScrubbed")}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.scope} · {candidate.kind} · {candidate.reasonCode}
                </p>
                {candidate.disposition === "needs_review" && candidate.body && (
                  <div className="mt-2 flex gap-2">
                    <Button
                      onClick={() =>
                        void approveMemoryCandidate(profileId, candidate.id)
                          .then(reload)
                          .catch((reason) =>
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : t("settings.memoryCouldNotSave"),
                            ),
                          )
                      }
                      size="sm"
                    >
                      {t("settings.memoryApprove")}
                    </Button>
                    <Button
                      onClick={() =>
                        void discardMemoryCandidate(profileId, candidate.id)
                          .then(reload)
                          .catch((reason) =>
                            setError(
                              reason instanceof Error
                                ? reason.message
                                : t("settings.memoryCouldNotSave"),
                            ),
                          )
                      }
                      size="sm"
                      variant="ghost"
                    >
                      {t("settings.memoryDiscard")}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </div>
      </EnterExit>

      {confirmEnable && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.memoryActivate")}
          description={t("settings.memoryDisclosure")}
          headingLabel={t("settings.confirmation")}
          onCancel={() => setConfirmEnable(false)}
          onConfirm={() => {
            setConfirmEnable(false);
            void saveSettings(true, true);
          }}
          title={t("settings.memoryActivateTitle")}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.delete")}
          description={t("settings.memoryDeleteDescription")}
          headingLabel={t("settings.confirmation")}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void deleteProfileMemory(profileId, target.id, target.revisionHash)
              .then(reload)
              .catch((reason) =>
                setError(
                  reason instanceof Error ? reason.message : t("settings.memoryCouldNotSave"),
                ),
              );
          }}
          title={t("settings.memoryDeleteTitle")}
        />
      )}
    </div>
  );
}

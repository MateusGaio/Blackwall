// MIT License — Copyright (c) 2026 Mateus Gaio

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { extractMemories, MemoryExtractorError } from "./memory-extractor.js";
import {
  canAutoCaptureWorkspace,
  MEMORY_DISCLOSURE_VERSION,
  sourceRevisionHash,
} from "./memory-policy.js";
import {
  commitExtractedCandidates,
  ensureMemorySettings,
  finishMemoryJob,
  listWorkspaceCandidates,
  markWorkspaceCandidateCaptured,
  releaseMemoryJob,
  renewMemoryJob,
  retryMemoryJob,
} from "./memory-store.js";
import { isRetryableProviderError } from "./streaming.js";
import { recordProviderUsage } from "./usage.js";

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;

type MemoryJob = {
  id: string;
  attempts: number;
  profileId: string;
  requestId: string;
  sessionId: string | null;
  sourceRevisionHash: string;
  sourceModelId: string;
  sourceProviderId: string;
  turnMessageId: string;
  workspaceId: string | null;
};

type ClaimedMemoryJob = MemoryJob & { leaseToken: string };

function safeJobCode(error: unknown) {
  if (error instanceof MemoryExtractorError) return error.code;
  if (error instanceof Error && error.name === "AbortError") return "cancelled";
  return isRetryableProviderError(error) ? "provider_transient" : "memory_extract_failed";
}

export function createMemoryWorker(input: {
  client: Database.Database;
  dataDirectory?: string;
  extract?: typeof extractMemories;
  onEvent?: (event: Record<string, unknown>) => void;
  onWorkspaceCandidate?: (candidate: {
    body: string;
    proposedType: "Project" | "Event" | "Note" | "Topic";
    title: string;
    workspaceId: string;
  }) => Promise<boolean>;
  pollMs?: number;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let runningController: AbortController | undefined;
  let activePromise: Promise<void> | undefined;
  const emit = (type: string, payload: Record<string, unknown> = {}) =>
    input.onEvent?.({ eventId: randomUUID(), type, ...payload });

  function recoverLeases() {
    const now = Date.now();
    input.client
      .prepare(
        "UPDATE memory_capture_jobs SET status = CASE WHEN attempts >= ? THEN 'failed' ELSE 'pending' END, error_code = CASE WHEN attempts >= ? THEN 'retry_exhausted' ELSE error_code END, lease_token = NULL, locked_at = NULL, updated_at = ? WHERE trigger = 'automatic' AND pipeline_version = 'v2' AND status = 'running' AND (locked_at IS NULL OR locked_at < ?)",
      )
      .run(MAX_ATTEMPTS, MAX_ATTEMPTS, now, now - LEASE_MS);
  }

  function claim(): ClaimedMemoryJob | null {
    const now = Date.now();
    return input.client.transaction(() => {
      const job = input.client
        .prepare(
          "SELECT id, profile_id AS profileId, workspace_id AS workspaceId, session_id AS sessionId, request_id AS requestId, turn_message_id AS turnMessageId, source_revision_hash AS sourceRevisionHash, source_provider_id AS sourceProviderId, source_model_id AS sourceModelId, attempts FROM memory_capture_jobs WHERE trigger = 'automatic' AND pipeline_version = 'v2' AND status = 'pending' AND available_at <= ? ORDER BY priority DESC, available_at, created_at LIMIT 1",
        )
        .get(now) as (MemoryJob & { sourceProviderId: string; sourceModelId: string }) | undefined;
      if (!job) return null;
      const settings = ensureMemorySettings(input.client, job.profileId);
      if (!settings.automaticEnabled || settings.disclosureVersion !== MEMORY_DISCLOSURE_VERSION) {
        input.client
          .prepare(
            "UPDATE memory_capture_jobs SET status = 'cancelled', cancel_reason = 'automatic_disabled', input_json = '{}', finished_at = ?, scrubbed_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(now, now, now, job.id);
        return null;
      }
      if (job.attempts >= MAX_ATTEMPTS) {
        input.client
          .prepare(
            "UPDATE memory_capture_jobs SET status = 'failed', error_code = 'retry_exhausted', input_json = '{}', finished_at = ?, scrubbed_at = ?, updated_at = ? WHERE id = ?",
          )
          .run(now, now, now, job.id);
        return null;
      }
      const leaseToken = randomUUID();
      const updated = input.client
        .prepare(
          "UPDATE memory_capture_jobs SET status = 'running', attempts = attempts + 1, lease_token = ?, locked_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        )
        .run(leaseToken, now, now, job.id);
      if (updated.changes !== 1) return null;
      return { ...job, attempts: job.attempts + 1, leaseToken };
    })();
  }

  async function processOnce() {
    if (stopped) return;
    recoverLeases();
    const job = claim();
    if (!job) return;
    emit("memory.capture.started", { jobId: job.id, profileId: job.profileId, status: "running" });
    const controller = new AbortController();
    runningController = controller;
    let providerCalled = false;
    const leaseRenewal = setInterval(
      () => {
        if (!renewMemoryJob(input.client, job.id, job.leaseToken)) controller.abort();
      },
      Math.floor(LEASE_MS / 2),
    );
    try {
      const source = input.client
        .prepare("SELECT id, role, content FROM messages WHERE id = ? AND session_id = ?")
        .get(job.turnMessageId, job.sessionId) as
        | { id: string; role: string; content: string }
        | undefined;
      if (source?.role !== "user")
        throw Object.assign(new Error("source_unavailable"), { code: "source_unavailable" });
      if (sourceRevisionHash(source.id, source.content) !== job.sourceRevisionHash)
        throw Object.assign(new Error("source_edited"), { code: "source_edited" });
      providerCalled = true;
      const result = await (input.extract ?? extractMemories)({
        dataDirectory: input.dataDirectory,
        modelId: job.sourceModelId,
        providerId: job.sourceProviderId,
        signal: controller.signal,
        sourceText: source.content,
      });
      recordProviderUsage(input.client, {
        attemptId: `${job.id}:${job.attempts}`,
        modelId: job.sourceModelId,
        observedAt: Date.now(),
        profileId: job.profileId,
        providerId: job.sourceProviderId,
        purpose: "memory_extract",
        requestId: `${job.requestId}:memory`,
        sessionId: job.sessionId ?? undefined,
        status: "completed",
        tokens: result.tokens,
        windows: result.windows,
      });
      const committed = commitExtractedCandidates(input.client, job, result.candidates);
      if (input.onWorkspaceCandidate && job.workspaceId && committed.review.length) {
        for (const candidate of listWorkspaceCandidates(input.client, committed.review)) {
          if (
            !canAutoCaptureWorkspace({
              confidence: candidate.confidence,
              kind: candidate.kind as "decision" | "fact" | "incident",
              reasonCode: "important_decision",
              scope: "workspace",
              statement: candidate.body,
              subject: candidate.title,
              value: candidate.body,
            })
          )
            continue;
          const created = await input.onWorkspaceCandidate({
            body: candidate.body,
            proposedType:
              (candidate.proposedType as "Project" | "Event" | "Note" | "Topic" | null) ?? "Note",
            title: candidate.title,
            workspaceId: job.workspaceId,
          });
          if (created) markWorkspaceCandidateCaptured(input.client, candidate.id);
        }
      }
      finishMemoryJob(input.client, job.id, job.leaseToken, "succeeded");
      emit("memory.capture.committed", {
        candidateCount: result.candidates.length,
        committedCount: committed.committed.length,
        jobId: job.id,
        profileId: job.profileId,
        reviewCount: committed.review.length,
        status: "succeeded",
      });
      if (committed.committed.length)
        emit("profile.memory.updated", {
          count: committed.committed.length,
          profileId: job.profileId,
          status: "organized",
        });
    } catch (error) {
      const code = safeJobCode(error);
      if (providerCalled)
        recordProviderUsage(input.client, {
          attemptId: `${job.id}:${job.attempts}`,
          errorCode: code,
          modelId: job.sourceModelId,
          observedAt: Date.now(),
          profileId: job.profileId,
          providerId: job.sourceProviderId,
          purpose: "memory_extract",
          requestId: `${job.requestId}:memory`,
          sessionId: job.sessionId ?? undefined,
          status: "failed",
        });
      if (controller.signal.aborted || code === "cancelled") {
        releaseMemoryJob(input.client, job.id, job.leaseToken);
        emit("memory.capture.failed", {
          errorCode: "stopped",
          jobId: job.id,
          profileId: job.profileId,
          status: "pending",
        });
      } else if (isRetryableProviderError(error) && job.attempts < MAX_ATTEMPTS) {
        retryMemoryJob(
          input.client,
          job.id,
          job.leaseToken,
          code,
          Date.now() + Math.min(30_000, 500 * 2 ** (job.attempts - 1)),
        );
        emit("memory.capture.failed", {
          errorCode: code,
          jobId: job.id,
          profileId: job.profileId,
          status: "pending",
        });
      } else {
        finishMemoryJob(input.client, job.id, job.leaseToken, "failed", code);
        emit("memory.capture.failed", {
          errorCode: code,
          jobId: job.id,
          profileId: job.profileId,
          status: "failed",
        });
      }
    } finally {
      clearInterval(leaseRenewal);
      runningController = undefined;
    }
  }

  function schedule() {
    if (stopped || timer) return;
    timer = setTimeout(async () => {
      timer = undefined;
      activePromise = processOnce();
      await activePromise;
      activePromise = undefined;
      schedule();
    }, input.pollMs ?? 250);
  }

  return {
    async start() {
      if (!stopped) return;
      stopped = false;
      recoverLeases();
      schedule();
    },
    wake() {
      if (!stopped && !activePromise) {
        if (timer) clearTimeout(timer);
        timer = undefined;
        schedule();
      }
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      runningController?.abort();
      if (activePromise) await activePromise;
    },
    processOnce,
    recoverLeases,
  };
}

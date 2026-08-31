// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";
import { isMemorySourceEligible, redactMemoryInput } from "./memory-intent.js";

export const MEMORY_PIPELINE_VERSION = "v2" as const;
export const MEMORY_DISCLOSURE_VERSION = "f2.9-v1" as const;

export type MemoryScope = "profile" | "workspace" | "unassigned";
export type MemoryKind =
  | "preference"
  | "constraint"
  | "habit"
  | "communication"
  | "decision"
  | "fact"
  | "incident";
export type MemoryReasonCode =
  | "user_preference"
  | "repeated_behavior"
  | "important_decision"
  | "constraint"
  | "incident_or_root_cause"
  | "correction";

export type ExtractedMemoryCandidate = {
  confidence: number;
  kind: MemoryKind;
  proposedType?: "Project" | "Event" | "Note" | "Topic";
  reasonCode: MemoryReasonCode;
  scope: MemoryScope;
  statement: string;
  subject: string;
  value: string;
};

const profileKinds = new Set<MemoryKind>(["preference", "constraint", "habit", "communication"]);
const technicalKinds = new Set<MemoryKind>(["decision", "fact", "incident"]);

export function sourceRevisionHash(messageId: string, exactContent: string) {
  return createHash("sha256").update(messageId).update(exactContent, "utf8").digest("hex");
}

export function memoryIdempotencyKey(input: {
  profileId: string;
  sessionId?: string | null;
  sourceRevisionHash: string;
  turnMessageId: string;
  workspaceId?: string | null;
}) {
  return createHash("sha256")
    .update(
      [
        input.profileId,
        input.workspaceId ?? "unassigned",
        input.sessionId ?? "",
        input.turnMessageId,
        input.sourceRevisionHash,
        "automatic",
        MEMORY_PIPELINE_VERSION,
      ].join("\0"),
    )
    .digest("hex");
}

export function normalizedMemoryKey(
  candidate: Pick<ExtractedMemoryCandidate, "scope" | "kind" | "subject" | "value">,
) {
  return [candidate.scope, candidate.kind, candidate.subject, candidate.value]
    .map((part) =>
      part
        .normalize("NFKC")
        .toLocaleLowerCase()
        .replace(/[\s\p{P}]+/gu, " ")
        .trim(),
    )
    .join("\0");
}

export function profileSlotKey(candidate: Pick<ExtractedMemoryCandidate, "kind" | "subject">) {
  return `${candidate.kind}:${candidate.subject
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96)}`;
}

export function sanitizeExtractedCandidate(
  candidate: ExtractedMemoryCandidate,
  workspaceId?: string | null,
): ExtractedMemoryCandidate | null {
  const subject = redactMemoryInput(candidate.subject).slice(0, 120).trim();
  const value = redactMemoryInput(candidate.value).slice(0, 1000).trim();
  const statement = redactMemoryInput(candidate.statement).slice(0, 1000).trim();
  if (!subject || !value || !statement) return null;
  const scope = technicalKinds.has(candidate.kind)
    ? workspaceId
      ? "workspace"
      : "unassigned"
    : candidate.scope === "profile"
      ? "profile"
      : workspaceId
        ? "workspace"
        : "unassigned";
  if (scope === "profile" && !profileKinds.has(candidate.kind)) return null;
  if (!isMemorySourceEligible(statement)) return null;
  return {
    confidence: Math.max(0, Math.min(1, candidate.confidence)),
    kind: candidate.kind,
    ...(candidate.proposedType ? { proposedType: candidate.proposedType } : {}),
    reasonCode: candidate.reasonCode,
    scope,
    statement,
    subject,
    value,
  };
}

export function canAutoOrganizeProfile(candidate: ExtractedMemoryCandidate, evidenceCount: number) {
  return (
    candidate.scope === "profile" &&
    profileKinds.has(candidate.kind) &&
    candidate.confidence >= 0.95 &&
    (candidate.reasonCode === "user_preference" ||
      candidate.reasonCode === "constraint" ||
      evidenceCount >= 3)
  );
}

export function canAutoCaptureWorkspace(candidate: ExtractedMemoryCandidate) {
  return (
    candidate.scope !== "profile" &&
    technicalKinds.has(candidate.kind) &&
    candidate.confidence >= 0.9
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, WorkspaceSearchCitation } from "../../../../shared/api/sidecar";
import { EnterExit } from "../../../../shared/components/motion/EnterExit";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const path = value.trim().replaceAll("\\", "/");
  return !path.startsWith("/") && !/^[A-Za-z]:\//.test(path) && !path.split("/").includes("..");
}

function parseCitation(value: unknown): WorkspaceSearchCitation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.contentHash !== "string" ||
    !value.contentHash ||
    typeof value.excerpt !== "string" ||
    !value.excerpt.trim() ||
    typeof value.chunkIndex !== "number" ||
    !Number.isSafeInteger(value.chunkIndex) ||
    value.chunkIndex < 0
  )
    return null;
  if (
    value.source === "vault" &&
    typeof value.objectId === "string" &&
    value.objectId &&
    typeof value.title === "string" &&
    value.title &&
    isRelativePath(value.path)
  ) {
    return {
      chunkIndex: value.chunkIndex,
      contentHash: value.contentHash,
      excerpt: value.excerpt,
      objectId: value.objectId,
      path: value.path.replaceAll("\\", "/").trim(),
      source: "vault",
      title: value.title,
    };
  }
  if (
    value.source === "attachment" &&
    typeof value.attachmentId === "string" &&
    value.attachmentId &&
    isRelativePath(value.filename)
  ) {
    return {
      attachmentId: value.attachmentId,
      chunkIndex: value.chunkIndex,
      contentHash: value.contentHash,
      excerpt: value.excerpt,
      filename: value.filename.trim(),
      source: "attachment",
    };
  }
  return null;
}

/** Deriva somente citações de resultados persistidos da ferramenta de busca. */
export function searchReferencesFromToolMessages(
  steps: readonly ChatMessage[],
): WorkspaceSearchCitation[] {
  const references: WorkspaceSearchCitation[] = [];
  const seen = new Set<string>();
  for (const step of steps) {
    if (step.role !== "tool" || step.toolName !== "search_workspace") continue;
    let result: unknown;
    try {
      result = JSON.parse(step.content);
    } catch {
      continue;
    }
    if (!isRecord(result) || !Array.isArray(result.results)) continue;
    for (const item of result.results) {
      const citation = isRecord(item) ? parseCitation(item.citation) : null;
      if (!citation) continue;
      const identifier = citation.source === "vault" ? citation.objectId : citation.attachmentId;
      const key = `${citation.source}\0${identifier}\0${citation.chunkIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(citation);
    }
  }
  return references;
}

export function SearchReferencesDisclosure({ steps }: { steps: readonly ChatMessage[] }) {
  const { t } = useTranslation();
  const references = searchReferencesFromToolMessages(steps);
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const contentId = `search-references-${useId().replaceAll(":", "")}`;

  if (references.length === 0) return null;

  const label = open
    ? t("chat.referencesHide")
    : t("chat.referencesShow", { count: references.length });

  return (
    <section className="mt-1 w-full max-w-[640px]" data-testid="search-references">
      <button
        aria-controls={contentId}
        aria-expanded={open}
        aria-label={label}
        className="group inline-flex items-center gap-1 rounded px-1 py-0.5 font-mono text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        onClick={(event) => {
          setInstant(event.detail === 0);
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-90" : ""} ${instant ? "!transition-none" : ""}`}
        >
          ›
        </span>
        {label}
      </button>
      <EnterExit
        className="overflow-hidden"
        duration="base"
        instant={instant}
        offsetPx={2}
        show={open}
      >
        <ol
          aria-label={t("chat.referencesList")}
          className="m-0 grid list-none gap-2 border-l border-border py-2 pl-3 pr-1"
          id={contentId}
        >
          {references.map((reference) => {
            const name = reference.source === "vault" ? reference.title : reference.filename;
            const path = reference.source === "vault" ? reference.path : reference.filename;
            return (
              <li
                className="min-w-0 text-xs leading-snug"
                key={`${reference.source}-${reference.source === "vault" ? reference.objectId : reference.attachmentId}-${reference.chunkIndex}`}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono">
                  <span className="text-foreground/80">
                    {reference.source === "vault"
                      ? t("chat.referenceVault")
                      : t("chat.referenceAttachment")}
                  </span>
                  <span className="text-foreground">{name}</span>
                  <code className="text-muted-foreground">{path}</code>
                  <span className="text-muted-foreground">
                    {t("chat.referenceChunk", { count: reference.chunkIndex + 1 })}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">
                  {reference.excerpt}
                </p>
              </li>
            );
          })}
        </ol>
      </EnterExit>
    </section>
  );
}

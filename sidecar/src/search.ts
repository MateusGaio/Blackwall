// MIT License — Copyright (c) 2026 Mateus Gaio

import type Database from "better-sqlite3";
import { type AttachmentLexicalSearchResult, searchAttachmentsDetailed } from "./attachments.js";
import {
  type DatafortAttachmentSearchResult,
  searchDatafortAttachmentsDetailed,
} from "./datafort-attachments.js";
import { chunkVaultObject } from "./embedding-chunks.js";
import { getEmbeddingSourceState } from "./embedding-state.js";
import { sanitizeEmbeddingErrorCode } from "./embeddings.js";
import {
  attachmentEmbeddingTableName,
  type VaultEmbeddingService,
  vaultEmbeddingTableName,
} from "./vault-embeddings.js";
import { searchVaultDetailed, type VaultLexicalSearchResult } from "./vault-index.js";
import { parseMarkdownObject } from "./vault-portent.js";

const RRF_K = 60;

type VaultCitation = {
  chunkIndex: number;
  contentHash: string;
  excerpt: string;
  objectId: string;
  path: string;
  source: "vault";
  title: string;
};

type AttachmentCitation = {
  attachmentId: string;
  chunkIndex: number;
  contentHash: string;
  excerpt: string;
  filename: string;
  path?: string;
  source: "attachment";
};

type SearchCitation = VaultCitation | AttachmentCitation;

export type WorkspaceSearchResponse = {
  mode: "hybrid" | "lexical";
  results: Array<{ citation: SearchCitation }>;
  semanticUnavailable?: string;
};

type RankedCandidate = {
  citation: SearchCitation;
  key: string;
  rank: number;
};

type VectorCandidate = {
  _distance?: unknown;
  attachmentId?: unknown;
  chunkIndex?: unknown;
  contentHash?: unknown;
  filename?: unknown;
  model?: unknown;
  objectId?: unknown;
  path?: unknown;
  text?: unknown;
  title?: unknown;
  vector?: unknown;
  workspaceId?: unknown;
};

function citationId(citation: SearchCitation) {
  return citation.source === "vault" ? citation.objectId : citation.attachmentId;
}

function citationKey(citation: SearchCitation) {
  return `${citation.source}\0${citationId(citation)}\0${citation.chunkIndex}`;
}

function citationOrder(left: SearchCitation, right: SearchCitation) {
  const source = left.source.localeCompare(right.source);
  if (source) return source;
  const id = citationId(left).localeCompare(citationId(right));
  return id || left.chunkIndex - right.chunkIndex;
}

export function fuseRankedSearchLists(lists: RankedCandidate[][], limit: number) {
  const fused = new Map<string, { citation: SearchCitation; score: number }>();
  for (const list of lists) {
    for (const candidate of list) {
      const current = fused.get(candidate.key);
      const score = 1 / (RRF_K + candidate.rank);
      if (current) current.score += score;
      else fused.set(candidate.key, { citation: candidate.citation, score });
    }
  }
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || citationOrder(left.citation, right.citation))
    .slice(0, limit)
    .map(({ citation }) => ({ citation }));
}

function lexicalRanked(candidates: Array<{ citation: SearchCitation; rank: number }>) {
  return candidates.map((candidate) => ({
    ...candidate,
    key: citationKey(candidate.citation),
  }));
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function distanceValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function validText(value: unknown) {
  return typeof value === "string" ? value : null;
}

function verifyVaultVector(
  client: Database.Database,
  workspaceId: string,
  candidate: VectorCandidate,
  options: { includeLifecycle?: boolean } = {},
): VaultCitation | null {
  if (candidate.workspaceId !== workspaceId) return null;
  const objectId = validText(candidate.objectId);
  const path = validText(candidate.path);
  const contentHash = validText(candidate.contentHash);
  const storedText = validText(candidate.text);
  const chunkIndex = numberValue(candidate.chunkIndex);
  if (!objectId || !path || !contentHash || !storedText || chunkIndex === null || chunkIndex < 0)
    return null;
  const row = client
    .prepare(
      `SELECT row_id AS objectId, path, title, content_hash AS contentHash,
              body, source_content AS sourceContent, managed, status
       FROM vault_objects
       WHERE workspace_id = ? AND row_id = ?`,
    )
    .get(workspaceId, objectId) as
    | {
        body: string;
        contentHash: string;
        managed: number;
        objectId: string;
        path: string;
        sourceContent: string;
        status: string | null;
        title: string;
      }
    | undefined;
  if (!row || row.path !== path || row.contentHash !== contentHash) return null;
  if (!options.includeLifecycle && row.managed === 1 && row.status !== "organized") return null;
  const body = row.sourceContent ? parseMarkdownObject(row.sourceContent, row.path).body : row.body;
  const chunks = chunkVaultObject(row.title, body);
  const excerpt = chunks[chunkIndex];
  if (!excerpt || excerpt !== storedText) return null;
  return {
    chunkIndex,
    contentHash: row.contentHash,
    excerpt,
    objectId: row.objectId,
    path: row.path,
    source: "vault",
    title: row.title,
  };
}

function verifyAttachmentVector(
  client: Database.Database,
  workspaceId: string,
  candidate: VectorCandidate,
): AttachmentCitation | null {
  if (candidate.workspaceId !== workspaceId) return null;
  const attachmentId = validText(candidate.attachmentId);
  const contentHash = validText(candidate.contentHash);
  const storedText = validText(candidate.text);
  const chunkIndex = numberValue(candidate.chunkIndex);
  if (!attachmentId || !contentHash || !storedText || chunkIndex === null || chunkIndex < 0)
    return null;
  const row = client
    .prepare(
      `SELECT id AS attachmentId, filename, sha256 AS contentHash
       FROM attachments
       WHERE workspace_id = ? AND id = ?`,
    )
    .get(workspaceId, attachmentId) as
    | { attachmentId: string; contentHash: string; filename: string }
    | undefined;
  if (!row || row.contentHash !== contentHash) return null;
  const chunk = client
    .prepare(
      `SELECT content AS excerpt
       FROM attachments_fts
       WHERE attachment_id = ? AND chunk_index = ?`,
    )
    .get(attachmentId, chunkIndex) as { excerpt: string } | undefined;
  if (!chunk || chunk.excerpt !== storedText) return null;
  return {
    attachmentId: row.attachmentId,
    chunkIndex,
    contentHash: row.contentHash,
    excerpt: chunk.excerpt,
    filename: row.filename,
    source: "attachment",
  };
}

function semanticRanked(
  rows: unknown[],
  verify: (candidate: VectorCandidate) => SearchCitation | null,
) {
  return rows
    .map((value, index) => {
      const candidate = value as VectorCandidate;
      const citation = verify(candidate);
      return citation ? { citation, distance: distanceValue(candidate._distance), index } : null;
    })
    .filter(
      (value): value is { citation: SearchCitation; distance: number; index: number } => !!value,
    )
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        citationOrder(left.citation, right.citation) ||
        left.index - right.index,
    )
    .map((value, index) => ({
      citation: value.citation,
      key: citationKey(value.citation),
      rank: index + 1,
    }));
}

export async function searchWorkspace(
  client: Database.Database,
  embeddings: VaultEmbeddingService,
  workspaceId: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
  options: { includeLifecycle?: boolean } = {},
): Promise<WorkspaceSearchResponse> {
  const vaultLexical = searchVaultDetailed(client, workspaceId, query, 20, options);
  const attachmentLexical = searchAttachmentsDetailed(client, workspaceId, query, 20);
  const datafortAttachmentLexical = searchDatafortAttachmentsDetailed(
    client,
    workspaceId,
    query,
    20,
  );
  const lexicalLists = [
    lexicalRanked(
      vaultLexical.map((candidate: VaultLexicalSearchResult) => ({
        citation: { ...candidate, source: "vault" } satisfies VaultCitation,
        rank: candidate.lexicalRank,
      })),
    ),
    lexicalRanked(
      attachmentLexical.map((candidate: AttachmentLexicalSearchResult) => ({
        citation: {
          attachmentId: candidate.attachmentId,
          chunkIndex: candidate.chunkIndex,
          contentHash: candidate.contentHash,
          excerpt: candidate.excerpt,
          filename: candidate.filename,
          source: "attachment",
        } satisfies AttachmentCitation,
        rank: candidate.lexicalRank,
      })),
    ),
    lexicalRanked(
      datafortAttachmentLexical.map((candidate: DatafortAttachmentSearchResult) => ({
        citation: {
          attachmentId: candidate.attachmentId,
          chunkIndex: candidate.chunkIndex,
          contentHash: candidate.contentHash,
          excerpt: candidate.excerpt,
          filename: candidate.filename,
          path: candidate.path,
          source: "attachment",
        } satisfies AttachmentCitation,
        rank: candidate.lexicalRank,
      })),
    ),
  ];

  const config = await embeddings.getConfig(workspaceId);
  if (config.state !== "ready") {
    return { mode: "lexical", results: fuseRankedSearchLists(lexicalLists, limit) };
  }

  let queryVector: number[];
  try {
    const vectors = await embeddings.embedTexts(workspaceId, [query], signal);
    if (!Array.isArray(vectors[0])) throw new Error("embedding_query_vector_invalid");
    queryVector = vectors[0];
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      mode: "lexical",
      results: fuseRankedSearchLists(lexicalLists, limit),
      semanticUnavailable: sanitizeEmbeddingErrorCode(error),
    };
  }

  const attachmentState = getEmbeddingSourceState(client, workspaceId, "attachment");
  const searches = await Promise.allSettled([
    embeddings.searchNamedTable(vaultEmbeddingTableName(workspaceId), queryVector, 20),
    attachmentState.state === "ready"
      ? embeddings.searchNamedTable(attachmentEmbeddingTableName(workspaceId), queryVector, 20)
      : Promise.resolve([]),
  ]);
  const semanticLists: RankedCandidate[][] = [];
  const semanticErrors: string[] = [];
  const vaultRows = searches[0];
  if (vaultRows.status === "fulfilled") {
    semanticLists.push(
      semanticRanked(vaultRows.value, (candidate) =>
        verifyVaultVector(client, workspaceId, candidate, options),
      ),
    );
  } else {
    semanticErrors.push(sanitizeEmbeddingErrorCode(vaultRows.reason));
  }
  const attachmentRows = searches[1];
  if (attachmentRows.status === "fulfilled") {
    semanticLists.push(
      semanticRanked(attachmentRows.value, (candidate) =>
        verifyAttachmentVector(client, workspaceId, candidate),
      ),
    );
  } else {
    semanticErrors.push(sanitizeEmbeddingErrorCode(attachmentRows.reason));
  }

  return {
    mode: "hybrid",
    results: fuseRankedSearchLists([...lexicalLists, ...semanticLists], limit),
    ...(semanticErrors.length ? { semanticUnavailable: semanticErrors[0] } : {}),
  };
}

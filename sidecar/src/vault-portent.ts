// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash } from "node:crypto";
import { basename, extname } from "node:path";
import YAML from "yaml";

const PORTENT_TYPES = ["Project", "Event", "Note", "Topic"] as const;
const PORTENT_STATUSES = ["captured", "organized", "archived"] as const;

type PortentType = (typeof PORTENT_TYPES)[number];
type PortentStatus = (typeof PORTENT_STATUSES)[number];
type PortentRelationKind = "belongs_to" | "related_to" | "body_link" | "markdown_link";
export type RelationResolution = "resolved" | "broken" | "ambiguous";

export type VaultDiagnostic = {
  code:
    | "frontmatter-invalid"
    | "frontmatter-too-large"
    | "managed-field-invalid"
    | "relation-cardinality"
    | "relation-broken"
    | "relation-ambiguous";
  message: string;
  path: string;
  target?: string;
};

export type PortentObject = {
  body: string;
  createdAt?: string;
  confidence?: number;
  id?: string;
  path: string;
  revisionId?: string;
  source?: string;
  sourceKind?: string;
  status?: PortentStatus | string;
  title: string;
  type?: PortentType | string;
  typeSupport: "builtin" | "external" | "unknown";
  updatedAt?: string;
};

export type ParsedMarkdownObject = {
  body: string;
  diagnostics: VaultDiagnostic[];
  frontmatter: Record<string, unknown>;
  managed: boolean;
  object: PortentObject;
};

const maxFrontmatterSize = 256_000;
const maxYamlDepth = 8;
const frontmatterPattern = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function depthOf(value: unknown, depth = 0): number {
  if (!isRecord(value) && !Array.isArray(value)) return depth;
  const values = Array.isArray(value) ? value : Object.values(value);
  return values.reduce((maximum, item) => Math.max(maximum, depthOf(item, depth + 1)), depth);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isoValue(value: unknown) {
  const candidate = stringValue(value);
  if (!candidate) return undefined;
  return Number.isNaN(Date.parse(candidate)) ? undefined : new Date(candidate).toISOString();
}

function normalizeBody(body: string) {
  return body
    .replace(/^\r?\n/, "")
    .replace(/\s+$/, "")
    .trim()
    ? `${body.replace(/^\r?\n/, "").replace(/\s+$/, "")}\n`
    : "";
}

function titleFor(frontmatter: Record<string, unknown>, body: string, path: string) {
  return (
    stringValue(frontmatter.title) ??
    body.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    basename(path, extname(path))
  );
}

export function parseMarkdownObject(content: string, path: string): ParsedMarkdownObject {
  const diagnostics: VaultDiagnostic[] = [];
  const match = content.match(frontmatterPattern);
  let frontmatter: Record<string, unknown> = {};
  const body = match ? content.slice(match[0].length) : content;

  if (match) {
    const yamlSource = match[1];
    if (yamlSource.length > maxFrontmatterSize) {
      diagnostics.push({
        code: "frontmatter-too-large",
        message: "Frontmatter excede o limite seguro de tamanho.",
        path,
      });
    } else {
      try {
        const parsed = YAML.parse(yamlSource, { schema: "core" });
        if (!isRecord(parsed) || depthOf(parsed) > maxYamlDepth) throw new Error("shape");
        frontmatter = parsed;
      } catch {
        diagnostics.push({
          code: "frontmatter-invalid",
          message: "Frontmatter YAML inválido ou profundo demais; arquivo tratado como legado.",
          path,
        });
      }
    }
  }

  const type = stringValue(frontmatter.type);
  const status = stringValue(frontmatter.status);
  const typeSupport = !type
    ? "unknown"
    : (PORTENT_TYPES as readonly string[]).includes(type)
      ? "builtin"
      : "external";
  const managedSource = frontmatter.source === "blackwall";
  const managedFieldsValid =
    managedSource &&
    Boolean(stringValue(frontmatter.id)) &&
    Boolean(stringValue(frontmatter.title)) &&
    typeSupport === "builtin" &&
    Boolean(status && PORTENT_STATUSES.includes(status as PortentStatus)) &&
    Boolean(isoValue(frontmatter.created_at)) &&
    Boolean(isoValue(frontmatter.updated_at));

  if (managedSource && !managedFieldsValid) {
    diagnostics.push({
      code: "managed-field-invalid",
      message: "Objeto Blackwall sem os campos Portent gerenciados obrigatórios.",
      path,
    });
  }

  const related = frontmatter.related_to;
  if (related !== undefined && !Array.isArray(related)) {
    diagnostics.push({
      code: "relation-cardinality",
      message: "related_to deve ser uma lista de referências.",
      path,
    });
  }
  if (Array.isArray(frontmatter.belongs_to)) {
    diagnostics.push({
      code: "relation-cardinality",
      message: "belongs_to aceita no máximo uma referência.",
      path,
    });
  }

  const confidence =
    typeof frontmatter.confidence === "number" ? frontmatter.confidence : undefined;
  return {
    body,
    diagnostics,
    frontmatter,
    managed: managedFieldsValid,
    object: {
      body,
      createdAt: isoValue(frontmatter.created_at),
      confidence,
      id: stringValue(frontmatter.id),
      path,
      revisionId: stringValue(frontmatter.revision_id),
      source: stringValue(frontmatter.source),
      sourceKind: stringValue(frontmatter.source_kind),
      status,
      title: titleFor(frontmatter, body, path),
      type,
      typeSupport,
      updatedAt: isoValue(frontmatter.updated_at),
    },
  };
}

function orderedFrontmatter(frontmatter: Record<string, unknown>) {
  const known = [
    "id",
    "title",
    "type",
    "status",
    "created_at",
    "updated_at",
    "source",
    "source_kind",
    "belongs_to",
    "related_to",
    "revision_id",
    "confidence",
  ];
  const result: Record<string, unknown> = {};
  for (const key of known) if (key in frontmatter) result[key] = frontmatter[key];
  for (const key of Object.keys(frontmatter).sort())
    if (!(key in result)) result[key] = frontmatter[key];
  return result;
}

export function serializePortentMarkdown(frontmatter: Record<string, unknown>, body: string) {
  const yaml = YAML.stringify(orderedFrontmatter(frontmatter), { sortMapEntries: false }).trimEnd();
  return `---\n${yaml}\n---\n\n${normalizeBody(body)}`;
}

export function contentHash(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export function relationReferences(parsed: ParsedMarkdownObject) {
  const references: Array<{ kind: PortentRelationKind; targetRef: string }> = [];
  const belongsTo = stringValue(parsed.frontmatter.belongs_to);
  if (belongsTo) references.push({ kind: "belongs_to", targetRef: belongsTo });
  const relatedTo = Array.isArray(parsed.frontmatter.related_to)
    ? parsed.frontmatter.related_to
    : [];
  for (const value of relatedTo) {
    const reference = stringValue(value);
    if (reference) references.push({ kind: "related_to", targetRef: reference });
  }
  for (const match of parsed.body.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
    references.push({ kind: "body_link", targetRef: match[1].trim() });
  }
  for (const match of parsed.body.matchAll(/\[[^\]]+\]\(([^)#]+\.(?:md|markdown))\)/gi)) {
    references.push({ kind: "markdown_link", targetRef: match[1].trim() });
  }
  return references;
}

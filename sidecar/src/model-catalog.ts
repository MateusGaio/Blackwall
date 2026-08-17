// MIT License — Copyright (c) 2026 Mateus Gaio

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type FetchLike = typeof fetch;

const CATALOG_URL = "https://models.dev/api.json";
const CACHE_FILE = "model-catalog.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type ModelLimits = {
  contextLimit?: number;
  outputLimit?: number;
};

/** Limits indexed by normalized provider endpoint, then by model id. */
type CatalogIndex = Record<string, Record<string, ModelLimits>>;

type CachedCatalog = {
  etag?: string;
  fetchedAt: number;
  index: CatalogIndex;
};

type RawCatalog = Record<
  string,
  {
    api?: string;
    models?: Record<string, { limit?: { context?: unknown; output?: unknown } }>;
  }
>;

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/**
 * Providers are matched by endpoint rather than by name because the catalog's
 * ids are its own, while the only thing Blackwall reliably knows about a
 * configured provider is the base URL the user typed.
 */
function normalizeEndpoint(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export function indexCatalog(body: unknown): CatalogIndex {
  if (!body || typeof body !== "object") return {};
  const index: CatalogIndex = {};
  for (const provider of Object.values(body as RawCatalog)) {
    if (!provider?.api || !provider.models) continue;
    const endpoint = normalizeEndpoint(provider.api);
    if (!endpoint) continue;
    const models: Record<string, ModelLimits> = {};
    for (const [modelId, model] of Object.entries(provider.models)) {
      const contextLimit = positiveInteger(model?.limit?.context);
      const outputLimit = positiveInteger(model?.limit?.output);
      if (contextLimit === undefined && outputLimit === undefined) continue;
      models[modelId] = { contextLimit, outputLimit };
    }
    if (Object.keys(models).length) index[endpoint] = { ...index[endpoint], ...models };
  }
  return index;
}

async function readCache(dataDirectory: string): Promise<CachedCatalog | null> {
  try {
    const parsed = JSON.parse(await readFile(join(dataDirectory, CACHE_FILE), "utf8"));
    return parsed && typeof parsed === "object" && parsed.index ? (parsed as CachedCatalog) : null;
  } catch {
    return null;
  }
}

async function writeCache(dataDirectory: string, cache: CachedCatalog): Promise<void> {
  try {
    await writeFile(join(dataDirectory, CACHE_FILE), JSON.stringify(cache), "utf8");
  } catch {
    // A cache we cannot persist only costs a refetch; never fail the sync for it.
  }
}

/**
 * Public model metadata (context windows) for providers whose API does not
 * report it — OpenAI-compatible `/models` responses usually carry only ids.
 * Any failure resolves to an empty index so model sync keeps working offline.
 */
export async function loadModelCatalog(
  dataDirectory: string,
  request: FetchLike = fetch,
  now = Date.now(),
): Promise<CatalogIndex> {
  const cached = await readCache(dataDirectory);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.index;

  try {
    const response = await request(CATALOG_URL, {
      headers: cached?.etag ? { "if-none-match": cached.etag } : {},
      method: "GET",
    });
    if (response.status === 304 && cached) {
      await writeCache(dataDirectory, { ...cached, fetchedAt: now });
      return cached.index;
    }
    if (!response.ok) return cached?.index ?? {};
    const index = indexCatalog(await response.json());
    if (!Object.keys(index).length) return cached?.index ?? {};
    await writeCache(dataDirectory, {
      etag: response.headers.get("etag") ?? undefined,
      fetchedAt: now,
      index,
    });
    return index;
  } catch {
    return cached?.index ?? {};
  }
}

export function lookupModelLimits(
  index: CatalogIndex,
  baseUrl: string,
  modelId: string,
): ModelLimits | undefined {
  return index[normalizeEndpoint(baseUrl)]?.[modelId];
}

// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db/database.js";
import { withInstrumentation } from "./observability.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

export type ProviderInput = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  name: string;
  type?: ProviderKind;
};

export type ProviderKind = "openai-compatible" | "ollama";
export type Provider = Omit<ProviderInput, "apiKey" | "type"> & {
  id: string;
  type: ProviderKind;
};

type ProviderModel = {
  capabilities: string[];
  id: string;
  name: string;
};

type ProviderDocument = { providers: Provider[] };
type FetchLike = typeof fetch;

const emptyDocument = (): ProviderDocument => ({ providers: [] });

function providerDataDirectory(): string {
  return process.env.BLACKWALL_DATA_DIR ?? join(homedir(), ".blackwall");
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Use um endpoint HTTPS ou um endereço local confiável.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function validateProvider(
  input: ProviderInput,
  request: FetchLike = fetch,
): Promise<void> {
  const type = input.type ?? "openai-compatible";
  if (!input.name.trim() || !input.model.trim() || (type !== "ollama" && !input.apiKey?.trim())) {
    throw new Error("Informe nome, modelo e chave de API para continuar.");
  }

  const endpoint =
    type === "ollama"
      ? `${normalizeBaseUrl(input.baseUrl)}/api/tags`
      : `${normalizeBaseUrl(input.baseUrl)}/models`;
  const response = await withInstrumentation("provider.validate", () =>
    request(endpoint, {
      headers: input.apiKey?.trim()
        ? { authorization: `Bearer ${input.apiKey.trim()}` }
        : undefined,
    }),
  );

  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new Error("A chave foi recusada. Revise a chave ou as permissões do provedor.");
  }
  throw new Error(
    `Não foi possível validar o provedor (HTTP ${response.status}). Tente novamente.`,
  );
}

async function readDocument(dataDirectory: string): Promise<ProviderDocument> {
  try {
    const document = JSON.parse(await readFile(join(dataDirectory, "providers.json"), "utf8")) as {
      providers?: Array<Omit<Provider, "type"> & { type?: ProviderKind }>;
    };
    return {
      providers: (document.providers ?? []).map((provider) => ({
        ...provider,
        type: provider.type ?? "openai-compatible",
      })),
    };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
      return emptyDocument();
    }
    throw error;
  }
}

async function writeDocument(dataDirectory: string, document: ProviderDocument) {
  await writeFile(join(dataDirectory, "providers.json"), JSON.stringify(document, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function saveProvider(
  input: ProviderInput,
  dataDirectory = providerDataDirectory(),
): Promise<Provider> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const provider: Provider = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    id: randomUUID(),
    model: input.model.trim(),
    name: input.name.trim(),
    type: input.type ?? "openai-compatible",
  };
  const document = await readDocument(dataDirectory);
  document.providers = [...document.providers, provider];
  if (input.apiKey?.trim()) {
    await encryptSecret(dataDirectory, provider.id, input.apiKey.trim());
  }
  await writeDocument(dataDirectory, document);
  const database = openDatabase(dataDirectory);
  database.client
    .prepare(
      "INSERT OR REPLACE INTO providers (id, type, name, base_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'connected', COALESCE((SELECT created_at FROM providers WHERE id = ?), ?), ?)",
    )
    .run(
      provider.id,
      provider.type,
      provider.name,
      provider.baseUrl,
      provider.id,
      Date.now(),
      Date.now(),
    );
  database.close();
  return provider;
}

export async function getProvider(
  id: string,
  dataDirectory = providerDataDirectory(),
): Promise<Provider> {
  const document = await readDocument(dataDirectory);
  const provider = document.providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error("O provedor selecionado não existe mais neste dispositivo.");
  return provider;
}

export async function listProviders(dataDirectory = providerDataDirectory()): Promise<Provider[]> {
  return (await readDocument(dataDirectory)).providers;
}

export async function providerApiKey(
  id: string,
  dataDirectory = providerDataDirectory(),
): Promise<string> {
  try {
    return await decryptSecret(dataDirectory, id);
  } catch {
    return "";
  }
}

export async function listProviderModels(
  provider: ProviderInput,
  request: FetchLike = fetch,
): Promise<ProviderModel[]> {
  const type = provider.type ?? "openai-compatible";
  const endpoint =
    type === "ollama"
      ? `${normalizeBaseUrl(provider.baseUrl)}/api/tags`
      : `${normalizeBaseUrl(provider.baseUrl)}/models`;
  const response = await withInstrumentation("provider.models", () =>
    request(endpoint, {
      headers: provider.apiKey?.trim()
        ? { authorization: `Bearer ${provider.apiKey.trim()}` }
        : undefined,
    }),
  );
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("A chave foi recusada. Revise a chave ou as permissões do provedor.");
    }
    throw new Error(`Não foi possível listar os modelos (HTTP ${response.status}).`);
  }
  const body = (await response.json()) as {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ name?: string; model?: string }>;
  };
  const models: Array<{ id?: string; model?: string; name?: string }> =
    type === "ollama" ? (body.models ?? []) : (body.data ?? []);
  return models
    .map((model) => {
      const id = model.id ?? model.model ?? model.name ?? "";
      return { capabilities: [], id, name: id };
    })
    .filter((model) => model.id);
}

export async function listStoredProviderModels(
  id: string,
  dataDirectory = providerDataDirectory(),
  request: FetchLike = fetch,
): Promise<ProviderModel[]> {
  const provider = await getProvider(id, dataDirectory);
  return listProviderModels(
    {
      apiKey: await providerApiKey(id, dataDirectory),
      baseUrl: provider.baseUrl,
      model: provider.model,
      name: provider.name,
      type: provider.type,
    },
    request,
  );
}

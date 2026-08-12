// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db/database.js";
import { withInstrumentation } from "./observability.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

export type ProviderInput = {
  apiKey: string;
  baseUrl: string;
  model: string;
  name: string;
};

export type Provider = Omit<ProviderInput, "apiKey"> & { id: string };

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
  if (!input.name.trim() || !input.model.trim() || !input.apiKey.trim()) {
    throw new Error("Informe nome, modelo e chave de API para continuar.");
  }

  const endpoint = `${normalizeBaseUrl(input.baseUrl)}/models`;
  const response = await withInstrumentation("provider.validate", () =>
    request(endpoint, { headers: { authorization: `Bearer ${input.apiKey.trim()}` } }),
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
    return JSON.parse(
      await readFile(join(dataDirectory, "providers.json"), "utf8"),
    ) as ProviderDocument;
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
  };
  const document = await readDocument(dataDirectory);
  document.providers = [...document.providers, provider];
  await encryptSecret(dataDirectory, provider.id, input.apiKey.trim());
  await writeDocument(dataDirectory, document);
  const database = openDatabase(dataDirectory);
  database.client
    .prepare(
      "INSERT OR REPLACE INTO providers (id, type, name, base_url, status, created_at, updated_at) VALUES (?, 'openai-compatible', ?, ?, 'connected', COALESCE((SELECT created_at FROM providers WHERE id = ?), ?), ?)",
    )
    .run(provider.id, provider.name, provider.baseUrl, provider.id, Date.now(), Date.now());
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
  return decryptSecret(dataDirectory, id);
}

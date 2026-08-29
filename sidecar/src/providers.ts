// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { openSharedDatabase } from "./db/database.js";
import { models } from "./db/schema.js";
import { loadModelCatalog, lookupModelLimits } from "./model-catalog.js";
import { withAsyncInstrumentation } from "./observability.js";
import { decryptSecret, encryptSecret, removeSecret } from "./secrets.js";
import {
  type ProtocolPreference,
  type ResolvedProtocol,
  type ToolDefinition,
  type ToolMode,
  type ToolSupport,
  type ToolSupportSource,
  toOllamaTools,
  toOpenAIChatTools,
  toOpenAIResponsesTools,
} from "./tool-contract.js";

export type ProviderInput = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  name: string;
  id?: string;
  type?: ProviderKind;
};

export type ProviderKind = "openai-compatible" | "ollama";
export type Provider = Omit<ProviderInput, "apiKey" | "type"> & {
  id: string;
  type: ProviderKind;
};

export type ParallelToolCallsMode = "auto" | "enabled" | "disabled";

export type ProviderModel = {
  capabilities: string[];
  contextLimit?: number;
  id: string;
  name: string;
  outputReserve?: number;
  protocolPreference?: ProtocolPreference;
  resolvedProtocol?: ResolvedProtocol;
  toolCheckedAt?: number;
  toolProbeErrorCode?: string;
  toolSupport?: ToolSupport;
  toolSupportSource?: ToolSupportSource;
  toolMode?: ToolMode;
  parallelToolCalls?: ParallelToolCallsMode;
};

/**
 * Common contract implemented by every local-first provider adapter.
 * Keeping transport details here prevents the router from making assumptions
 * about OpenAI-compatible and Ollama endpoints.
 */
export interface ProviderAdapter {
  readonly kind: ProviderKind;
  validate(request?: FetchLike): Promise<void>;
  listModels(request?: FetchLike): Promise<ProviderModel[]>;
  chatRequest(
    model: string,
    messages: unknown[],
    signal?: AbortSignal,
    options?: {
      protocol?: ResolvedProtocol;
      toolMode?: ToolMode;
      tools?: ToolDefinition[];
      parallelToolCalls?: ParallelToolCallsMode;
    },
  ): RequestInit & {
    endpoint: string;
  };
}

type ProviderDocument = { providers: Provider[] };
type FetchLike = typeof fetch;

function isOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

/**
 * Whether to let the model batch multiple tool calls into one response.
 * OpenRouter tracks a per-model "Tool Call Error Rate" and defaults most
 * models to parallel calls, so it is safe to opt in there by default. Every
 * other endpoint (generic OpenAI-compatible, OpenCode Zen, self-hosted) has
 * no such reliability signal, so it keeps the conservative one-call-at-a-time
 * behavior unless a model has been explicitly marked "enabled" after manual
 * verification. "disabled" always wins, including on OpenRouter, so a model
 * that misbehaves can be pinned back to sequential calls.
 */
/** Anthropic bills at most four cache breakpoints per request. */
const CACHE_BREAKPOINT_SYSTEM = 2;
const CACHE_BREAKPOINT_TAIL = 2;

/**
 * Only Anthropic-family models honour `cache_control` over an OpenAI-compatible
 * transport. Everyone else either caches automatically (OpenAI) or ignores the
 * field — and some strict gateways reject unknown keys, so stay narrow.
 */
function supportsPromptCaching(model: string): boolean {
  return /claude|anthropic/i.test(model);
}

type CachedMessage = Record<string, unknown> & {
  content?: unknown;
  role?: unknown;
};

/**
 * Marks the stable prefix and the live tail of the transcript so the provider
 * reuses its own work instead of reprocessing every message on every turn.
 * This lowers cost; the token counts reported in `usage` stay the same, since
 * the transcript is still transmitted in full.
 *
 * Mirrors OpenCode's applyCaching: the first two system messages plus the last
 * two non-system ones, which also keeps the count within Anthropic's limit.
 */
export function applyPromptCaching(messages: unknown[], model: string): unknown[] {
  if (!supportsPromptCaching(model)) return messages;
  const isMessage = (value: unknown): value is CachedMessage =>
    Boolean(value) && typeof value === "object";
  const indexed = messages.map((message, index) => ({ index, message }));
  const marked = new Set(
    [
      ...indexed
        .filter(({ message }) => isMessage(message) && message.role === "system")
        .slice(0, CACHE_BREAKPOINT_SYSTEM),
      ...indexed
        .filter(({ message }) => isMessage(message) && message.role !== "system")
        .slice(-CACHE_BREAKPOINT_TAIL),
    ].map(({ index }) => index),
  );
  if (!marked.size) return messages;

  return messages.map((message, index) => {
    if (!marked.has(index) || !isMessage(message)) return message;
    const cacheControl = { type: "ephemeral" };
    if (typeof message.content === "string") {
      // Providers accept either a bare string or content parts; only the part
      // form can carry the marker, so widen just this message.
      return message.content
        ? {
            ...message,
            content: [{ cache_control: cacheControl, text: message.content, type: "text" }],
          }
        : message;
    }
    if (!Array.isArray(message.content) || !message.content.length) return message;
    const parts = [...message.content];
    const last = parts.at(-1);
    if (!last || typeof last !== "object") return message;
    parts[parts.length - 1] = { ...last, cache_control: cacheControl };
    return { ...message, content: parts };
  });
}

function resolveParallelToolCalls(
  mode: ParallelToolCallsMode | undefined,
  baseUrl: string,
): boolean {
  if (mode === "disabled") return false;
  if (mode === "enabled") return true;
  return isOpenRouter(baseUrl);
}

export function messagesToResponsesInput(messages: unknown[]): unknown[] {
  const output: unknown[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const item = message as Record<string, unknown>;
    if (item.role === "assistant" && Array.isArray(item.tool_calls)) {
      output.push(
        ...item.tool_calls.flatMap((rawCall) => {
          if (!rawCall || typeof rawCall !== "object") return [];
          const call = rawCall as Record<string, unknown>;
          const fn = call.function as Record<string, unknown> | undefined;
          return [
            {
              arguments: String(fn?.arguments ?? "{}"),
              call_id: String(call.id ?? ""),
              name: String(fn?.name ?? ""),
              type: "function_call",
            },
          ];
        }),
      );
      continue;
    }
    if (item.role === "tool") {
      output.push({
        call_id: String(item.tool_call_id ?? item.toolCallId ?? ""),
        output: String(item.content ?? ""),
        type: "function_call_output",
      });
      continue;
    }
    output.push({ content: String(item.content ?? ""), role: item.role ?? "user" });
  }
  return output;
}

const emptyDocument = (): ProviderDocument => ({ providers: [] });

export function providerDataDirectory(): string {
  return process.env.BLACKWALL_DATA_DIR ?? join(homedir(), ".blackwall");
}

export class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(status: number, operation = "validar o provedor") {
    super(providerHttpMessage(status, operation));
    this.name = "ProviderHttpError";
    this.status = status;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export class ProviderConnectionError extends Error {
  readonly retryable = true;

  constructor(kind: ProviderKind, baseUrl: string, operation: string) {
    const url = new URL(baseUrl);
    const target = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
    const providerName = kind === "ollama" ? "Ollama" : "o provedor";
    super(
      `Não foi possível ${operation} em ${providerName} (${target}). ` +
        (kind === "ollama"
          ? "Verifique se o Ollama está em execução e se o endpoint está correto."
          : "Verifique a rede e o endpoint configurado."),
    );
    this.name = "ProviderConnectionError";
  }
}

function providerHttpMessage(status: number, operation: string): string {
  if (status === 401) return "A chave foi recusada (HTTP 401). Revise a chave do provedor.";
  if (status === 403) return "O provedor bloqueou o acesso (HTTP 403). Revise as permissões.";
  if (status === 404)
    return `O endpoint não foi encontrado (HTTP 404). Revise a URL antes de ${operation}.`;
  if (status === 429)
    return "O provedor está limitando as requisições (HTTP 429). Tente novamente em instantes.";
  if (status >= 500)
    return `O provedor está indisponível (HTTP ${status}). Tentaremos novamente ou usaremos a próxima rota.`;
  return `Não foi possível ${operation} (HTTP ${status}). Tente novamente.`;
}

abstract class BaseProviderAdapter implements ProviderAdapter {
  abstract readonly kind: ProviderKind;
  constructor(protected readonly provider: ProviderInput) {}

  protected endpoint(path: string) {
    return `${normalizeBaseUrl(this.provider.baseUrl)}${path}`;
  }

  protected headers(): Record<string, string> {
    return this.provider.apiKey?.trim()
      ? { authorization: `Bearer ${this.provider.apiKey.trim()}` }
      : {};
  }

  protected async request(
    path: string,
    request: FetchLike,
    init: RequestInit,
    operation: string,
  ): Promise<Response> {
    try {
      return await request(this.endpoint(path), init);
    } catch (error) {
      if (error instanceof ProviderConnectionError) throw error;
      throw new ProviderConnectionError(this.kind, this.provider.baseUrl, operation);
    }
  }

  protected async checked(
    response: Response,
    operation: "validar o provedor" | "listar os modelos",
  ) {
    if (!response.ok) throw new ProviderHttpError(response.status, operation);
    return response;
  }

  abstract validate(request?: FetchLike): Promise<void>;
  abstract listModels(request?: FetchLike): Promise<ProviderModel[]>;
  abstract chatRequest(
    model: string,
    messages: unknown[],
    signal?: AbortSignal,
    options?: {
      protocol?: ResolvedProtocol;
      toolMode?: ToolMode;
      tools?: ToolDefinition[];
      parallelToolCalls?: ParallelToolCallsMode;
    },
  ): RequestInit & {
    endpoint: string;
  };
}

export class OpenAICompatibleProvider extends BaseProviderAdapter {
  readonly kind = "openai-compatible" as const;

  async validate(request: FetchLike = fetch) {
    // O modelo padrão é opcional: a validação testa credencial/endpoint pela
    // própria listagem de modelos (/models), não por um modelo específico.
    if (!this.provider.name.trim() || !this.provider.apiKey?.trim())
      throw new Error("Informe nome e chave de API para continuar.");
    await this.checked(
      await this.request("/models", request, { headers: this.headers() }, "validar o provedor"),
      "validar o provedor",
    );
  }

  async listModels(request: FetchLike = fetch) {
    const response = await this.checked(
      await this.request("/models", request, { headers: this.headers() }, "listar os modelos"),
      "listar os modelos",
    );
    const body = (await response.json()) as {
      data?: Array<{
        context_length?: number;
        id?: string;
        name?: string;
        supported_parameters?: string[];
      }>;
    };
    return dedupeModels(
      (body.data ?? [])
        .map((model) => {
          const id = model.id ?? model.name ?? "";
          const capabilities = Array.isArray(model.supported_parameters)
            ? model.supported_parameters.filter((item): item is string => typeof item === "string")
            : [];
          return {
            capabilities,
            ...(Number.isFinite(model.context_length) && Number(model.context_length) > 0
              ? { contextLimit: Number(model.context_length) }
              : {}),
            id,
            name: id,
            ...(capabilities.length
              ? {
                  toolSupport: capabilities.includes("tools")
                    ? ("native" as const)
                    : ("unsupported" as const),
                  toolSupportSource: "metadata" as const,
                }
              : {}),
          };
        })
        .filter((model) => model.id),
    );
  }

  chatRequest(
    model: string,
    messages: unknown[],
    signal?: AbortSignal,
    options: {
      protocol?: ResolvedProtocol;
      toolMode?: ToolMode;
      tools?: ToolDefinition[];
      parallelToolCalls?: ParallelToolCallsMode;
    } = {},
  ) {
    if (options.protocol === "openai-responses")
      return this.responsesRequest(model, messages, signal, options);
    const body: Record<string, unknown> = {
      messages: applyPromptCaching(messages, model),
      model,
      stream: true,
      stream_options: { include_usage: true },
    };
    if ((options.toolMode ?? "auto") === "auto" && options.tools?.length) {
      body.tool_choice = "auto";
      body.tools = toOpenAIChatTools(options.tools);
      body.parallel_tool_calls = resolveParallelToolCalls(
        options.parallelToolCalls,
        this.provider.baseUrl,
      );
      if (isOpenRouter(this.provider.baseUrl)) body.provider = { require_parameters: true };
    }
    return {
      endpoint: this.endpoint("/chat/completions"),
      body: JSON.stringify(body),
      headers: { ...this.headers(), "content-type": "application/json" },
      method: "POST" as const,
      signal,
    };
  }

  private responsesRequest(
    model: string,
    messages: unknown[],
    signal: AbortSignal | undefined,
    options: {
      toolMode?: ToolMode;
      tools?: ToolDefinition[];
      parallelToolCalls?: ParallelToolCallsMode;
    },
  ) {
    const body: Record<string, unknown> = {
      input: messagesToResponsesInput(messages),
      model,
      store: false,
      stream: true,
    };
    if ((options.toolMode ?? "auto") === "auto" && options.tools?.length) {
      body.tools = toOpenAIResponsesTools(options.tools);
      body.tool_choice = "auto";
      body.parallel_tool_calls = resolveParallelToolCalls(
        options.parallelToolCalls,
        this.provider.baseUrl,
      );
    }
    return {
      endpoint: this.endpoint("/responses"),
      body: JSON.stringify(body),
      headers: { ...this.headers(), "content-type": "application/json" },
      method: "POST" as const,
      signal,
    };
  }
}

class OllamaProvider extends BaseProviderAdapter {
  readonly kind = "ollama" as const;

  protected endpoint(path: string) {
    const baseUrl = normalizeBaseUrl(this.provider.baseUrl).replace(
      /\/(?:api|v1)(?:\/(?:api|v1))*$/i,
      "",
    );
    return `${baseUrl}${path}`;
  }

  async validate(request: FetchLike = fetch) {
    // O modelo padrão é opcional para Ollama também: /api/tags valida o
    // endpoint e lista os modelos disponíveis.
    if (!this.provider.name.trim()) throw new Error("Informe o nome do provedor para continuar.");
    await this.checked(
      await this.request("/api/tags", request, { headers: this.headers() }, "validar o provedor"),
      "validar o provedor",
    );
  }

  async listModels(request: FetchLike = fetch) {
    const response = await this.checked(
      await this.request("/api/tags", request, { headers: this.headers() }, "listar os modelos"),
      "listar os modelos",
    );
    const body = (await response.json()) as {
      models?: Array<{ capabilities?: string[]; name?: string; model?: string }>;
    };
    const listed = (body.models ?? [])
      .map((model) => {
        const id = model.name ?? model.model ?? "";
        const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
        return {
          capabilities,
          id,
          name: id,
          ...(capabilities.length
            ? {
                toolSupport: capabilities.includes("tools")
                  ? ("native" as const)
                  : ("unsupported" as const),
                toolSupportSource: "metadata" as const,
              }
            : {}),
        };
      })
      .filter((model) => model.id);
    const enriched = await Promise.all(
      listed.map(async (model) => {
        try {
          const details = await this.request(
            "/api/show",
            request,
            {
              body: JSON.stringify({ name: model.id }),
              headers: { ...this.headers(), "content-type": "application/json" },
              method: "POST",
            },
            "consultar capacidades do modelo",
          );
          if (!details.ok) return model;
          const detailBody = (await details.json()) as {
            capabilities?: unknown;
            model_info?: Record<string, unknown>;
          };
          const capabilities = Array.isArray(detailBody.capabilities)
            ? detailBody.capabilities.filter((item): item is string => typeof item === "string")
            : [];
          const contextLimitEntry = Object.entries(detailBody.model_info ?? {}).find(
            ([key, value]) =>
              key.endsWith(".context_length") &&
              typeof value === "number" &&
              Number.isFinite(value) &&
              value > 0,
          );
          return {
            ...model,
            ...(capabilities.length
              ? {
                  capabilities,
                  toolSupport: capabilities.includes("tools")
                    ? ("native" as const)
                    : ("unsupported" as const),
                  toolSupportSource: "metadata" as const,
                }
              : {}),
            ...(contextLimitEntry ? { contextLimit: Number(contextLimitEntry[1]) } : {}),
          };
        } catch {
          // Tags remain authoritative when /api/show is unavailable on a compatible endpoint.
          return model;
        }
      }),
    );
    return dedupeModels(enriched);
  }

  chatRequest(
    model: string,
    messages: unknown[],
    signal?: AbortSignal,
    options: {
      protocol?: ResolvedProtocol;
      toolMode?: ToolMode;
      tools?: ToolDefinition[];
      parallelToolCalls?: ParallelToolCallsMode;
    } = {},
  ) {
    const body: Record<string, unknown> = { messages, model, stream: true };
    if ((options.toolMode ?? "auto") === "auto" && options.tools?.length)
      body.tools = toOllamaTools(options.tools);
    return {
      endpoint: this.endpoint("/api/chat"),
      body: JSON.stringify(body),
      headers: { ...this.headers(), "content-type": "application/json" },
      method: "POST" as const,
      signal,
    };
  }
}

export function createProviderAdapter(provider: ProviderInput): ProviderAdapter {
  return (provider.type ?? "openai-compatible") === "ollama"
    ? new OllamaProvider(provider)
    : new OpenAICompatibleProvider(provider);
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error("Use um endpoint HTTPS ou um endereço local confiável.");
  }
  return url.toString().replace(/\/$/, "");
}

/**
 * Endpoint canônico para comparação: host minúsculo + porta + caminho sem
 * barras finais e sem sufixos /api ou /v1 repetidos (Ollama aceita os três
 * formatos e isso gerava cadastros duplicados do mesmo servidor).
 */
export function canonicalEndpoint(value: string): string {
  const url = new URL(normalizeBaseUrl(value));
  const path = url.pathname.replace(/\/(?:api|v1)(?:\/(?:api|v1))*$/i, "").replace(/\/$/, "");
  return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${path}`;
}

function timingSafeEqualStrings(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1)
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

/** Alguns endpoints retornam o mesmo id duas vezes; renderizar/salvar duplicado confunde o catálogo. */
function dedupeModels(listed: ProviderModel[]): ProviderModel[] {
  const seen = new Set<string>();
  return listed.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export async function validateProvider(
  input: ProviderInput,
  request: FetchLike = fetch,
): Promise<void> {
  if (process.env.BLACKWALL_E2E_MOCK === "1") return;
  await withAsyncInstrumentation("provider.validate", () =>
    createProviderAdapter(input).validate(request),
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

/**
 * Encontra um provedor existente que represente a MESMA conexão, tornando o
 * cadastro idempotente:
 * - Ollama: tipo + endpoint canônico iguais (o mesmo servidor nunca vira dois
 *   cards; novos modelos pertencem ao catálogo do provedor existente);
 * - OpenAI-compatible: só mescla quando tipo, endpoint canônico, nome
 *   normalizado e credencial são comprovadamente iguais — contas ou chaves
 *   diferentes permanecem registros separados. A comparação de chave é feita
 *   em memória, sem registrar hash nem segredo em log.
 */
async function findSameConnection(
  document: ProviderDocument,
  input: ProviderInput,
  dataDirectory: string,
): Promise<Provider | null> {
  const type = input.type ?? "openai-compatible";
  let canonical: string;
  try {
    canonical = canonicalEndpoint(input.baseUrl);
  } catch {
    return null;
  }
  const name = input.name.trim().toLowerCase();
  for (const candidate of document.providers) {
    if (candidate.type !== type) continue;
    let candidateCanonical: string;
    try {
      candidateCanonical = canonicalEndpoint(candidate.baseUrl);
    } catch {
      continue;
    }
    if (candidateCanonical !== canonical) continue;
    if (type === "ollama") return candidate;
    if (candidate.name.trim().toLowerCase() !== name) continue;
    const existingKey = await providerApiKey(candidate.id, dataDirectory);
    const providedKey = input.apiKey?.trim() ?? "";
    // Sem chave fornecida e sem chave armazenada: mesma conexão "anônima".
    if (!providedKey && !existingKey) return candidate;
    if (providedKey && existingKey && timingSafeEqualStrings(providedKey, existingKey))
      return candidate;
    return null; // Mesmo endpoint/nome, credenciais distintas: NÃO mesclar.
  }
  return null;
}

export async function saveProvider(
  input: ProviderInput,
  dataDirectory = providerDataDirectory(),
): Promise<Provider> {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const document = await readDocument(dataDirectory);
  const existingById = input.id
    ? document.providers.find((candidate) => candidate.id === input.id)
    : null;
  const existingConnection =
    existingById ?? (await findSameConnection(document, { ...input }, dataDirectory));
  const provider: Provider = {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    id: existingConnection?.id ?? input.id ?? randomUUID(),
    model: input.model.trim(),
    name: input.name.trim(),
    type: input.type ?? existingConnection?.type ?? "openai-compatible",
  };
  document.providers = existingConnection
    ? document.providers.map((candidate) => (candidate.id === provider.id ? provider : candidate))
    : [...document.providers, provider];
  if (input.apiKey?.trim()) {
    await encryptSecret(dataDirectory, provider.id, input.apiKey.trim());
  }
  await writeDocument(dataDirectory, document);
  const database = openSharedDatabase(dataDirectory);
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

export async function removeProvider(id: string, dataDirectory = providerDataDirectory()) {
  const document = await readDocument(dataDirectory);
  const provider = document.providers.find((candidate) => candidate.id === id);
  if (!provider) throw new Error("O provedor selecionado não existe.");
  document.providers = document.providers.filter((candidate) => candidate.id !== id);
  await writeDocument(dataDirectory, document);
  await removeSecret(dataDirectory, id);
  const database = openSharedDatabase(dataDirectory);
  database.client.prepare("DELETE FROM providers WHERE id = ?").run(id);
  database.close();
  return { id };
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

/**
 * Reconciliação determinística de duplicatas legadas (execução idempotente):
 * - Ollama: mesmo endpoint canônico → mescla no registro mais antigo;
 * - OpenAI-compatible: só mescla quando nome E credencial são comprovadamente
 *   iguais; configurações ambíguas NUNCA são apagadas automaticamente.
 * Referências (models, router_entries, sessões, mensagens, uso/limites) são
 * re-apontadas para o keeper dentro de uma transação; o segredo órfão é
 * removido e o providers.json é reescrito somente após o commit.
 */
export async function reconcileProviderDuplicates(
  dataDirectory = providerDataDirectory(),
): Promise<Array<{ duplicateId: string; keeperId: string }>> {
  const document = await readDocument(dataDirectory);
  const keepers: Provider[] = [];
  const groups = new Map<string, Provider>();
  const merges: Array<{ duplicateId: string; keeperId: string }> = [];

  for (const provider of document.providers) {
    let key: string;
    try {
      const canonical = canonicalEndpoint(provider.baseUrl);
      key =
        provider.type === "ollama"
          ? `ollama:${canonical}`
          : `openai:${canonical}:${provider.name.trim().toLowerCase()}`;
    } catch {
      keepers.push(provider);
      continue;
    }
    const current = groups.get(key);
    if (!current) {
      groups.set(key, provider);
      keepers.push(provider);
      continue;
    }
    if (provider.type !== "ollama") {
      // Não-Ollama exige identidade de credencial comprovada em memória.
      const currentKey = await providerApiKey(current.id, dataDirectory);
      const candidateKey = await providerApiKey(provider.id, dataDirectory);
      if (!timingSafeEqualStrings(currentKey, candidateKey)) {
        keepers.push(provider); // Ambígua: preserva ambos.
        continue;
      }
    }
    merges.push({ duplicateId: provider.id, keeperId: current.id });
  }
  if (!merges.length) return [];

  const database = openSharedDatabase(dataDirectory);
  const client = database.client;
  const applyMerge = client.transaction((duplicateId: string, keeperId: string) => {
    // Models: conflito de model_id cai fora; caso contrário, muda de dono.
    const duplicateModels = client
      .prepare("SELECT id, model_id AS modelId FROM models WHERE provider_id = ?")
      .all(duplicateId) as Array<{ id: string; modelId: string }>;
    const keeperModelIds = new Set(
      (
        client
          .prepare("SELECT model_id AS modelId FROM models WHERE provider_id = ?")
          .all(keeperId) as Array<{ modelId: string }>
      ).map((row) => row.modelId),
    );
    for (const row of duplicateModels) {
      if (keeperModelIds.has(row.modelId)) {
        client.prepare("DELETE FROM models WHERE id = ?").run(row.id);
      } else {
        client
          .prepare("UPDATE models SET id = ?, provider_id = ? WHERE id = ?")
          .run(`${keeperId}:${row.modelId}`, keeperId, row.id);
      }
    }
    // Router entries: re-aponta e remove repetições exatas (mantém menor posição).
    client
      .prepare("UPDATE router_entries SET provider_id = ? WHERE provider_id = ?")
      .run(keeperId, duplicateId);
    client
      .prepare(
        `DELETE FROM router_entries WHERE provider_id = ? AND id NOT IN (
           SELECT MIN(id) FROM router_entries WHERE provider_id = ?
           GROUP BY workspace_id, model_id, position)`,
      )
      .run(keeperId, keeperId);
    client
      .prepare("UPDATE sessions SET selected_provider_id = ? WHERE selected_provider_id = ?")
      .run(keeperId, duplicateId);
    client
      .prepare("UPDATE messages SET provider_id = ? WHERE provider_id = ?")
      .run(keeperId, duplicateId);
    client
      .prepare("UPDATE provider_usage_events SET provider_id = ? WHERE provider_id = ?")
      .run(keeperId, duplicateId);
    client
      .prepare("UPDATE provider_usage_limits SET provider_id = ? WHERE provider_id = ?")
      .run(keeperId, duplicateId);
    // Uso diário: soma as agregações da duplicata nas linhas do keeper.
    const dailyRows = client
      .prepare(
        "SELECT profile_id AS profileId, model_id AS modelId, date_key AS dateKey, requests, input_tokens AS inputTokens, output_tokens AS outputTokens, cached_input_tokens AS cachedInputTokens, reasoning_tokens AS reasoningTokens, total_tokens AS totalTokens FROM provider_usage_daily WHERE provider_id = ?",
      )
      .all(duplicateId) as Array<{
      cachedInputTokens: number;
      dateKey: string;
      inputTokens: number;
      modelId: string;
      outputTokens: number;
      profileId: string;
      reasoningTokens: number;
      requests: number;
      totalTokens: number;
    }>;
    for (const row of dailyRows) {
      client
        .prepare(
          `INSERT INTO provider_usage_daily (profile_id, provider_id, model_id, date_key, requests, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, total_tokens, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(profile_id, provider_id, model_id, date_key) DO UPDATE SET
             requests = requests + excluded.requests,
             input_tokens = input_tokens + excluded.input_tokens,
             output_tokens = output_tokens + excluded.output_tokens,
             cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
             reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
             total_tokens = total_tokens + excluded.total_tokens,
             updated_at = excluded.updated_at`,
        )
        .run(
          row.profileId,
          keeperId,
          row.modelId,
          row.dateKey,
          row.requests,
          row.inputTokens,
          row.outputTokens,
          row.cachedInputTokens,
          row.reasoningTokens,
          row.totalTokens,
          Date.now(),
        );
    }
    client.prepare("DELETE FROM provider_usage_daily WHERE provider_id = ?").run(duplicateId);
    // Só agora remove a linha do provedor (FKs cascade já não têm o que apagar).
    client.prepare("DELETE FROM providers WHERE id = ?").run(duplicateId);
  });

  for (const merge of merges) applyMerge(merge.duplicateId, merge.keeperId);
  database.close();

  // Segredo órfão sai antes da reescrita do documento.
  await Promise.all(merges.map((merge) => removeSecret(dataDirectory, merge.duplicateId)));
  document.providers = keepers.filter(
    (provider) => !merges.some((merge) => merge.duplicateId === provider.id),
  );
  await writeDocument(dataDirectory, document);
  return merges;
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
  return withAsyncInstrumentation("provider.models", () =>
    createProviderAdapter(provider).listModels(request),
  );
}

/**
 * Resolve credentials from the persisted provider while preserving values
 * currently being edited in the form. This lets model discovery test an
 * unsaved endpoint without requiring the user to overwrite the provider first.
 */
export async function resolveProviderModelInput(
  input: ProviderInput,
  dataDirectory = providerDataDirectory(),
): Promise<ProviderInput> {
  if (!input.id) return input;
  const existing = await getProvider(input.id, dataDirectory);
  return {
    ...input,
    apiKey: input.apiKey?.trim() || (await providerApiKey(input.id, dataDirectory)),
    baseUrl: input.baseUrl.trim() || existing.baseUrl,
    model: input.model.trim() || existing.model,
    name: input.name.trim() || existing.name,
    type: input.type ?? existing.type,
  };
}

/**
 * OpenAI-compatible `/models` responses usually carry only model ids, leaving
 * the context window unknown — which would silently fall back to a small
 * default and prune conversations far earlier than the model requires. Fill the
 * gap from the public catalog, never overriding what the provider did report.
 */
async function enrichWithCatalogLimits(
  listed: ProviderModel[],
  provider: ProviderInput,
  dataDirectory: string,
  request: FetchLike,
): Promise<ProviderModel[]> {
  const baseUrl = provider.baseUrl?.trim();
  if (!baseUrl || listed.every((model) => model.contextLimit !== undefined)) return listed;
  const catalog = await loadModelCatalog(dataDirectory, request);
  return listed.map((model) => {
    if (model.contextLimit !== undefined) return model;
    const limits = lookupModelLimits(catalog, baseUrl, model.id);
    return limits?.contextLimit === undefined
      ? model
      : { ...model, contextLimit: limits.contextLimit };
  });
}

export async function syncProviderModels(
  providerId: string,
  provider: ProviderInput,
  dataDirectory = providerDataDirectory(),
  request: FetchLike = fetch,
): Promise<ProviderModel[]> {
  const listed = await enrichWithCatalogLimits(
    await listProviderModels(provider, request),
    provider,
    dataDirectory,
    request,
  );
  const database = openSharedDatabase(dataDirectory);
  const timestamp = Date.now();
  const upsert = database.client.prepare(
    "INSERT INTO models (id, provider_id, model_id, display_name, capabilities, available, protocol_preference, resolved_protocol, tool_support, tool_support_source, tool_checked_at, tool_probe_error_code, tool_mode, parallel_tool_calls, context_limit, output_reserve, updated_at) VALUES (?, ?, ?, ?, ?, 1, 'auto', NULL, ?, ?, NULL, NULL, 'auto', 'auto', ?, ?, ?) ON CONFLICT(provider_id, model_id) DO UPDATE SET display_name = excluded.display_name, capabilities = excluded.capabilities, available = 1, tool_support = CASE WHEN excluded.tool_support = 'unknown' THEN models.tool_support ELSE excluded.tool_support END, tool_support_source = CASE WHEN excluded.tool_support_source IS NULL THEN models.tool_support_source ELSE excluded.tool_support_source END, context_limit = COALESCE(excluded.context_limit, models.context_limit), output_reserve = COALESCE(excluded.output_reserve, models.output_reserve), updated_at = excluded.updated_at",
  );
  const save = database.client.transaction(() => {
    database.client
      .prepare("UPDATE models SET available = 0, updated_at = ? WHERE provider_id = ?")
      .run(timestamp, providerId);
    for (const model of listed) {
      upsert.run(
        `${providerId}:${model.id}`,
        providerId,
        model.id,
        model.name,
        JSON.stringify(model.capabilities),
        model.toolSupport ?? "unknown",
        model.toolSupportSource ?? null,
        model.contextLimit ?? null,
        model.outputReserve ?? null,
        timestamp,
      );
    }
  });
  save();
  database.client
    .prepare("UPDATE providers SET status = 'connected', updated_at = ? WHERE id = ?")
    .run(timestamp, providerId);
  database.close();
  return listed;
}

export function routeCandidates(
  selected: { providerId: string; model?: string },
  entries: Array<{ providerId: string; modelId: string; position: number }>,
  maxAttempts = 8,
) {
  const candidates = [
    { providerId: selected.providerId, model: selected.model?.trim() || undefined },
    ...entries
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((entry) => ({ providerId: entry.providerId, model: entry.modelId })),
  ];
  return candidates
    .filter(
      (candidate, index, all) =>
        all.findIndex(
          (item) => item.providerId === candidate.providerId && item.model === candidate.model,
        ) === index,
    )
    .slice(0, maxAttempts);
}

export async function listStoredProviderModels(
  id: string,
  dataDirectory = providerDataDirectory(),
  request: FetchLike = fetch,
): Promise<ProviderModel[]> {
  const provider = await getProvider(id, dataDirectory);
  const listed = await listProviderModels(
    {
      apiKey: await providerApiKey(id, dataDirectory),
      baseUrl: provider.baseUrl,
      model: provider.model,
      name: provider.name,
      type: provider.type,
    },
    request,
  );
  const database = openSharedDatabase(dataDirectory);
  const storedRows = database.db.select().from(models).where(eq(models.providerId, id)).all();
  const storedById = new Map(storedRows.map((row) => [row.modelId, row]));
  return listed.map((model) => {
    const row = storedById.get(model.id);
    return {
      ...model,
      ...(row
        ? {
            protocolPreference: row.protocolPreference as ProtocolPreference,
            contextLimit: row.contextLimit ?? model.contextLimit,
            outputReserve: row.outputReserve ?? model.outputReserve,
            resolvedProtocol: row.resolvedProtocol as ResolvedProtocol | undefined,
            toolCheckedAt: row.toolCheckedAt ?? undefined,
            toolMode: row.toolMode as ToolMode | undefined,
            parallelToolCalls: row.parallelToolCalls as ParallelToolCallsMode | undefined,
            toolProbeErrorCode: row.toolProbeErrorCode ?? undefined,
            toolSupport: row.toolSupport as ToolSupport,
            toolSupportSource: row.toolSupportSource as ToolSupportSource | undefined,
          }
        : {}),
    };
  });
}

export function setModelToolMode(
  providerId: string,
  modelId: string,
  toolMode: ToolMode,
  dataDirectory = providerDataDirectory(),
) {
  if (toolMode !== "auto" && toolMode !== "compatibility" && toolMode !== "disabled")
    throw new Error("Modo de ferramentas inválido.");
  const database = openSharedDatabase(dataDirectory);
  const result = database.db
    .update(models)
    .set({ toolMode, updatedAt: Date.now() })
    .where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)))
    .run();
  database.close();
  if (!result.changes) throw new Error("O modelo ainda não foi sincronizado.");
  return { providerId, modelId, toolMode };
}

export function setModelParallelToolCalls(
  providerId: string,
  modelId: string,
  parallelToolCalls: ParallelToolCallsMode,
  dataDirectory = providerDataDirectory(),
) {
  if (!["auto", "enabled", "disabled"].includes(parallelToolCalls))
    throw new Error("Modo de chamadas paralelas inválido.");
  const database = openSharedDatabase(dataDirectory);
  const result = database.db
    .update(models)
    .set({ parallelToolCalls, updatedAt: Date.now() })
    .where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)))
    .run();
  database.close();
  if (!result.changes) throw new Error("O modelo ainda não foi sincronizado.");
  return { modelId, parallelToolCalls, providerId };
}

export function setModelProtocol(
  providerId: string,
  modelId: string,
  protocolPreference: ProtocolPreference,
  dataDirectory = providerDataDirectory(),
) {
  if (!["auto", "openai-chat", "openai-responses"].includes(protocolPreference))
    throw new Error("Preferência de protocolo inválida.");
  const database = openSharedDatabase(dataDirectory);
  const result = database.db
    .update(models)
    .set({ protocolPreference, toolSupportSource: "manual", updatedAt: Date.now() })
    .where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)))
    .run();
  database.close();
  if (!result.changes) throw new Error("O modelo ainda não foi sincronizado.");
  return { modelId, protocolPreference, providerId };
}

export function setModelCapability(
  providerId: string,
  modelId: string,
  input: {
    protocol?: ResolvedProtocol | null;
    support: ToolSupport;
    source: ToolSupportSource;
    errorCode?: string | null;
  },
  dataDirectory = providerDataDirectory(),
) {
  const database = openSharedDatabase(dataDirectory);
  const result = database.db
    .update(models)
    .set({
      resolvedProtocol: input.protocol ?? null,
      toolCheckedAt: Date.now(),
      toolProbeErrorCode: input.errorCode ?? null,
      toolSupport: input.support,
      toolSupportSource: input.source,
      updatedAt: Date.now(),
    })
    .where(and(eq(models.providerId, providerId), eq(models.modelId, modelId)))
    .run();
  database.close();
  if (!result.changes) throw new Error("O modelo ainda não foi sincronizado.");
  return { modelId, providerId, ...input };
}

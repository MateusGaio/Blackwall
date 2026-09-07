// MIT License — Copyright (c) 2026 Mateus Gaio

export type EmbeddingProviderKind = "ollama" | "openai-compatible";

export type EmbeddingState = "unconfigured" | "stale" | "indexing" | "ready" | "error";

export type EmbeddingConfig = {
  dimension: number | null;
  errorCode: string | null;
  hasKey: boolean;
  model: string;
  provider: EmbeddingProviderKind | null;
  state: EmbeddingState;
  url: string;
  workspaceId: string;
};

export type EmbeddingSyncResult = {
  errorCode: string | null;
  state: EmbeddingState;
  totalObjects: number;
  vectorsDeleted: number;
  vectorsWritten: number;
};

export type FetchLike = typeof fetch;

type EmbeddingAdapterOptions = {
  apiKey?: string;
  request?: FetchLike;
};

type EmbeddingAdapterConfig = Pick<EmbeddingConfig, "dimension" | "model" | "provider" | "url">;

export interface EmbeddingAdapter {
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export class EmbeddingAdapterError extends Error {
  readonly status?: number;

  constructor(
    readonly code: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "EmbeddingAdapterError";
    this.status = status;
  }
}

const safeErrorCodePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function sanitizeEmbeddingErrorCode(error: unknown) {
  if (error instanceof EmbeddingAdapterError && safeErrorCodePattern.test(error.code)) {
    return error.code.toLowerCase();
  }
  if (typeof error === "object" && error && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (safeErrorCodePattern.test(code)) return code.toLowerCase();
  }
  return "embedding_failed";
}

export function validateEmbeddingConfigInput(input: {
  dimension?: unknown;
  model?: unknown;
  provider?: unknown;
  url?: unknown;
}) {
  if (input.provider !== "ollama" && input.provider !== "openai-compatible") {
    throw new EmbeddingAdapterError(
      "embedding_provider_invalid",
      "O provedor de embeddings informado é inválido.",
    );
  }
  if (typeof input.url !== "string" || !input.url.trim()) {
    throw new EmbeddingAdapterError(
      "embedding_url_required",
      "Informe a URL do provedor de embeddings.",
    );
  }
  let url: URL;
  try {
    url = new URL(input.url.trim());
  } catch {
    throw new EmbeddingAdapterError("embedding_url_invalid", "A URL do provedor é inválida.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EmbeddingAdapterError(
      "embedding_url_protocol_invalid",
      "A URL do provedor precisa usar HTTP ou HTTPS.",
    );
  }
  if (typeof input.model !== "string" || !input.model.trim()) {
    throw new EmbeddingAdapterError(
      "embedding_model_required",
      "Informe explicitamente o modelo de embeddings.",
    );
  }
  if (input.model.trim().length > 256) {
    throw new EmbeddingAdapterError(
      "embedding_model_invalid",
      "O modelo de embeddings é inválido.",
    );
  }
  if (
    input.dimension !== undefined &&
    input.dimension !== null &&
    (typeof input.dimension !== "number" ||
      !Number.isSafeInteger(input.dimension) ||
      input.dimension <= 0 ||
      input.dimension > 65_536)
  ) {
    throw new EmbeddingAdapterError(
      "embedding_dimension_invalid",
      "A dimensão do embedding precisa ser um inteiro positivo.",
    );
  }
  return {
    dimension: (input.dimension as number | null | undefined) ?? null,
    model: input.model.trim(),
    provider: input.provider,
    url: url.toString().replace(/\/$/, ""),
  } satisfies EmbeddingAdapterConfig;
}

function endpoint(baseUrl: string, path: string) {
  return new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function requestHeaders(apiKey: string | undefined) {
  return {
    ...(apiKey?.trim() ? { authorization: `Bearer ${apiKey.trim()}` } : {}),
    "content-type": "application/json",
  };
}

function vectorError(code: string) {
  return new EmbeddingAdapterError(code, "O provedor retornou vetores de embeddings inválidos.");
}

function validateVectors(value: unknown, expectedCount: number) {
  if (!Array.isArray(value) || value.length !== expectedCount)
    throw vectorError("embedding_count_invalid");
  const vectors = value.map((vector) => {
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      vector.some((value) => typeof value !== "number" || !Number.isFinite(value))
    ) {
      throw vectorError("embedding_vector_invalid");
    }
    return vector as number[];
  });
  const dimension = vectors[0]?.length;
  if (!dimension || vectors.some((vector) => vector.length !== dimension)) {
    throw vectorError("embedding_dimension_mismatch");
  }
  return vectors;
}

async function parseResponse(response: Response) {
  if (!response.ok) {
    throw new EmbeddingAdapterError(
      `embedding_provider_http_${response.status}`,
      "O provedor de embeddings recusou o pedido.",
      response.status,
    );
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new EmbeddingAdapterError(
      "embedding_response_invalid_json",
      "O provedor de embeddings retornou uma resposta inválida.",
    );
  }
}

function sortedOpenAiVectors(value: unknown, expectedCount: number) {
  if (!Array.isArray(value) || value.length !== expectedCount)
    throw vectorError("embedding_count_invalid");
  const entries = value as Array<{ embedding?: unknown; index?: unknown }>;
  if (entries.some((entry) => !entry || typeof entry !== "object"))
    throw vectorError("embedding_response_invalid");
  const hasIndexes = entries.some((entry) => entry.index !== undefined);
  if (!hasIndexes)
    return validateVectors(
      entries.map((entry) => entry.embedding),
      expectedCount,
    );
  if (
    entries.some((entry) => !Number.isSafeInteger(entry.index)) ||
    new Set(entries.map((entry) => entry.index)).size !== expectedCount
  ) {
    throw vectorError("embedding_order_invalid");
  }
  const ordered = [...entries].sort((left, right) => Number(left.index) - Number(right.index));
  if (ordered.some((entry, index) => entry.index !== index))
    throw vectorError("embedding_order_invalid");
  return validateVectors(
    ordered.map((entry) => entry.embedding),
    expectedCount,
  );
}

function adapterRequestError(error: unknown): EmbeddingAdapterError {
  if (error instanceof EmbeddingAdapterError) return error;
  return new EmbeddingAdapterError(
    "embedding_connection_failed",
    "Não foi possível conectar ao provedor de embeddings.",
  );
}

export function createEmbeddingAdapter(
  config: EmbeddingAdapterConfig,
  options: EmbeddingAdapterOptions = {},
): EmbeddingAdapter {
  const request = options.request ?? fetch;
  const normalized = validateEmbeddingConfigInput(config);

  return {
    async embed(texts, signal) {
      if (!texts.length) return [];
      const body = {
        ...(normalized.dimension ? { dimensions: normalized.dimension } : {}),
        input: texts,
        model: normalized.model,
      };
      try {
        const response = await request(
          endpoint(normalized.url, normalized.provider === "ollama" ? "/api/embed" : "/embeddings"),
          {
            body: JSON.stringify(body),
            headers: requestHeaders(options.apiKey),
            method: "POST",
            signal,
          },
        );
        const parsed = await parseResponse(response);
        if (normalized.provider === "ollama") {
          const record = parsed as { embeddings?: unknown };
          const vectors = validateVectors(record.embeddings, texts.length);
          if (
            normalized.dimension &&
            vectors.some((vector) => vector.length !== normalized.dimension)
          ) {
            throw vectorError("embedding_dimension_mismatch");
          }
          return vectors;
        }
        const record = parsed as { data?: unknown };
        const vectors = sortedOpenAiVectors(record.data, texts.length);
        if (
          normalized.dimension &&
          vectors.some((vector) => vector.length !== normalized.dimension)
        ) {
          throw vectorError("embedding_dimension_mismatch");
        }
        return vectors;
      } catch (error) {
        throw adapterRequestError(error);
      }
    },
  };
}

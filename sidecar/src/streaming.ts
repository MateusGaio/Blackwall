// MIT License — Copyright (c) 2026 Mateus Gaio
import { withAsyncInstrumentation } from "./observability.js";
import {
  createProviderAdapter,
  getProvider,
  type Provider,
  ProviderHttpError,
  providerApiKey,
  providerDataDirectory,
} from "./providers.js";

type StreamMessage = { content: string; role: "assistant" | "system" | "user" };
type StreamDelta = (content: string) => void;
type FetchLike = typeof fetch;

export class ProviderRequestError extends ProviderHttpError {
  constructor(status: number) {
    super(status, "obter uma resposta");
    this.name = "ProviderRequestError";
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    return error.retryable;
  }
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

function parseLine(line: string, ollama: boolean): string | null {
  const value = ollama ? line : line.startsWith("data:") ? line.slice(5).trim() : "";
  if (!value || value === "[DONE]") return null;
  try {
    const body = JSON.parse(value) as {
      choices?: Array<{ delta?: { content?: string } }>;
      message?: { content?: string };
    };
    return (ollama ? body.message?.content : body.choices?.[0]?.delta?.content) ?? null;
  } catch {
    return null;
  }
}

async function readStream(body: ReadableStream<Uint8Array>, ollama: boolean, onDelta: StreamDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const delta = parseLine(line.trim(), ollama);
      if (delta) onDelta(delta);
    }
  }
  const finalDelta = parseLine(buffer.trim(), ollama);
  if (finalDelta) onDelta(finalDelta);
}

export async function streamChatMessage(
  providerId: string,
  messages: StreamMessage[],
  modelOverride: string | undefined,
  onDelta: StreamDelta,
  signal: AbortSignal,
  request: FetchLike = fetch,
  dataDirectory = providerDataDirectory(),
): Promise<{ provider: Provider }> {
  const provider = await getProvider(providerId, dataDirectory);
  const apiKey = await providerApiKey(providerId, dataDirectory);
  const model = modelOverride?.trim() || provider.model;
  const ollama = provider.type === "ollama";
  if (process.env.BLACKWALL_E2E_MOCK === "1") {
    onDelta("Resposta ");
    onDelta("de teste.");
    return { provider };
  }
  const adapter = createProviderAdapter({
    apiKey,
    baseUrl: provider.baseUrl,
    model,
    name: provider.name,
    type: provider.type,
  });
  const requestInit = adapter.chatRequest(model, messages, signal);
  const response = await withAsyncInstrumentation("provider.chat.stream", () =>
    request(requestInit.endpoint, requestInit),
  );
  if (!response.ok) throw new ProviderRequestError(response.status);
  if (!response.body) throw new Error("O provedor não abriu um canal de streaming.");
  await readStream(response.body, ollama, onDelta);
  return { provider };
}

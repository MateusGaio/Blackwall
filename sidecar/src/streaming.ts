// MIT License — Copyright (c) 2026 Mateus Gaio
import { withAsyncInstrumentation } from "./observability.js";
import { getProvider, type Provider, providerApiKey } from "./providers.js";

type StreamMessage = { content: string; role: "assistant" | "system" | "user" };
type StreamDelta = (content: string) => void;
type FetchLike = typeof fetch;

class ProviderRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`O provedor respondeu com HTTP ${status}.`);
    this.name = "ProviderRequestError";
    this.status = status;
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
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
): Promise<{ provider: Provider }> {
  const provider = await getProvider(providerId);
  const apiKey = await providerApiKey(providerId);
  const model = modelOverride?.trim() || provider.model;
  const ollama = provider.type === "ollama";
  const response = await withAsyncInstrumentation("provider.chat.stream", () =>
    request(ollama ? `${provider.baseUrl}/api/chat` : `${provider.baseUrl}/chat/completions`, {
      body: JSON.stringify({ messages, model, stream: true }),
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    }),
  );
  if (!response.ok) throw new ProviderRequestError(response.status);
  if (!response.body) throw new Error("O provedor não abriu um canal de streaming.");
  await readStream(response.body, ollama, onDelta);
  return { provider };
}

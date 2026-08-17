// MIT License — Copyright (c) 2026 Mateus Gaio

import { withAsyncInstrumentation, withInstrumentation } from "./observability.js";
import {
  getProvider,
  messagesToResponsesInput,
  type Provider,
  ProviderHttpError,
  providerApiKey,
  providerDataDirectory,
} from "./providers.js";
import type { ResolvedProtocol, ToolCall } from "./tool-contract.js";
import {
  normalizeTokenUsage,
  parseRateLimitHeaders,
  type TokenUsage,
  type UsageWindow,
} from "./usage.js";

export type ChatMessage = {
  content: string;
  isSummary?: boolean;
  name?: string;
  role: "assistant" | "system" | "tool" | "user";
  toolCallId?: string;
  toolCalls?: ToolCall[];
  tool_call_id?: string;
  tool_calls?: Array<{
    function: { arguments: string; name: string };
    id: string;
    type: "function";
  }>;
};
type FetchLike = typeof fetch;

type CompleteChatOptions = {
  dataDirectory?: string;
  protocol?: ResolvedProtocol;
  purpose?: "chat" | "compaction";
  request?: FetchLike;
  signal?: AbortSignal;
};

type CompleteChatResponse = {
  content: string;
  provider: Provider;
  tokens?: TokenUsage;
  windows: UsageWindow[];
};

function providerMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(({ isSummary: _isSummary, ...message }) => message);
}

function responseContent(body: Record<string, unknown>, protocol: ResolvedProtocol): string {
  if (protocol === "ollama-chat") {
    const message = body.message;
    return message && typeof message === "object"
      ? String((message as Record<string, unknown>).content ?? "")
      : "";
  }
  if (protocol === "openai-responses") {
    if (typeof body.output_text === "string") return body.output_text;
    const output = Array.isArray(body.output) ? body.output : [];
    return output
      .flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const content = (item as Record<string, unknown>).content;
        if (!Array.isArray(content)) return [];
        return content.flatMap((part) => {
          if (!part || typeof part !== "object") return [];
          const text = (part as Record<string, unknown>).text;
          return typeof text === "string" ? [text] : [];
        });
      })
      .join("");
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const message = choices[0];
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).message;
  return content && typeof content === "object"
    ? String((content as Record<string, unknown>).content ?? "")
    : "";
}

export async function sendChatMessage(
  providerId: string,
  messages: ChatMessage[],
  modelOverride?: string,
  request: FetchLike = fetch,
): Promise<{ content: string; provider: Provider }> {
  const provider = await getProvider(providerId);
  const apiKey = await providerApiKey(providerId);
  const isOllama = provider.type === "ollama";
  const model = modelOverride?.trim() || provider.model;
  const response = await withInstrumentation("provider.chat", () =>
    request(isOllama ? `${provider.baseUrl}/api/chat` : `${provider.baseUrl}/chat/completions`, {
      body: JSON.stringify(
        isOllama ? { messages, model, stream: false } : { messages, model, stream: false },
      ),
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      `Não foi possível obter resposta (HTTP ${response.status}). Revise o provedor ou tente novamente.`,
    );
  }
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    message?: { content?: string };
  };
  const content = (isOllama ? body.message?.content : body.choices?.[0]?.message?.content)?.trim();
  if (!content)
    throw new Error("O provedor não retornou uma mensagem utilizável. Tente outro modelo.");
  return { content, provider };
}

export async function completeChatMessage(
  providerId: string,
  messages: ChatMessage[],
  modelOverride: string | undefined,
  options: CompleteChatOptions = {},
): Promise<CompleteChatResponse> {
  const dataDirectory = options.dataDirectory ?? providerDataDirectory();
  const request = options.request ?? fetch;
  const provider = await getProvider(providerId, dataDirectory);
  const apiKey = await providerApiKey(providerId, dataDirectory);
  const model = modelOverride?.trim() || provider.model;
  const protocol = options.protocol ?? (provider.type === "ollama" ? "ollama-chat" : "openai-chat");
  if (
    options.purpose === "compaction" &&
    (process.env.BLACKWALL_E2E_MOCK === "1" || process.env.BLACKWALL_E2E_AGENT === "1")
  ) {
    return {
      content:
        "## Objetivo\n\nResumo determinístico do contexto anterior.\n\n## Próximos passos\n\nContinuar a tarefa atual.",
      provider,
      windows: [],
    };
  }
  const cleanMessages = providerMessages(messages);
  const isOllama = protocol === "ollama-chat";
  const baseUrl = provider.baseUrl.replace(/\/(?:api|v1)(?:\/(?:api|v1))*$/i, "");
  const endpoint = isOllama
    ? `${baseUrl}/api/chat`
    : protocol === "openai-responses"
      ? `${provider.baseUrl}/responses`
      : `${provider.baseUrl}/chat/completions`;
  const body = isOllama
    ? { messages: cleanMessages, model, stream: false }
    : protocol === "openai-responses"
      ? { input: messagesToResponsesInput(cleanMessages), model, store: false, stream: false }
      : { messages: cleanMessages, model, stream: false };
  const response = await withAsyncInstrumentation("provider.chat.complete", () =>
    request(endpoint, {
      body: JSON.stringify(body),
      headers: {
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        "content-type": "application/json",
      },
      method: "POST",
      signal: options.signal,
    }),
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new ProviderHttpError(response.status, "obter o resumo da conversa");
    if (detail.trim())
      error.message = `${error.message} Detalhe do provedor: ${detail.trim().slice(0, 500)}`;
    throw error;
  }
  const bodyJson = (await response.json()) as Record<string, unknown>;
  const content = responseContent(bodyJson, protocol).trim();
  if (!content) throw new Error("O provedor não retornou um resumo utilizável.");
  return {
    content,
    provider,
    tokens: normalizeTokenUsage(bodyJson),
    windows: parseRateLimitHeaders(response.headers),
  };
}

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
import {
  parseCompatibilityToolCall,
  type ToolCall,
  type ToolDefinition,
  type ToolMode,
  type ToolName,
} from "./tool-contract.js";

export type StreamMessage = {
  content: string;
  name?: string;
  role: "assistant" | "system" | "tool" | "user";
  toolCallId?: string;
  toolCalls?: ToolCall[];
  tool_call_id?: string;
  tool_calls?: Array<{
    function: { arguments: string | Record<string, unknown>; name: string };
    id: string;
    type: "function";
  }>;
};
type StreamDelta = (content: string) => void;
type FetchLike = typeof fetch;

export type StreamOptions = {
  toolMode?: ToolMode;
  tools?: ToolDefinition[];
  onToolCall?: (call: ToolCall) => void;
};

export type StreamResponse = {
  content: string;
  provider: Provider;
  toolCalls: ToolCall[];
};

const harnessContext = `# Blackwall Context

## Objetivo

Projeto de teste usado para validar a exploração local do Blackwall.

## Stack e dependências

TypeScript com scripts Node e testes automatizados.

## Estrutura relevante

- [entrada](src/index.ts)
- [testes](tests/index.test.ts)

## Documentação

Consulte [[README]] e [[ARCHITECTURE]].

## Fluxos principais

O ponto de entrada executa a função principal e os testes validam o comportamento.

## Qualidade, observabilidade e persistência

Os comandos e decisões encontrados estão descritos nas notas do projeto.

## Riscos e próximos passos

Manter os testes verdes e revisar as lacunas documentadas em [[ARCHITECTURE]].
`;

export function scriptedHarnessTurn(messages: StreamMessage[]): {
  content: string;
  toolCalls: ToolCall[];
} | null {
  const request = [...messages].reverse().find((message) => message.role === "user")?.content ?? "";
  if (!request.includes("Explore o workspace selecionado")) return null;
  const results = messages.filter((message) => message.role === "tool");
  const step = results.length;
  const calls: Array<{ arguments: Record<string, unknown>; name: ToolName }> = [
    { arguments: { path: "." }, name: "list_directory" },
    // Intentionally malformed: the agent runtime must repair the missing args and workspace alias.
    { arguments: { command: "node --version", cwd: "/workspace" }, name: "execute_command" },
    { arguments: { path: "README.md" }, name: "read_file" },
    { arguments: { path: "ARCHITECTURE.md" }, name: "read_file" },
    { arguments: { path: "src/index.ts" }, name: "read_file" },
    { arguments: { path: "tests/index.test.ts" }, name: "read_file" },
    {
      arguments: { content: harnessContext, path: "BLACKWALL_CONTEXT.md" },
      name: "create_or_update_file",
    },
    { arguments: { path: "BLACKWALL_CONTEXT.md" }, name: "read_file" },
  ];
  const next = calls[step];
  if (!next) {
    return {
      content:
        "Workspace analisado. Criei e validei BLACKWALL_CONTEXT.md na raiz, com wikilinks para README e ARCHITECTURE e links para o código e os testes.",
      toolCalls: [],
    };
  }
  return {
    content: "",
    toolCalls: [
      {
        arguments: JSON.stringify(next.arguments),
        id: `harness-tool-${step + 1}`,
        name: next.name,
      },
    ],
  };
}

/** Provider-neutral events emitted by a streaming adapter. */
export type ProviderStreamEvent =
  | { type: "text.delta"; text: string }
  | { call: ToolCall; type: "tool.call.completed" }
  | { arguments: string; id: string; type: "tool.call.delta" }
  | { type: "stream.completed" };

class ProviderRequestError extends ProviderHttpError {
  constructor(status: number, detail = "") {
    super(status, "obter uma resposta");
    this.name = "ProviderRequestError";
    const normalizedDetail = detail.replace(/\s+/g, " ").trim().slice(0, 500);
    if (normalizedDetail) this.message = `${this.message} Detalhe do provedor: ${normalizedDetail}`;
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

type ParsedToolCall = { arguments: string; id: string; name?: string };
type ParsedChunk = { content?: string; toolCalls?: ParsedToolCall[] };

function messagesForProvider(messages: StreamMessage[], ollama: boolean): StreamMessage[] {
  if (!ollama) return messages;
  return messages.map((message) => {
    if (!message.tool_calls?.length) return message;
    return {
      ...message,
      tool_calls: message.tool_calls.map((call) => {
        let argumentsValue: string | Record<string, unknown> = call.function.arguments;
        if (typeof argumentsValue === "string") {
          try {
            const parsed = JSON.parse(argumentsValue) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              argumentsValue = parsed as Record<string, unknown>;
            }
          } catch {
            // Keep malformed arguments as text so the provider can return a useful error.
          }
        }
        return { ...call, function: { ...call.function, arguments: argumentsValue } };
      }),
    };
  });
}

function parseLine(line: string, ollama: boolean): ParsedChunk | null {
  const value = ollama
    ? line
    : line.startsWith("data:")
      ? line.slice(5).trim()
      : line.startsWith("{")
        ? line
        : "";
  if (!value || value === "[DONE]") return null;
  try {
    const body = JSON.parse(value) as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            function?: { arguments?: string | Record<string, unknown>; name?: string };
            id?: string;
            index?: number;
          }>;
        };
        message?: {
          content?: string;
          tool_calls?: Array<{
            function?: { arguments?: string | Record<string, unknown>; name?: string };
            id?: string;
            index?: number;
          }>;
        };
      }>;
      message?: {
        content?: string;
        tool_calls?: Array<{
          function?: { arguments?: string | Record<string, unknown>; name?: string };
          id?: string;
          index?: number;
        }>;
      };
    };
    const source = ollama ? body.message : (body.choices?.[0]?.delta ?? body.choices?.[0]?.message);
    const calls = source?.tool_calls
      ?.map((call, index) => ({
        arguments:
          typeof call.function?.arguments === "string"
            ? call.function.arguments
            : JSON.stringify(call.function?.arguments ?? {}),
        id: `tool-call-${call.index ?? index}`,
        name: call.function?.name,
        index,
      }))
      .map((call) => ({
        arguments: call.arguments,
        id: call.id,
        name: call.name,
      }));
    return { content: source?.content, toolCalls: calls };
  } catch {
    return null;
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  ollama: boolean,
  onDelta: StreamDelta,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const calls = new Map<string, ParsedToolCall>();
  const consume = (line: string) => {
    const chunk = parseLine(line.trim(), ollama);
    if (!chunk) return;
    if (chunk.content) {
      content += chunk.content;
      onDelta(chunk.content);
    }
    for (const call of chunk.toolCalls ?? []) {
      const current = calls.get(call.id);
      calls.set(call.id, {
        arguments: `${current?.arguments ?? ""}${call.arguments}`,
        id: call.id,
        name: current?.name ?? call.name,
      });
    }
  };
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  consume(buffer);
  return {
    content,
    toolCalls: [...calls.values()].filter((call): call is ToolCall =>
      Boolean(call.name),
    ) as ToolCall[],
  };
}

export async function streamChatMessage(
  providerId: string,
  messages: StreamMessage[],
  modelOverride: string | undefined,
  onDelta: StreamDelta,
  signal: AbortSignal,
  request: FetchLike = fetch,
  dataDirectory = providerDataDirectory(),
  options: StreamOptions = {},
): Promise<StreamResponse> {
  const provider = await getProvider(providerId, dataDirectory);
  const apiKey = await providerApiKey(providerId, dataDirectory);
  const model = modelOverride?.trim() || provider.model;
  const ollama = provider.type === "ollama";
  if (process.env.BLACKWALL_E2E_AGENT === "1") {
    const scripted = scriptedHarnessTurn(messages);
    if (scripted) {
      if (scripted.content) onDelta(scripted.content);
      for (const call of scripted.toolCalls) options.onToolCall?.(call);
      return { ...scripted, provider };
    }
  }
  if (process.env.BLACKWALL_E2E_MOCK === "1") {
    onDelta("Resposta ");
    onDelta("de teste.");
    return { content: "Resposta de teste.", provider, toolCalls: [] };
  }
  const adapter = createProviderAdapter({
    apiKey,
    baseUrl: provider.baseUrl,
    model,
    name: provider.name,
    type: provider.type,
  });
  const requestInit = adapter.chatRequest(
    model,
    messagesForProvider(messages, ollama),
    signal,
    options,
  );
  const response = await withAsyncInstrumentation("provider.chat.stream", () =>
    request(requestInit.endpoint, requestInit),
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderRequestError(response.status, detail);
  }
  if (!response.body) throw new Error("O provedor não abriu um canal de streaming.");
  const result = await readStream(
    response.body,
    ollama,
    options.toolMode === "compatibility" ? () => undefined : onDelta,
  );
  const compatibilityCall =
    options.toolMode === "compatibility" ? parseCompatibilityToolCall(result.content) : null;
  const toolCalls = compatibilityCall ? [compatibilityCall] : result.toolCalls;
  for (const call of toolCalls) options.onToolCall?.(call);
  return { content: compatibilityCall ? "" : result.content, provider, toolCalls };
}

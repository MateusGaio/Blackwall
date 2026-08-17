// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { withAsyncInstrumentation } from "./observability.js";
import {
  createProviderAdapter,
  getProvider,
  type ParallelToolCallsMode,
  type Provider,
  ProviderHttpError,
  providerApiKey,
  providerDataDirectory,
} from "./providers.js";
import type { ResolvedProtocol } from "./tool-contract.js";
import {
  capabilityProbeTool,
  parseCompatibilityToolCall,
  parseToolArguments,
  type ToolCall,
  type ToolDefinition,
  type ToolMode,
  type ToolName,
} from "./tool-contract.js";
import {
  normalizeTokenUsage,
  parseRateLimitHeaders,
  type TokenUsage,
  type UsageWindow,
} from "./usage.js";

export type StreamMessage = {
  content: string;
  isSummary?: boolean;
  name?: string;
  role: "assistant" | "system" | "tool" | "user";
  tool_name?: string;
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
  protocol?: ResolvedProtocol;
  toolMode?: ToolMode;
  tools?: ToolDefinition[];
  onToolCall?: (call: ToolCall) => void;
  parallelToolCalls?: ParallelToolCallsMode;
};

export type StreamResponse = {
  content: string;
  provider: Provider;
  toolCalls: ToolCall[];
  tokens?: TokenUsage;
  windows: UsageWindow[];
};

export type CapabilityProbeResult = {
  protocol: ResolvedProtocol;
  support: "native" | "unsupported" | "probe-error";
  errorCode?: string;
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
  | { delta: string; type: "text.delta" }
  | { call: ToolCall; type: "tool.call.completed" }
  | { arguments: string; id?: string; index: number; name?: string; type: "tool.call.delta" }
  | { type: "stream.completed" };

export class ProviderRequestError extends ProviderHttpError {
  readonly windows: UsageWindow[];

  constructor(status: number, detail = "", headers?: Headers) {
    super(status, "obter uma resposta");
    this.name = "ProviderRequestError";
    this.windows = headers ? parseRateLimitHeaders(headers) : [];
    const normalizedDetail = detail.replace(/\s+/g, " ").trim().slice(0, 500);
    if (normalizedDetail) this.message = `${this.message} Detalhe do provedor: ${normalizedDetail}`;
  }
}

export function isRetryableProviderError(error: unknown): boolean {
  if (error instanceof ProviderRequestError) return error.retryable;
  return error instanceof TypeError || (error instanceof Error && error.name === "AbortError");
}

type ParsedToolCall = {
  arguments: string;
  id?: string;
  index: number;
  name?: string;
  replaceArguments?: boolean;
};
type ParsedChunk = { content?: string; toolCalls?: ParsedToolCall[]; tokens?: TokenUsage };

function messagesForProvider(messages: StreamMessage[], ollama: boolean): StreamMessage[] {
  if (!ollama) return messages;
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        content: message.content,
        role: "tool",
        tool_name: message.name ?? message.tool_name ?? "tool",
      };
    }
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

function parseLine(line: string, protocol: ResolvedProtocol): ParsedChunk | null {
  const ollama = protocol === "ollama-chat";
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
      arguments?: string;
      delta?: string;
      item?: {
        arguments?: string;
        call_id?: string;
        id?: string;
        name?: string;
        type?: string;
      };
      item_id?: string;
      message?: {
        content?: string;
        tool_calls?: Array<{
          function?: { arguments?: string | Record<string, unknown>; name?: string };
          id?: string;
          index?: number;
        }>;
      };
      output?: Array<{
        arguments?: string;
        call_id?: string;
        id?: string;
        name?: string;
        type?: string;
      }>;
      output_index?: number;
      response?: { usage?: Record<string, unknown> };
      usage?: Record<string, unknown>;
      prompt_eval_count?: number;
      eval_count?: number;
      type?: string;
    };
    if (protocol === "openai-responses") {
      if (body.type === "response.completed" && body.response?.usage) {
        return { tokens: normalizeTokenUsage({ usage: body.response.usage }) };
      }
      if (body.type === "response.output_text.delta") return { content: body.delta };
      if (body.type === "response.function_call_arguments.delta") {
        return {
          toolCalls: [
            {
              arguments: body.delta ?? "",
              id: body.item?.call_id ?? body.item?.id,
              index: body.output_index ?? 0,
              name: body.item?.name,
            },
          ],
        };
      }
      if (
        (body.type === "response.function_call_arguments.done" ||
          body.type === "response.output_item.done") &&
        (body.item?.type === "function_call" ||
          body.type === "response.function_call_arguments.done")
      ) {
        return {
          toolCalls: [
            {
              arguments: body.item?.arguments ?? body.arguments ?? body.delta ?? "",
              id: body.item?.call_id ?? body.item?.id ?? body.item_id,
              index: body.output_index ?? 0,
              name: body.item?.name,
              replaceArguments: true,
            },
          ],
        };
      }
      if (body.type === "response.output_item.added" && body.item?.type === "function_call") {
        return {
          toolCalls: [
            {
              arguments: body.item.arguments ?? "",
              id: body.item.call_id ?? body.item.id,
              index: body.output_index ?? 0,
              name: body.item.name,
              replaceArguments: Boolean(body.item.arguments),
            },
          ],
        };
      }
      if (Array.isArray(body.output)) {
        return {
          toolCalls: body.output
            .filter((item) => item.type === "function_call")
            .map((item, index) => ({
              arguments: item.arguments ?? "",
              id: item.call_id ?? item.id,
              index,
              name: item.name,
            })),
        };
      }
      return null;
    }
    const source = ollama ? body.message : (body.choices?.[0]?.delta ?? body.choices?.[0]?.message);
    const calls = source?.tool_calls?.map((call, index) => ({
      arguments:
        typeof call.function?.arguments === "string"
          ? call.function.arguments
          : JSON.stringify(call.function?.arguments ?? {}),
      id: call.id,
      index: call.index ?? index,
      name: call.function?.name,
    }));
    return {
      content: source?.content,
      toolCalls: calls,
      tokens: normalizeTokenUsage({
        ...(body.usage ?? {}),
        eval_count: body.eval_count,
        prompt_eval_count: body.prompt_eval_count,
      }),
    };
  } catch {
    return null;
  }
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  protocol: ResolvedProtocol,
  onDelta: StreamDelta,
): Promise<{ content: string; toolCalls: ToolCall[]; tokens?: TokenUsage }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let tokens: TokenUsage | undefined;
  const calls = new Map<string, ParsedToolCall>();
  const callKeysByIndex = new Map<number, string>();
  const consume = (line: string) => {
    const chunk = parseLine(line.trim(), protocol);
    if (!chunk) return;
    if (chunk.content) {
      content += chunk.content;
      onDelta(chunk.content);
    }
    if (chunk.tokens) tokens = { ...tokens, ...chunk.tokens };
    for (const call of chunk.toolCalls ?? []) {
      // Providers commonly send the id only in the first fragment. Index is
      // the stable correlation key for all subsequent fragments.
      const key = call.id ? `id:${call.id}` : `index:${call.index}`;
      const correlatedKey = call.id ? key : (callKeysByIndex.get(call.index) ?? key);
      if (call.id) callKeysByIndex.set(call.index, key);
      const current = calls.get(correlatedKey);
      calls.set(correlatedKey, {
        arguments: call.replaceArguments
          ? call.arguments
          : `${current?.arguments ?? ""}${call.arguments}`,
        id: current?.id ?? call.id,
        index: current?.index ?? call.index,
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
    toolCalls: [...calls.values()]
      .filter((call): call is ParsedToolCall & { name: string } => Boolean(call.name))
      .map((call) => ({
        arguments: call.arguments,
        id: call.id ?? `tool-call-${call.index}`,
        name: call.name as ToolName,
      })),
    tokens,
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
  const protocol = options.protocol ?? (provider.type === "ollama" ? "ollama-chat" : "openai-chat");
  if (process.env.BLACKWALL_E2E_AGENT === "1") {
    const scripted = scriptedHarnessTurn(messages);
    if (scripted) {
      if (scripted.content) onDelta(scripted.content);
      for (const call of scripted.toolCalls) options.onToolCall?.(call);
      return { ...scripted, provider, windows: [] };
    }
  }
  if (process.env.BLACKWALL_E2E_MOCK === "1") {
    onDelta("Resposta ");
    onDelta("de teste.");
    return { content: "Resposta de teste.", provider, toolCalls: [], windows: [] };
  }
  const adapter = createProviderAdapter({
    apiKey,
    baseUrl: provider.baseUrl,
    model,
    name: provider.name,
    type: provider.type,
  });
  const providerMessages = messagesForProvider(messages, protocol === "ollama-chat").map(
    ({ isSummary: _isSummary, ...message }) => message,
  );
  const requestInit = adapter.chatRequest(model, providerMessages, signal, options);
  const response = await withAsyncInstrumentation("provider.chat.stream", () =>
    request(requestInit.endpoint, requestInit),
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ProviderRequestError(response.status, detail, response.headers);
  }
  if (!response.body) throw new Error("O provedor não abriu um canal de streaming.");
  const result = await readStream(
    response.body,
    protocol,
    options.toolMode === "compatibility" ? () => undefined : onDelta,
  );
  const compatibilityCall =
    options.toolMode === "compatibility" ? parseCompatibilityToolCall(result.content) : null;
  const toolCalls = compatibilityCall ? [compatibilityCall] : result.toolCalls;
  for (const call of toolCalls) options.onToolCall?.(call);
  return {
    content: compatibilityCall ? "" : result.content,
    provider,
    toolCalls,
    tokens: result.tokens,
    windows: parseRateLimitHeaders(response.headers),
  };
}

/**
 * Probe only the provider protocol. The capability tool is deliberately
 * internal and cannot touch the workspace, so syncing models never executes
 * user code or sends file contents.
 */
export async function probeProviderTools(
  providerId: string,
  model: string,
  protocol: ResolvedProtocol,
  request: FetchLike = fetch,
  dataDirectory = providerDataDirectory(),
): Promise<CapabilityProbeResult> {
  const nonce = randomUUID();
  try {
    const first = await streamChatMessage(
      providerId,
      [
        { content: "Use the capability probe tool exactly once.", role: "system" },
        { content: `Probe nonce: ${nonce}`, role: "user" },
      ],
      model,
      () => undefined,
      new AbortController().signal,
      request,
      dataDirectory,
      { protocol, toolMode: "auto", tools: [capabilityProbeTool] },
    );
    const call = first.toolCalls[0];
    if (call?.name !== "blackwall_capability_probe") return { protocol, support: "unsupported" };
    const args = parseToolArguments("blackwall_capability_probe", call.arguments);
    if (args.nonce !== nonce)
      return { protocol, support: "probe-error", errorCode: "nonce_mismatch" };
    const second = await streamChatMessage(
      providerId,
      [
        { content: "Use the capability probe tool exactly once.", role: "system" },
        { content: `Probe nonce: ${nonce}`, role: "user" },
        {
          content: "",
          role: "assistant",
          tool_calls: [
            {
              function: { arguments: call.arguments, name: call.name },
              id: call.id,
              type: "function",
            },
          ],
        },
        {
          content: JSON.stringify({ nonce, ok: true }),
          name: call.name,
          role: "tool",
          tool_call_id: call.id,
        },
      ],
      model,
      () => undefined,
      new AbortController().signal,
      request,
      dataDirectory,
      { protocol, toolMode: "disabled" },
    );
    return second.content.trim()
      ? { protocol, support: "native" }
      : { protocol, support: "probe-error", errorCode: "empty_probe_completion" };
  } catch (error) {
    return {
      protocol,
      support: "probe-error",
      errorCode: error instanceof ProviderHttpError ? `http_${error.status}` : "probe_failed",
    };
  }
}

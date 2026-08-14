// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProvider } from "./providers.js";
import {
  isRetryableProviderError,
  probeProviderTools,
  scriptedHarnessTurn,
  streamChatMessage,
} from "./streaming.js";

const directories: string[] = [];

afterEach(async () => {
  delete process.env.BLACKWALL_DATA_DIR;
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function responseWithLines(lines: string[]) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const line of lines) controller.enqueue(new TextEncoder().encode(`${line}\n`));
        controller.close();
      },
    }),
    { status: 200 },
  );
}

describe("streaming de provedores", () => {
  it("roteiriza o cenário determinístico e inclui uma chamada reparável", () => {
    const prompt = { content: "Explore o workspace selecionado", role: "user" as const };
    expect(scriptedHarnessTurn([prompt])?.toolCalls[0]).toMatchObject({
      name: "list_directory",
    });
    expect(
      scriptedHarnessTurn([
        prompt,
        { content: '{"entries":[]}', name: "list_directory", role: "tool" },
      ])?.toolCalls[0],
    ).toMatchObject({
      arguments: '{"command":"node --version","cwd":"/workspace"}',
      name: "execute_command",
    });
  });
  it("emite deltas de OpenAI-compatible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "stream-key",
      baseUrl: "https://example.com/v1",
      model: "example-model",
      name: "Example",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines([
          'data: {"choices":[{"delta":{"content":"Olá"}}]}',
          'data: {"choices":[{"delta":{"content":" mundo"}}]}',
          "data: [DONE]",
        ]),
      ) as unknown as typeof fetch;
    const deltas: string[] = [];
    const result = await streamChatMessage(
      provider.id,
      [{ content: "Oi", role: "user" }],
      undefined,
      (delta) => deltas.push(delta),
      new AbortController().signal,
      request,
    );
    expect(deltas.join("")).toBe("Olá mundo");
    expect(result.provider.id).toBe(provider.id);
  });

  it("classifica 429 como erro elegível para fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-error-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "stream-key",
      baseUrl: "https://example.com/v1",
      model: "example-model",
      name: "Example",
    });
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 429 })) as unknown as typeof fetch;
    try {
      await streamChatMessage(
        provider.id,
        [{ content: "Oi", role: "user" }],
        undefined,
        () => undefined,
        new AbortController().signal,
        request,
      );
      throw new Error("stream deveria falhar");
    } catch (error) {
      expect(isRetryableProviderError(error)).toBe(true);
    }
  });

  it("mostra respostas JSON não-streaming de endpoints compatíveis", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-json-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "stream-key",
      baseUrl: "https://example.com/v1",
      model: "example-model",
      name: "Example",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines(['{"choices":[{"message":{"content":"Resposta completa"}}]}']),
      ) as unknown as typeof fetch;
    const deltas: string[] = [];
    await streamChatMessage(
      provider.id,
      [{ content: "Oi", role: "user" }],
      undefined,
      (delta) => deltas.push(delta),
      new AbortController().signal,
      request,
    );
    expect(deltas.join("")).toBe("Resposta completa");
  });

  it("acumula tool calls fragmentados do OpenAI-compatible", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-tools-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "stream-key",
      baseUrl: "https://example.com/v1",
      model: "example-model",
      name: "Example",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"provider-id","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"PRODUCT.md\\"}"}}]}}]}',
          "data: [DONE]",
        ]),
      ) as unknown as typeof fetch;
    const result = await streamChatMessage(
      provider.id,
      [{ content: "Leia", role: "user" }],
      undefined,
      () => undefined,
      new AbortController().signal,
      request,
    );
    expect(result.toolCalls).toEqual([
      { arguments: '{"path":"PRODUCT.md"}', id: "provider-id", name: "read_file" },
    ]);
  });

  it("acumula conteúdo e tool calls do streaming do Ollama", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-ollama-tools-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:7b",
      name: "Ollama",
      type: "ollama",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines([
          '{"message":{"content":"vou ler ","role":"assistant"}}',
          '{"message":{"tool_calls":[{"function":{"name":"read_file","arguments":{"path":"README.md"}}}]}}',
          '{"done":true}',
        ]),
      ) as unknown as typeof fetch;
    const deltas: string[] = [];
    const result = await streamChatMessage(
      provider.id,
      [{ content: "Leia", role: "user" }],
      undefined,
      (delta) => deltas.push(delta),
      new AbortController().signal,
      request,
    );
    expect(deltas.join("")).toBe("vou ler ");
    expect(result.toolCalls).toEqual([
      { arguments: '{"path":"README.md"}', id: "tool-call-0", name: "read_file" },
    ]);
  });

  it("envia resultados de ferramentas do Ollama com tool_name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-ollama-result-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:7b",
      name: "Ollama",
      type: "ollama",
    });
    let sentBody: Record<string, unknown> | undefined;
    const request = vi.fn((_url: string, init?: RequestInit) => {
      sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(responseWithLines(['{"message":{"content":"ok"}}']));
    }) as unknown as typeof fetch;
    await streamChatMessage(
      provider.id,
      [
        {
          content: "",
          role: "assistant",
          tool_calls: [
            {
              function: { arguments: '{"path":"README.md"}', name: "read_file" },
              id: "call_ollama",
              type: "function",
            },
          ],
        },
        {
          content: '{"ok":true}',
          name: "read_file",
          role: "tool",
          tool_call_id: "call_ollama",
        },
      ],
      provider.model,
      () => undefined,
      new AbortController().signal,
      request,
      directory,
      { protocol: "ollama-chat", toolMode: "disabled" },
    );
    expect(sentBody?.messages).toEqual([
      {
        content: "",
        role: "assistant",
        tool_calls: [
          {
            function: { arguments: { path: "README.md" }, name: "read_file" },
            id: "call_ollama",
            type: "function",
          },
        ],
      },
      { content: '{"ok":true}', role: "tool", tool_name: "read_file" },
    ]);
  });

  it("preserva call_id e argumentos fragmentados do protocolo Responses", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-responses-tools-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "stream-key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      name: "OpenAI",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines([
          'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_responses","name":"read_file","arguments":""}}',
          'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item_1","delta":"{\\"path\\":\\"README"}',
          'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"item_1","delta":".md\\"}"}',
          'data: {"type":"response.completed"}',
        ]),
      ) as unknown as typeof fetch;
    const result = await streamChatMessage(
      provider.id,
      [{ content: "Leia", role: "user" }],
      provider.model,
      () => undefined,
      new AbortController().signal,
      request,
      directory,
      { protocol: "openai-responses", toolMode: "auto" },
    );
    expect(result.toolCalls).toEqual([
      { arguments: '{"path":"README.md"}', id: "call_responses", name: "read_file" },
    ]);
  });

  it("faz probe nativo sem executar ferramentas do workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-probe-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      apiKey: "probe-key",
      baseUrl: "https://api.example.com/v1",
      model: "probe-model",
      name: "Probe provider",
    });
    let nonce = "";
    const request = vi.fn((_url: string, _init?: RequestInit) => {
      if (request.mock.calls.length === 1) {
        const body = JSON.parse(String(_init?.body)) as { messages?: Array<{ content?: string }> };
        nonce =
          body.messages
            ?.find((message) => message.content?.startsWith("Probe nonce:"))
            ?.content?.slice(13) ?? "";
        return Promise.resolve(
          responseWithLines([
            `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"probe-call","function":{"name":"blackwall_capability_probe","arguments":"{\\"nonce\\":\\"${nonce}\\"}"}}]}}]}`,
            "data: [DONE]",
          ]),
        );
      }
      return Promise.resolve(
        responseWithLines(['data: {"choices":[{"delta":{"content":"probe ok"}}]}', "data: [DONE]"]),
      );
    }) as unknown as typeof fetch;
    await expect(
      probeProviderTools(provider.id, provider.model, "openai-chat", request, directory),
    ).resolves.toMatchObject({ protocol: "openai-chat", support: "native" });
    expect(request).toHaveBeenCalledTimes(2);
    expect(nonce).not.toBe("");
  });

  it("envia argumentos estruturados ao Ollama ao continuar um ciclo de ferramenta", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-stream-ollama-follow-up-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const provider = await saveProvider({
      baseUrl: "http://127.0.0.1:11434",
      model: "qwen2.5-coder:7b",
      name: "Ollama",
      type: "ollama",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        responseWithLines(['{"message":{"content":"continuando"}}']),
      ) as unknown as typeof fetch;
    await streamChatMessage(
      provider.id,
      [
        {
          content: "",
          role: "assistant",
          tool_calls: [
            {
              function: { arguments: '{"path":"README.md"}', name: "read_file" },
              id: "call-1",
              type: "function",
            },
          ],
        },
        {
          content: '{"content":"ok"}',
          name: "read_file",
          role: "tool",
          tool_call_id: "call-1",
        },
      ],
      undefined,
      () => undefined,
      new AbortController().signal,
      request,
    );
    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body));
    expect(body.messages[0].tool_calls[0].function.arguments).toEqual({ path: "README.md" });
  });
});

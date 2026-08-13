// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveProvider } from "./providers.js";
import { isRetryableProviderError, streamChatMessage } from "./streaming.js";

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
      { arguments: '{"path":"PRODUCT.md"}', id: "tool-call-0", name: "read_file" },
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
});

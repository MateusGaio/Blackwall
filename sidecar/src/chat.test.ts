// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeChatMessage } from "./chat.js";
import { saveProvider } from "./providers.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("chamada não-streaming de compactação", () => {
  it.each(["BLACKWALL_E2E_MOCK", "BLACKWALL_E2E_AGENT"])(
    "não usa rede no modo %s",
    async (variable) => {
      const directory = await mkdtemp(join(tmpdir(), "blackwall-chat-e2e-"));
      directories.push(directory);
      const provider = await saveProvider(
        {
          apiKey: "e2e-key",
          baseUrl: "https://e2e.example/v1",
          model: "e2e-model",
          name: "E2E provider",
        },
        directory,
      );
      const request = vi.fn(() => {
        throw new Error("rede não permitida no modo E2E");
      }) as unknown as typeof fetch;
      vi.stubEnv(variable, "1");

      const result = await completeChatMessage(
        provider.id,
        [{ content: "histórico", role: "user" }],
        provider.model,
        { dataDirectory: directory, purpose: "compaction", request },
      );

      expect(result.content).toContain("Resumo determinístico");
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("reutiliza Chat Completions, Responses e Ollama sem transmitir o marcador interno", async () => {
    const chatDirectory = await mkdtemp(join(tmpdir(), "blackwall-chat-protocol-"));
    const responsesDirectory = await mkdtemp(join(tmpdir(), "blackwall-responses-protocol-"));
    const ollamaDirectory = await mkdtemp(join(tmpdir(), "blackwall-ollama-protocol-"));
    directories.push(chatDirectory, responsesDirectory, ollamaDirectory);
    const chatProvider = await saveProvider(
      {
        apiKey: "chat-key",
        baseUrl: "https://chat.example/v1",
        model: "chat-model",
        name: "Chat",
      },
      chatDirectory,
    );
    const responsesProvider = await saveProvider(
      {
        apiKey: "responses-key",
        baseUrl: "https://responses.example/v1",
        model: "responses-model",
        name: "Responses",
      },
      responsesDirectory,
    );
    const ollamaProvider = await saveProvider(
      {
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2",
        name: "Ollama",
        type: "ollama",
      },
      ollamaDirectory,
    );
    const messages = [{ content: "histórico", isSummary: true, role: "system" as const }];
    const chatRequest = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://chat.example/v1/chat/completions");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "chat-model", stream: false });
      expect(JSON.stringify(body)).not.toContain("isSummary");
      return new Response(JSON.stringify({ choices: [{ message: { content: "chat" } }] }), {
        headers: { "x-ratelimit-remaining-requests": "7" },
      });
    }) as unknown as typeof fetch;
    const responsesRequest = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("https://responses.example/v1/responses");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "responses-model", store: false, stream: false });
      expect(body.input).toEqual([{ content: "histórico", role: "system" }]);
      return new Response(JSON.stringify({ output_text: "responses" }));
    }) as unknown as typeof fetch;
    const ollamaRequest = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "llama3.2", stream: false });
      expect(JSON.stringify(body)).not.toContain("isSummary");
      return new Response(JSON.stringify({ message: { content: "ollama" } }));
    }) as unknown as typeof fetch;

    await expect(
      completeChatMessage(chatProvider.id, messages, undefined, {
        dataDirectory: chatDirectory,
        request: chatRequest,
      }),
    ).resolves.toMatchObject({ content: "chat" });
    await expect(
      completeChatMessage(responsesProvider.id, messages, undefined, {
        dataDirectory: responsesDirectory,
        protocol: "openai-responses",
        request: responsesRequest,
      }),
    ).resolves.toMatchObject({ content: "responses" });
    await expect(
      completeChatMessage(ollamaProvider.id, messages, undefined, {
        dataDirectory: ollamaDirectory,
        protocol: "ollama-chat",
        request: ollamaRequest,
      }),
    ).resolves.toMatchObject({ content: "ollama" });
    expect(chatRequest).toHaveBeenCalledOnce();
    expect(responsesRequest).toHaveBeenCalledOnce();
    expect(ollamaRequest).toHaveBeenCalledOnce();
  });
});

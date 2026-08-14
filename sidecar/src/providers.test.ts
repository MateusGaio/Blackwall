// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProvider,
  listProviderModels,
  normalizeBaseUrl,
  OpenAICompatibleProvider,
  type ProviderConnectionError,
  ProviderHttpError,
  providerApiKey,
  removeProvider,
  resolveProviderModelInput,
  routeCandidates,
  saveProvider,
  syncProviderModels,
  validateProvider,
} from "./providers.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("providers", () => {
  it("armazena a chave somente no envelope criptografado", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-"));
    directories.push(directory);
    const provider = await saveProvider(
      {
        apiKey: "secret-key-that-must-not-leak",
        baseUrl: "https://openrouter.ai/api/v1/",
        model: "openai/gpt-4o-mini",
        name: "OpenRouter",
      },
      directory,
    );

    expect(provider.baseUrl).toBe("https://openrouter.ai/api/v1");
    await expect(getProvider(provider.id, directory)).resolves.toEqual(provider);
    await expect(providerApiKey(provider.id, directory)).resolves.toBe(
      "secret-key-that-must-not-leak",
    );
    await expect(readFile(join(directory, "providers.json"), "utf8")).resolves.not.toContain(
      "secret-key",
    );
    await expect(readFile(join(directory, "secrets.enc"), "utf8")).resolves.not.toContain(
      "secret-key",
    );
  });

  it("recusa endpoints remotos sem HTTPS", () => {
    expect(() => normalizeBaseUrl("http://example.com/v1")).toThrow("HTTPS");
    expect(normalizeBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
  });

  it("mostra erro acionável para uma chave recusada", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 401 })) as unknown as typeof fetch;
    await expect(
      validateProvider(
        {
          apiKey: "invalid-key",
          baseUrl: "https://api.example.com/v1",
          model: "example-model",
          name: "Example",
        },
        request,
      ),
    ).rejects.toThrow("chave foi recusada");
  });

  it("valida e lista modelos de um Ollama local sem chave", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [{ name: "qwen2.5-coder:7b" }] }), { status: 200 }),
      ) as unknown as typeof fetch;
    await expect(
      validateProvider(
        {
          baseUrl: "http://127.0.0.1:11434",
          model: "qwen2.5-coder:7b",
          name: "Ollama",
          type: "ollama",
        },
        request,
      ),
    ).resolves.toBeUndefined();
    await expect(
      listProviderModels(
        { baseUrl: "http://127.0.0.1:11434", name: "Ollama", type: "ollama" },
        request,
      ),
    ).resolves.toEqual([{ capabilities: [], id: "qwen2.5-coder:7b", name: "qwen2.5-coder:7b" }]);
    expect(request).toHaveBeenCalledWith("http://127.0.0.1:11434/api/tags", expect.anything());
  });

  it("lê capabilities do /api/show do Ollama sem tornar o endpoint obrigatório", async () => {
    const request = vi.fn((url: string) => {
      if (url.endsWith("/api/tags"))
        return Promise.resolve(
          new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), { status: 200 }),
        );
      return Promise.resolve(
        new Response(JSON.stringify({ capabilities: ["completion", "tools"] }), { status: 200 }),
      );
    }) as unknown as typeof fetch;
    await expect(
      listProviderModels(
        { baseUrl: "http://127.0.0.1:11434", name: "Ollama", type: "ollama" },
        request,
      ),
    ).resolves.toEqual([
      {
        capabilities: ["completion", "tools"],
        id: "qwen3:8b",
        name: "qwen3:8b",
        toolSupport: "native",
        toolSupportSource: "metadata",
      },
    ]);
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/show",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("normaliza endpoints Ollama com sufixo de API e explica falhas de conexão", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ models: [] }), { status: 200 }),
      ) as unknown as typeof fetch;
    await expect(
      listProviderModels(
        {
          baseUrl: "http://localhost:11434/api/v1",
          name: "Ollama",
          type: "ollama",
        },
        request,
      ),
    ).resolves.toEqual([]);
    expect(request).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.anything());

    const unavailable = vi
      .fn()
      .mockRejectedValue(new TypeError("fetch failed")) as unknown as typeof fetch;
    await expect(
      listProviderModels(
        {
          baseUrl: "http://localhost:11434/api/v1",
          name: "Ollama",
          type: "ollama",
        },
        unavailable,
      ),
    ).rejects.toMatchObject({
      name: "ProviderConnectionError",
      retryable: true,
    } satisfies Partial<ProviderConnectionError>);
    await expect(
      listProviderModels(
        {
          baseUrl: "http://localhost:11434/api/v1",
          name: "Ollama",
          type: "ollama",
        },
        unavailable,
      ),
    ).rejects.toThrow("Verifique se o Ollama está em execução");
  });

  it("edita e remove um provedor sem colocar segredos no cadastro", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-edit-"));
    directories.push(directory);
    const provider = await saveProvider(
      {
        apiKey: "keep-me-encrypted",
        baseUrl: "https://api.example.com/v1",
        model: "first",
        name: "Example",
      },
      directory,
    );
    const updated = await saveProvider(
      {
        baseUrl: "https://api.example.com/v1",
        id: provider.id,
        model: "second",
        name: "Example updated",
      },
      directory,
    );
    expect(updated.id).toBe(provider.id);
    await expect(providerApiKey(provider.id, directory)).resolves.toBe("keep-me-encrypted");
    await expect(removeProvider(provider.id, directory)).resolves.toEqual({ id: provider.id });
    await expect(getProvider(provider.id, directory)).rejects.toThrow("não existe");
  });

  it("usa a URL editada e recupera a chave salva ao listar modelos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-discovery-"));
    directories.push(directory);
    const provider = await saveProvider(
      {
        apiKey: "stored-discovery-key",
        baseUrl: "https://old.example.com/v1",
        model: "old-model",
        name: "Existing provider",
      },
      directory,
    );

    const resolved = await resolveProviderModelInput(
      {
        baseUrl: "https://opencode.ai/zen/v1",
        id: provider.id,
        model: "discovery",
        name: "OpenCode Zen",
      },
      directory,
    );
    expect(resolved).toMatchObject({
      apiKey: "stored-discovery-key",
      baseUrl: "https://opencode.ai/zen/v1",
      id: provider.id,
      model: "discovery",
      name: "OpenCode Zen",
      type: "openai-compatible",
    });
    const request = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ id: "deepseek-v4-flash-free" }] }), { status: 200 }),
      ) as unknown as typeof fetch;
    await expect(listProviderModels(resolved, request)).resolves.toEqual([
      { capabilities: [], id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free" },
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://opencode.ai/zen/v1/models",
      expect.objectContaining({
        headers: { authorization: "Bearer stored-discovery-key" },
      }),
    );
  });

  it("usa adaptadores e mapeia erros de configuração sem torná-los elegíveis para fallback", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 404 })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      name: "Example",
    });
    await expect(adapter.validate(request)).rejects.toMatchObject({
      name: "ProviderHttpError",
      status: 404,
      retryable: false,
    });
    await expect(adapter.validate(request)).rejects.toThrow("endpoint não foi encontrado");
    expect(adapter.chatRequest("model", [{ role: "user", content: "Oi" }]).endpoint).toBe(
      "https://api.example.com/v1/chat/completions",
    );
    expect(new ProviderHttpError(429).retryable).toBe(true);
  });

  it("envia o contrato de ferramentas apenas quando o modelo permite", () => {
    const adapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      model: "model",
      name: "Example",
    });
    const tools = [
      {
        function: {
          description: "Read a file",
          name: "read_file" as const,
          parameters: { type: "object" },
          strict: true as const,
        },
        type: "function" as const,
      },
    ];
    const native = adapter.chatRequest("model", [], undefined, { toolMode: "auto", tools });
    expect(JSON.parse(String(native.body))).toMatchObject({ tool_choice: "auto", tools });
    expect(JSON.parse(String(native.body))).not.toHaveProperty("parallel_tool_calls");
    const disabled = adapter.chatRequest("model", [], undefined, {
      toolMode: "disabled",
      tools,
    });
    expect(JSON.parse(String(disabled.body))).not.toHaveProperty("tools");
    const compatibility = adapter.chatRequest("model", [], undefined, {
      toolMode: "compatibility",
      tools,
    });
    expect(JSON.parse(String(compatibility.body))).not.toHaveProperty("tools");
  });

  it("preserva metadados OpenRouter e envia require_parameters", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-4o", supported_parameters: ["tools", "tool_choice"] }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const models = await listProviderModels(
      {
        apiKey: "key",
        baseUrl: "https://openrouter.ai/api/v1",
        model: "openai/gpt-4o",
        name: "OpenRouter",
      },
      request,
    );
    expect(models[0]).toMatchObject({
      capabilities: ["tools", "tool_choice"],
      toolSupport: "native",
      toolSupportSource: "metadata",
    });
    const adapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o",
      name: "OpenRouter",
    });
    const body = JSON.parse(
      String(
        adapter.chatRequest("openai/gpt-4o", [], undefined, {
          toolMode: "auto",
          tools: [
            {
              function: {
                description: "read",
                name: "read_file",
                parameters: { additionalProperties: false, type: "object" },
                strict: true,
              },
              type: "function",
            },
          ],
        }).body,
      ),
    );
    expect(body).toMatchObject({
      parallel_tool_calls: false,
      provider: { require_parameters: true },
    });
  });

  it("serializa mensagens e ferramentas no protocolo Responses", () => {
    const adapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      name: "OpenAI",
    });
    const request = adapter.chatRequest(
      "gpt-4.1",
      [
        { content: "Oi", role: "user" },
        {
          content: "",
          role: "assistant",
          tool_calls: [
            {
              function: { arguments: '{"path":"README.md"}', name: "read_file" },
              id: "call_1",
              type: "function",
            },
          ],
        },
        { content: "ok", role: "tool", tool_call_id: "call_1" },
      ],
      undefined,
      { protocol: "openai-responses", toolMode: "auto", tools: [] },
    );
    expect(request.endpoint).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request.body))).toMatchObject({ store: false, stream: true });
  });

  it("sincroniza modelos no SQLite e preserva a ordem configurada da rota", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-models-"));
    directories.push(directory);
    const provider = await saveProvider(
      {
        apiKey: "sync-key",
        baseUrl: "https://api.example.com/v1",
        model: "first",
        name: "Example",
      },
      directory,
    );
    const request = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "first" }, { id: "second" }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch;
    await expect(
      syncProviderModels(
        provider.id,
        {
          apiKey: "sync-key",
          baseUrl: provider.baseUrl,
          model: provider.model,
          name: provider.name,
        },
        directory,
        request,
      ),
    ).resolves.toHaveLength(2);
    const route = routeCandidates({ model: "first", providerId: provider.id }, [
      { modelId: "fallback-b", position: 2, providerId: "b" },
      { modelId: "fallback-a", position: 1, providerId: "a" },
    ]);
    expect(route.map((candidate) => candidate.providerId)).toEqual([provider.id, "a", "b"]);
  });
});

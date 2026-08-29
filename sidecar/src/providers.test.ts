// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSharedDatabase } from "./db/database.js";
import {
  applyPromptCaching,
  getProvider,
  listProviderModels,
  listProviders,
  normalizeBaseUrl,
  OpenAICompatibleProvider,
  type ProviderConnectionError,
  ProviderHttpError,
  providerApiKey,
  reconcileProviderDuplicates,
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

  it("valida a conexão sem exigir modelo padrão", async () => {
    const request = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/api/tags"))
        return new Response(JSON.stringify({ models: [{ name: "llama3.2" }] }), {
          status: 200,
        }) as unknown as Response;
      return new Response(JSON.stringify({ data: [{ id: "gpt-mini" }] }), {
        status: 200,
      }) as unknown as Response;
    }) as unknown as typeof fetch;

    // OpenAI-compatible: credencial validada pela listagem /models.
    await expect(
      validateProvider(
        {
          apiKey: "key",
          baseUrl: "https://api.example.com/v1",
          model: "",
          name: "Example",
        },
        request,
      ),
    ).resolves.toBeUndefined();

    // Ollama: endpoint validado por /api/tags, modelo opcional.
    await expect(
      validateProvider(
        { baseUrl: "http://127.0.0.1:11434", model: "", name: "Ollama", type: "ollama" },
        request,
      ),
    ).resolves.toBeUndefined();
  });

  it("salva provedor com modelo padrão vazio sem quebrar leituras antigas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-nomodel-"));
    directories.push(directory);
    const saved = await saveProvider(
      { baseUrl: "http://127.0.0.1:11434", model: "", name: "Ollama local", type: "ollama" },
      directory,
    );
    expect(saved.model).toBe("");
    await expect(getProvider(saved.id, directory)).resolves.toMatchObject({
      model: "",
      name: "Ollama local",
    });
  });

  it("duas submissões Ollama idênticas resultam em um provedor com N modelos", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-dedupe-"));
    directories.push(directory);
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "qwen2.5:7b" }, { name: "llama3.2" }, { name: "qwen2.5:7b" }],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const input = {
      baseUrl: "http://127.0.0.1:11434/",
      model: "qwen2.5:7b",
      name: "Ollama local",
      type: "ollama" as const,
    };

    const first = await saveProvider(input, directory);
    const second = await saveProvider({ ...input, model: "llama3.2" }, directory);
    expect(second.id).toBe(first.id);
    const all = await listProviders(directory);
    expect(all).toHaveLength(1);
    // Modelos pertencem ao catálogo do provedor, não criam provedores novos.
    const synced = await syncProviderModels(first.id, input, directory, request);
    const ids = new Set(synced.map((model) => model.id));
    expect(ids.size).toBe(2); // qwen duplicado na resposta vira uma entrada
  });

  it("dois OpenAI-compatible com credenciais distintas não são mesclados", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-distinct-"));
    directories.push(directory);
    process.env.BLACKWALL_DATA_DIR = directory;
    const base = {
      baseUrl: "https://api.example.com/v1",
      model: "m1",
      name: "Example",
      type: "openai-compatible" as const,
    };
    const first = await saveProvider({ ...base, apiKey: "key-one" }, directory);
    const second = await saveProvider({ ...base, apiKey: "key-two", model: "m2" }, directory);
    expect(second.id).not.toBe(first.id);
    expect(await listProviders(directory)).toHaveLength(2);

    // Mesma chave (identidade comprovada) + mesmo nome/endpoint: idempotente.
    const third = await saveProvider({ ...base, apiKey: "key-one", model: "m3" }, directory);
    expect(third.id).toBe(first.id);
    expect(await listProviders(directory)).toHaveLength(2);
    delete process.env.BLACKWALL_DATA_DIR;
  });

  it("reconcilia duplicatas Ollama legadas preservando referências e é idempotente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-reconcile-"));
    directories.push(directory);
    const keeper = await saveProvider(
      { baseUrl: "http://127.0.0.1:11434", model: "m1", name: "Ollama", type: "ollama" },
      directory,
    );
    const duplicateId = "legacy-dup";

    // Simula o estado legado: segunda conexão idêntica com referências.
    const document = JSON.parse(await readFile(join(directory, "providers.json"), "utf8")) as {
      providers: Array<Record<string, unknown>>;
    };
    document.providers.push({
      baseUrl: "http://127.0.0.1:11434",
      id: duplicateId,
      model: "m2",
      name: "Ollama extra",
      type: "ollama",
    });
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(directory, "providers.json"), JSON.stringify(document));

    const database = openSharedDatabase(directory);
    database.client
      .prepare(
        "INSERT INTO providers (id, type, name, base_url, status, created_at, updated_at) VALUES (?, 'ollama', 'Ollama extra', ?, 'connected', 1, 1)",
      )
      .run(duplicateId, keeper.baseUrl);
    // Modelo que conflita com o keeper + modelo exclusivo da duplicata.
    database.client
      .prepare(
        "INSERT INTO models (id, provider_id, model_id, display_name, capabilities, available, protocol_preference, resolved_protocol, tool_support, tool_mode, parallel_tool_calls, updated_at) VALUES (?, ?, 'm1', 'm1', '[]', 1, 'auto', NULL, 'unknown', 'auto', 'auto', 1)",
      )
      .run(`${keeper.id}:m1`, keeper.id);
    database.client
      .prepare(
        "INSERT INTO models (id, provider_id, model_id, display_name, capabilities, available, protocol_preference, resolved_protocol, tool_support, tool_mode, parallel_tool_calls, updated_at) VALUES ('dup:m2', ?, 'm2', 'm2', '[]', 1, 'auto', NULL, 'unknown', 'auto', 'auto', 1)",
      )
      .run(duplicateId);
    // Sessão e uso apontando para a duplicata.
    database.client
      .prepare(
        "INSERT INTO sessions (id, title, selected_provider_id, selected_model, created_at, updated_at) VALUES ('sess-1', 'S', ?, 'm2', 1, 1)",
      )
      .run(duplicateId);
    database.client
      .prepare(
        "INSERT INTO provider_usage_daily (profile_id, provider_id, model_id, date_key, requests, input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, total_tokens, updated_at) VALUES ('', ?, 'm2', '2026-08-24', 3, 30, 3, 0, 0, 33, 1)",
      )
      .run(duplicateId);
    database.close();

    const merges = await reconcileProviderDuplicates(directory);
    expect(merges).toEqual([{ duplicateId, keeperId: keeper.id }]);
    expect(await listProviders(directory)).toHaveLength(1);

    const after = openSharedDatabase(directory);
    const session = after.client
      .prepare("SELECT selected_provider_id AS pid FROM sessions WHERE id = 'sess-1'")
      .get() as { pid: string };
    expect(session.pid).toBe(keeper.id);
    const models = after.client
      .prepare("SELECT id, provider_id AS pid, model_id AS mid FROM models ORDER BY mid")
      .all() as Array<{ id: string; mid: string; pid: string }>;
    expect(models).toEqual([
      { id: `${keeper.id}:m1`, mid: "m1", pid: keeper.id }, // conflito: keeper vence
      { id: `${keeper.id}:m2`, mid: "m2", pid: keeper.id }, // exclusivo: migrado
    ]);
    const daily = after.client
      .prepare("SELECT requests FROM provider_usage_daily WHERE provider_id = ?")
      .all(keeper.id) as Array<{ requests: number }>;
    expect(daily).toEqual([{ requests: 3 }]);
    after.close();

    // Segunda execução não encontra nada (idempotente).
    await expect(reconcileProviderDuplicates(directory)).resolves.toEqual([]);
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
        new Response(
          JSON.stringify({
            capabilities: ["completion", "tools"],
            model_info: { "qwen2.context_length": 32_768 },
          }),
          { status: 200 },
        ),
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
        contextLimit: 32_768,
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
    expect(JSON.parse(String(native.body))).toMatchObject({
      stream_options: { include_usage: true },
      tool_choice: "auto",
      tools,
    });
    const disabled = adapter.chatRequest("model", [], undefined, {
      toolMode: "disabled",
      tools,
    });
    expect(JSON.parse(String(disabled.body))).toMatchObject({
      stream_options: { include_usage: true },
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
          data: [
            {
              context_length: 128_000,
              id: "openai/gpt-4o",
              supported_parameters: ["tools", "tool_choice"],
            },
          ],
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
      contextLimit: 128_000,
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
      parallel_tool_calls: true,
      provider: { require_parameters: true },
    });
  });

  it("mantém parallel_tool_calls desligado por padrão fora da OpenRouter", () => {
    const adapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      model: "some-model",
      name: "Generic",
    });
    const body = JSON.parse(
      String(
        adapter.chatRequest("some-model", [], undefined, {
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
    expect(body).toMatchObject({ parallel_tool_calls: false });
  });

  it("respeita override manual de parallel_tool_calls em qualquer provedor", () => {
    const openRouterAdapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "openai/gpt-4o",
      name: "OpenRouter",
    });
    const genericAdapter = new OpenAICompatibleProvider({
      apiKey: "key",
      baseUrl: "https://api.example.com/v1",
      model: "some-model",
      name: "Generic",
    });
    const tools = [
      {
        function: {
          description: "read",
          name: "read_file",
          parameters: { additionalProperties: false, type: "object" },
          strict: true,
        },
        type: "function" as const,
      },
    ];
    const forcedOff = JSON.parse(
      String(
        openRouterAdapter.chatRequest("openai/gpt-4o", [], undefined, {
          parallelToolCalls: "disabled",
          toolMode: "auto",
          tools,
        }).body,
      ),
    );
    expect(forcedOff).toMatchObject({ parallel_tool_calls: false });
    const forcedOn = JSON.parse(
      String(
        genericAdapter.chatRequest("some-model", [], undefined, {
          parallelToolCalls: "enabled",
          toolMode: "auto",
          tools,
        }).body,
      ),
    );
    expect(forcedOn).toMatchObject({ parallel_tool_calls: true });
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
      {
        parallelToolCalls: "disabled",
        protocol: "openai-responses",
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
      },
    );
    expect(request.endpoint).toBe("https://api.openai.com/v1/responses");
    expect(JSON.parse(String(request.body))).toMatchObject({
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
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

  it("marca cache_control no prefixo e na cauda apenas em modelos Anthropic", () => {
    const messages = [
      { content: "soul", role: "system" },
      { content: "instruções de ferramenta", role: "system" },
      { content: "system extra que não deve ser marcado", role: "system" },
      { content: "primeiro pedido", role: "user" },
      { content: "", role: "assistant", tool_calls: [{ id: "call-1" }] },
      { content: [{ text: "resultado", type: "text" }], role: "tool" },
    ];

    const cached = applyPromptCaching(messages, "claude-opus-5") as Array<{
      content: unknown;
      role: string;
    }>;

    const hasMarker = (content: unknown) =>
      Array.isArray(content) &&
      content.some((part) => (part as { cache_control?: unknown }).cache_control !== undefined);
    expect(cached.map((message) => hasMarker(message.content))).toEqual([
      true, // primeiro system
      true, // segundo system
      false, // terceiro system fica de fora do limite de 4 breakpoints
      false,
      false, // assistente com content vazio não vira content part
      true, // última mensagem não-system
    ]);
    // No máximo 4 marcações, e nenhuma delas muda o texto original.
    expect(cached.filter((message) => hasMarker(message.content)).length).toBeLessThanOrEqual(4);
    expect((cached[0]?.content as Array<{ text: string }> | undefined)?.[0]?.text).toBe("soul");
  });

  it("não toca no payload quando o modelo não suporta cache explícito", () => {
    const messages = [
      { content: "soul", role: "system" },
      { content: "oi", role: "user" },
    ];
    expect(applyPromptCaching(messages, "nemotron-3.5-lightning-free")).toBe(messages);
  });

  it("completa o limite de contexto pelo catálogo quando o provedor não informa", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-provider-catalog-"));
    directories.push(directory);
    const baseUrl = "https://opencode.ai/zen/v1";
    const provider = await saveProvider(
      { apiKey: "sync-key", baseUrl, model: "reportado", name: "OpencodeZen" },
      directory,
    );
    // A resposta /models da Zen traz só ids; o catálogo carrega os limites.
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ context_length: 8_000, id: "reportado" }, { id: "sem-limite-proprio" }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            opencode: {
              api: baseUrl,
              models: {
                reportado: { limit: { context: 999 } },
                "sem-limite-proprio": { limit: { context: 262_144 } },
              },
            },
          }),
          { status: 200 },
        ),
      ) as unknown as typeof fetch;

    const synced = await syncProviderModels(
      provider.id,
      { apiKey: "sync-key", baseUrl, model: provider.model, name: provider.name },
      directory,
      request,
    );

    expect(synced.find((model) => model.id === "sem-limite-proprio")?.contextLimit).toBe(262_144);
    // O valor informado pelo provedor tem precedência sobre o catálogo.
    expect(synced.find((model) => model.id === "reportado")?.contextLimit).toBe(8_000);
  });
});

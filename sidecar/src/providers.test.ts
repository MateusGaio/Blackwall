// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  OpenAICompatibleProvider,
  ProviderHttpError,
  getProvider,
  listProviderModels,
  normalizeBaseUrl,
  providerApiKey,
  removeProvider,
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

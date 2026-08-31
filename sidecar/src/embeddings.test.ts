// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it, vi } from "vitest";
import {
  createEmbeddingAdapter,
  EmbeddingAdapterError,
  validateEmbeddingConfigInput,
} from "./embeddings.js";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("adaptadores de embeddings", () => {
  it("envia lote Ollama com modelo explícito, dimensão e autenticação opcional", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        embeddings: [
          [1, 2],
          [3, 4],
        ],
      }),
    );
    const adapter = createEmbeddingAdapter(
      {
        dimension: 2,
        model: "embeddinggemma",
        provider: "ollama",
        url: "http://ollama.local:11434",
      },
      { apiKey: "ollama-key", request },
    );

    await expect(adapter.embed(["um", "dois"])).resolves.toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(request).toHaveBeenCalledWith(
      "http://ollama.local:11434/api/embed",
      expect.objectContaining({
        headers: {
          authorization: "Bearer ollama-key",
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      dimensions: 2,
      input: ["um", "dois"],
      model: "embeddinggemma",
    });
  });

  it("ordena a resposta OpenAI-compatible pelo índice do lote", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        data: [
          { embedding: [2, 2], index: 1 },
          { embedding: [1, 1], index: 0 },
        ],
      }),
    );
    const adapter = createEmbeddingAdapter(
      {
        dimension: 2,
        model: "text-embedding-test",
        provider: "openai-compatible",
        url: "https://api.example/v1/",
      },
      { apiKey: "remote-key", request },
    );

    await expect(adapter.embed(["primeiro", "segundo"])).resolves.toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(request).toHaveBeenCalledWith(
      "https://api.example/v1/embeddings",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer remote-key" }),
      }),
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toMatchObject({
      input: ["primeiro", "segundo"],
      model: "text-embedding-test",
    });
  });

  it("rejeita vetor inválido e erro HTTP sem vazar o corpo do provedor", async () => {
    const invalidRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ embeddings: [[Number.NaN]] }));
    const invalid = createEmbeddingAdapter(
      { model: "m", provider: "ollama", url: "http://localhost:11434" },
      { request: invalidRequest },
    );
    await expect(invalid.embed(["texto"])).rejects.toMatchObject({
      code: "embedding_vector_invalid",
    });

    const failedRequest = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response({ secretProviderMessage: "não deve aparecer" }, 401));
    const failed = createEmbeddingAdapter(
      { model: "m", provider: "openai-compatible", url: "https://api.example" },
      { request: failedRequest },
    );
    const error = await failed.embed(["texto"]).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(EmbeddingAdapterError);
    expect(error).toMatchObject({ code: "embedding_provider_http_401", status: 401 });
    expect(String((error as Error).message)).not.toContain("não deve aparecer");
  });

  it("exige modelo mesmo para Ollama e não chama fetch para lote vazio", async () => {
    expect(() =>
      validateEmbeddingConfigInput({ provider: "ollama", url: "http://localhost:11434" }),
    ).toThrowError(/modelo/i);
    const request = vi.fn<typeof fetch>();
    const adapter = createEmbeddingAdapter(
      { model: "m", provider: "ollama", url: "http://localhost:11434" },
      { request },
    );
    await expect(adapter.embed([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});

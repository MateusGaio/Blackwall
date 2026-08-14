// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { isStreamEventForRequest, retrySidecarRequest } from "./sidecar";

describe("eventos do stream", () => {
  it("aceita autorizações filhas da requisição original", () => {
    expect(isStreamEventForRequest("request-1:tool-1", "request-1")).toBe(true);
    expect(isStreamEventForRequest("request-2", "request-1")).toBe(false);
    expect(isStreamEventForRequest(undefined, "request-1")).toBe(true);
  });
});

describe("inicialização do sidecar", () => {
  it("repete uma leitura transitória até o serviço ficar disponível", async () => {
    let attempts = 0;
    const result = await retrySidecarRequest(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("sidecar iniciando");
        return "pronto";
      },
      3,
      0,
    );

    expect(result).toBe("pronto");
    expect(attempts).toBe(3);
  });

  it("propaga a última falha depois do limite", async () => {
    await expect(
      retrySidecarRequest(async () => Promise.reject(new Error("indisponível")), 2, 0),
    ).rejects.toThrow("indisponível");
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexCatalog, loadModelCatalog, lookupModelLimits } from "./model-catalog.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-catalog-"));
  directories.push(directory);
  return directory;
}

const catalogBody = {
  opencode: {
    api: "https://opencode.ai/zen/v1",
    models: {
      "nemotron-3.5-lightning-free": { limit: { context: 262_144, output: 262_144 } },
      "sem-limite": { limit: {} },
    },
  },
  semApi: { models: { qualquer: { limit: { context: 1_000 } } } },
};

function jsonResponse(body: unknown, init: { etag?: string; status?: number } = {}) {
  return new Response(JSON.stringify(body), {
    headers: init.etag ? { etag: init.etag } : {},
    status: init.status ?? 200,
  });
}

describe("catálogo de modelos", () => {
  it("indexa por endpoint e ignora entradas sem limite ou sem api", () => {
    const index = indexCatalog(catalogBody);
    expect(Object.keys(index)).toEqual(["opencode.ai/zen/v1"]);
    expect(
      lookupModelLimits(index, "https://opencode.ai/zen/v1", "nemotron-3.5-lightning-free"),
    ).toEqual({ contextLimit: 262_144, outputLimit: 262_144 });
    expect(lookupModelLimits(index, "https://opencode.ai/zen/v1", "sem-limite")).toBeUndefined();
  });

  it("casa o endpoint ignorando esquema, caixa e barra final", () => {
    const index = indexCatalog(catalogBody);
    const limits = lookupModelLimits(
      index,
      "HTTPS://OpenCode.ai/Zen/v1/",
      "nemotron-3.5-lightning-free",
    );
    expect(limits?.contextLimit).toBe(262_144);
  });

  it("busca uma vez e reutiliza o cache dentro do TTL", async () => {
    const directory = await temporaryDirectory();
    const request = vi.fn(async () => jsonResponse(catalogBody, { etag: "v1" }));

    const first = await loadModelCatalog(directory, request as unknown as typeof fetch);
    const second = await loadModelCatalog(directory, request as unknown as typeof fetch);

    expect(request).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    const cached = JSON.parse(await readFile(join(directory, "model-catalog.json"), "utf8"));
    expect(cached.etag).toBe("v1");
  });

  it("revalida com ETag depois do TTL e mantém o índice no 304", async () => {
    const directory = await temporaryDirectory();
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(catalogBody, { etag: "v1" }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const start = Date.now();

    await loadModelCatalog(directory, request as unknown as typeof fetch, start);
    const revalidated = await loadModelCatalog(
      directory,
      request as unknown as typeof fetch,
      start + 25 * 60 * 60 * 1000,
    );

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[1]?.headers).toEqual({ "if-none-match": "v1" });
    expect(
      lookupModelLimits(revalidated, "https://opencode.ai/zen/v1", "nemotron-3.5-lightning-free")
        ?.contextLimit,
    ).toBe(262_144);
  });

  it("degrada em silêncio quando a rede falha e não há cache", async () => {
    const directory = await temporaryDirectory();
    const request = vi.fn(async () => {
      throw new Error("offline");
    });

    await expect(loadModelCatalog(directory, request as unknown as typeof fetch)).resolves.toEqual(
      {},
    );
  });

  it("mantém o cache anterior quando a rede falha depois do TTL", async () => {
    const directory = await temporaryDirectory();
    const request = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(catalogBody))
      .mockRejectedValueOnce(new Error("offline"));
    const start = Date.now();

    await loadModelCatalog(directory, request as unknown as typeof fetch, start);
    const afterFailure = await loadModelCatalog(
      directory,
      request as unknown as typeof fetch,
      start + 25 * 60 * 60 * 1000,
    );

    expect(
      lookupModelLimits(afterFailure, "https://opencode.ai/zen/v1", "nemotron-3.5-lightning-free")
        ?.contextLimit,
    ).toBe(262_144);
  });
});

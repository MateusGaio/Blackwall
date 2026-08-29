// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { withRetry } from "./retry.js";

describe("retry abortável", () => {
  it("tenta novamente até sucesso com backoff determinístico", async () => {
    let calls = 0;
    const retries: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          if (calls < 3) throw new Error("transitório");
          return "ok";
        },
        {
          baseDelayMs: 0,
          isRetryable: () => true,
          jitter: () => 0,
          onRetry: ({ attempt }) => retries.push(attempt),
        },
      ),
    ).resolves.toBe("ok");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("interrompe o backoff quando recebe Stop", async () => {
    const controller = new AbortController();
    let calls = 0;
    const promise = withRetry(
      async () => {
        calls += 1;
        throw new Error("transitório");
      },
      { attempts: 5, baseDelayMs: 10_000, isRetryable: () => true, signal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(1);
  });
});

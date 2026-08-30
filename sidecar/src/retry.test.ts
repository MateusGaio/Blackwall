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

  it("aplica jitter simétrico e limita o atraso sem retry-after", async () => {
    let calls = 0;
    const delays: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("transitório");
        },
        {
          baseDelayMs: 2_000,
          isRetryable: () => true,
          jitter: () => (calls === 1 ? -0.25 : calls === 2 ? 0.25 : 0),
          sleep: async (delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    ).rejects.toThrow("transitório");
    expect(calls).toBe(5);
    expect(delays).toEqual([1_500, 5_000, 8_000, 16_000]);
  });

  it("respeita retry-after como piso sem aplicar o teto de 30 segundos", async () => {
    let calls = 0;
    const delays: number[] = [];
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("rate limit");
        },
        {
          baseDelayMs: 2_000,
          isRetryable: () => true,
          jitter: () => -0.25,
          retryAfterMs: () => 45_000,
          sleep: async (delayMs) => {
            delays.push(delayMs);
          },
        },
      ),
    ).rejects.toThrow("rate limit");
    expect(calls).toBe(5);
    expect(delays).toEqual([45_000, 45_000, 45_000, 45_000]);
  });
});

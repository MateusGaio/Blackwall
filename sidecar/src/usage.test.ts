// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { mostRestrictiveWindow, normalizeTokenUsage, parseRateLimitHeaders } from "./usage";

describe("provider usage normalization", () => {
  it("normalizes OpenAI token fields without inventing missing values", () => {
    expect(
      normalizeTokenUsage({
        usage: {
          completion_tokens: 12,
          prompt_tokens: 30,
          prompt_tokens_details: { cached_tokens: 4 },
          total_tokens: 42,
        },
      }),
    ).toEqual({
      cachedInputTokens: 4,
      inputTokens: 30,
      outputTokens: 12,
      reasoningTokens: undefined,
      totalTokens: 42,
    });
  });

  it("normalizes Ollama eval counters and ignores invalid values", () => {
    expect(normalizeTokenUsage({ prompt_eval_count: 20, eval_count: 8 })).toEqual({
      inputTokens: 20,
      outputTokens: 8,
      totalTokens: 28,
    });
    expect(normalizeTokenUsage({ prompt_eval_count: -1 })).toBeUndefined();
  });
});

describe("provider rate limits", () => {
  it("parses limits, remaining values and Retry-After seconds", () => {
    const headers = new Headers({
      "retry-after": "30",
      "x-ratelimit-limit-requests": "100",
      "x-ratelimit-remaining-requests": "25",
    });
    const windows = parseRateLimitHeaders(headers);
    expect(windows.find((window) => window.label === "requests")?.remainingPercent).toBe(25);
    expect(windows.find((window) => window.label === "retry-after")?.resetAt).toBeGreaterThan(
      Date.now(),
    );
  });

  it("selects the smallest known remaining percentage", () => {
    expect(
      mostRestrictiveWindow([
        { label: "daily", metric: "requests", remainingPercent: 55, source: "provider" },
        { label: "minute", metric: "requests", remainingPercent: 12, source: "provider" },
      ])?.label,
    ).toBe("minute");
    expect(
      mostRestrictiveWindow([{ label: "unknown", metric: "tokens", source: "provider" }]),
    ).toBeNull();
  });
});

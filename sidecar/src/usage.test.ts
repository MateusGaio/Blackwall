// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import {
  getUsageSummary,
  mostRestrictiveWindow,
  normalizeTokenUsage,
  parseRateLimitHeaders,
  recordProviderUsage,
  setUsageLimits,
} from "./usage";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

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

describe("usage persistence", () => {
  it("returns manual limits without using SQLite reserved aliases", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-usage-"));
    const workspace = join(directory, "workspace");
    directories.push(directory);
    await mkdir(workspace);
    const database = openDatabase(directory);

    recordProviderUsage(database.client, {
      attemptId: "attempt-1",
      modelId: "model",
      providerId: "provider",
      requestId: "request-1",
    });
    setUsageLimits(database.client, "provider", [
      {
        label: "Daily request estimate",
        limit: 10,
        metric: "requests",
        windowSeconds: 24 * 60 * 60,
      },
    ]);

    const summary = getUsageSummary(database.client, { providerId: "provider" });
    expect(summary.totals.requests).toBe(1);
    expect(summary.windows).toContainEqual(
      expect.objectContaining({
        label: "Daily request estimate",
        limit: 10,
        remaining: 9,
        remainingPercent: 90,
        source: "manual",
      }),
    );
    database.close();
  });
});

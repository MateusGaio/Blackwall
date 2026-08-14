// MIT License — Copyright (c) 2026 Mateus Gaio
import type Database from "better-sqlite3";

export type UsageSource = "provider" | "local" | "manual";
export type UsageMetric = "requests" | "tokens" | "credits";

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};

export type UsageWindow = {
  metric: UsageMetric;
  label: string;
  limit?: number;
  used?: number;
  remaining?: number;
  remainingPercent?: number;
  resetAt?: number;
  source: UsageSource;
};

type ProviderUsageEvent = {
  requestId: string;
  attemptId: string;
  sessionId?: string;
  profileId?: string;
  providerId: string;
  modelId: string;
  tokens?: TokenUsage;
  windows?: UsageWindow[];
  status?: "completed" | "failed";
  errorCode?: string;
  observedAt?: number;
};

type UsageSummary = {
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  windows: UsageWindow[];
  daily: Array<{
    date: string;
    providerId: string;
    modelId: string;
    requests: number;
    totalTokens: number;
  }>;
};

function finiteNumber(value: unknown): number | undefined {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed =
      finiteNumber(value) ??
      (typeof value === "string" && value.trim() !== "" ? finiteNumber(Number(value)) : undefined);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function normalizeTokenUsage(value: unknown): TokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const body = value as Record<string, unknown>;
  const usage =
    body.usage && typeof body.usage === "object" ? (body.usage as Record<string, unknown>) : body;
  const inputTokens = firstNumber(usage.input_tokens, usage.prompt_tokens, usage.prompt_eval_count);
  const outputTokens = firstNumber(usage.output_tokens, usage.completion_tokens, usage.eval_count);
  const cachedInputTokens = firstNumber(
    usage.cached_input_tokens,
    (usage.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
    (usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens,
  );
  const reasoningTokens = firstNumber(
    usage.reasoning_tokens,
    (usage.completion_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens,
    (usage.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens,
  );
  const totalTokens = firstNumber(
    usage.total_tokens,
    inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined,
  );
  if (
    [inputTokens, outputTokens, cachedInputTokens, reasoningTokens, totalTokens].every(
      (item) => item === undefined,
    )
  )
    return undefined;
  return { cachedInputTokens, inputTokens, outputTokens, reasoningTokens, totalTokens };
}

function resetTimestamp(value: string | null): number | undefined {
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function windowFromHeaders(
  headers: Headers,
  metric: UsageMetric,
  suffix: string,
): UsageWindow | null {
  const limit = firstNumber(headers.get(`x-ratelimit-limit-${suffix}`));
  const remaining = firstNumber(headers.get(`x-ratelimit-remaining-${suffix}`));
  const resetAt = resetTimestamp(headers.get(`x-ratelimit-reset-${suffix}`));
  if (limit === undefined && remaining === undefined && resetAt === undefined) return null;
  return {
    label: suffix,
    limit,
    metric,
    remaining,
    remainingPercent:
      limit !== undefined && remaining !== undefined
        ? Math.max(0, Math.min(100, (remaining / limit) * 100))
        : undefined,
    resetAt,
    source: "provider",
  };
}

export function parseRateLimitHeaders(headers: Headers): UsageWindow[] {
  const windows = [
    windowFromHeaders(headers, "requests", "requests"),
    windowFromHeaders(headers, "requests", "requests-minute"),
    windowFromHeaders(headers, "tokens", "tokens"),
    windowFromHeaders(headers, "tokens", "tokens-minute"),
  ].filter((window): window is UsageWindow => Boolean(window));
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const resetAt = Number.isFinite(seconds)
      ? Date.now() + Math.max(0, seconds) * 1000
      : resetTimestamp(retryAfter);
    if (resetAt)
      windows.push({ label: "retry-after", metric: "requests", resetAt, source: "provider" });
  }
  return windows;
}

export function mostRestrictiveWindow(windows: UsageWindow[]): UsageWindow | null {
  return (
    windows
      .filter((window) => window.remainingPercent !== undefined)
      .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0] ??
    null
  );
}

export function recordProviderUsage(client: Database.Database, event: ProviderUsageEvent) {
  const observedAt = event.observedAt ?? Date.now();
  const tokens = event.tokens ?? {};
  const windows = JSON.stringify(event.windows ?? []);
  const transaction = client.transaction(() => {
    const inserted = client
      .prepare(
        `INSERT OR IGNORE INTO provider_usage_events
          (request_id, attempt_id, session_id, profile_id, provider_id, model_id, status, error_code,
           input_tokens, output_tokens, cached_input_tokens, reasoning_tokens, total_tokens, windows_json, observed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.requestId,
        event.attemptId,
        event.sessionId ?? null,
        event.profileId ?? "",
        event.providerId,
        event.modelId,
        event.status ?? "completed",
        event.errorCode ?? null,
        tokens.inputTokens ?? null,
        tokens.outputTokens ?? null,
        tokens.cachedInputTokens ?? null,
        tokens.reasoningTokens ?? null,
        tokens.totalTokens ?? null,
        windows,
        observedAt,
      );
    if (inserted.changes !== 1) return;
    const date = new Date(observedAt).toISOString().slice(0, 10);
    client
      .prepare(
        `INSERT INTO provider_usage_daily
          (profile_id, provider_id, model_id, date_key, requests, input_tokens, output_tokens,
           cached_input_tokens, reasoning_tokens, total_tokens, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id, provider_id, model_id, date_key) DO UPDATE SET
           requests = requests + 1,
           input_tokens = input_tokens + excluded.input_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
           reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
           total_tokens = total_tokens + excluded.total_tokens,
           updated_at = excluded.updated_at`,
      )
      .run(
        event.profileId ?? "",
        event.providerId,
        event.modelId,
        date,
        tokens.inputTokens ?? 0,
        tokens.outputTokens ?? 0,
        tokens.cachedInputTokens ?? 0,
        tokens.reasoningTokens ?? 0,
        tokens.totalTokens ?? 0,
        observedAt,
      );
  });
  transaction();
}

export function pruneUsage(client: Database.Database, now = Date.now()) {
  client
    .prepare("DELETE FROM provider_usage_events WHERE observed_at < ?")
    .run(now - 90 * 24 * 60 * 60 * 1000);
}

export function getUsageSummary(
  client: Database.Database,
  filters: {
    profileId?: string | null;
    providerId?: string | null;
    modelId?: string | null;
    sessionId?: string | null;
    from?: number;
    to?: number;
  } = {},
): UsageSummary {
  const from = filters.from ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
  const to = filters.to ?? Date.now();
  const profileClause = filters.profileId ? " AND profile_id = @profileId" : "";
  const providerClause = filters.providerId ? " AND provider_id = @providerId" : "";
  const modelClause = filters.modelId ? " AND model_id = @modelId" : "";
  const sessionClause = filters.sessionId ? " AND session_id = @sessionId" : "";
  const params = {
    from,
    to,
    profileId: filters.profileId,
    providerId: filters.providerId,
    modelId: filters.modelId,
    sessionId: filters.sessionId,
  };
  const totals = client
    .prepare(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens, COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
        COALESCE(SUM(reasoning_tokens), 0) AS reasoningTokens, COALESCE(SUM(total_tokens), 0) AS totalTokens
       FROM provider_usage_events WHERE observed_at BETWEEN @from AND @to${profileClause}${providerClause}${modelClause}${sessionClause}`,
    )
    .get(params) as UsageSummary["totals"];
  const rows = client
    .prepare(
      `SELECT date_key AS date, provider_id AS providerId, model_id AS modelId, requests, total_tokens AS totalTokens
       FROM provider_usage_daily WHERE date_key >= date(@from / 1000, 'unixepoch') AND date_key <= date(@to / 1000, 'unixepoch')
       ${profileClause.replaceAll("profile_id", "provider_usage_daily.profile_id")}
       ${providerClause.replaceAll("provider_id", "provider_usage_daily.provider_id")}
       ${modelClause.replaceAll("model_id", "provider_usage_daily.model_id")}
       ORDER BY date DESC, provider_id, model_id`,
    )
    .all(params) as UsageSummary["daily"];
  const latest = client
    .prepare(
      `SELECT windows_json AS windowsJson FROM provider_usage_events
       WHERE observed_at BETWEEN @from AND @to${profileClause}${providerClause}${modelClause}${sessionClause}
       ORDER BY observed_at DESC LIMIT 1`,
    )
    .get(params) as { windowsJson?: string } | undefined;
  let windows: UsageWindow[] = [];
  try {
    const parsed = latest?.windowsJson ? JSON.parse(latest.windowsJson) : [];
    windows = Array.isArray(parsed) ? parsed : [];
  } catch {
    windows = [];
  }
  if (filters.providerId) {
    const manualLimits = client
      .prepare(
        `SELECT metric, label, limit_value AS limitValue, window_seconds AS windowSeconds
         FROM provider_usage_limits WHERE provider_id = ? ORDER BY metric, label`,
      )
      .all(filters.providerId) as Array<{
      metric: UsageMetric;
      label: string;
      limitValue: number;
      windowSeconds: number;
    }>;
    for (const limit of manualLimits) {
      const used =
        limit.metric === "requests"
          ? totals.requests
          : limit.metric === "tokens"
            ? totals.totalTokens
            : 0;
      const remaining = Math.max(0, limit.limitValue - used);
      windows.push({
        label: limit.label,
        limit: limit.limitValue,
        metric: limit.metric,
        remaining,
        remainingPercent: Math.max(0, Math.min(100, (remaining / limit.limitValue) * 100)),
        source: "manual",
      });
    }
  }
  return { daily: rows, totals, windows };
}

export function setUsageLimits(
  client: Database.Database,
  providerId: string,
  limits: Array<{ metric: UsageMetric; label: string; limit: number; windowSeconds: number }>,
) {
  const now = Date.now();
  const transaction = client.transaction(() => {
    client.prepare("DELETE FROM provider_usage_limits WHERE provider_id = ?").run(providerId);
    const insert = client.prepare(
      `INSERT INTO provider_usage_limits (id, provider_id, metric, label, limit_value, window_seconds, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const limit of limits) {
      if (
        !Number.isFinite(limit.limit) ||
        limit.limit <= 0 ||
        !Number.isFinite(limit.windowSeconds) ||
        limit.windowSeconds <= 0
      )
        throw new Error("Limite manual inválido.");
      insert.run(
        `${providerId}:${limit.metric}:${limit.label}`,
        providerId,
        limit.metric,
        limit.label,
        limit.limit,
        limit.windowSeconds,
        now,
        now,
      );
    }
  });
  transaction();
}

export function clearUsageHistory(client: Database.Database) {
  const transaction = client.transaction(() => {
    client.prepare("DELETE FROM provider_usage_events").run();
    client.prepare("DELETE FROM provider_usage_daily").run();
  });
  transaction();
}

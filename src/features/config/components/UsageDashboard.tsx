// MIT License — Copyright (c) 2026 Mateus Gaio
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type ConnectedProvider,
  clearUsageHistory,
  getUsageSummary,
  setProviderUsageLimits,
  type UsageMetric,
  type UsageSummary,
} from "../../../shared/api/sidecar";

type UsageDashboardProps = {
  activeProviderId?: string | null;
  activeSessionId?: string | null;
  profileId?: string | null;
  providers: ConnectedProvider[];
};

type ManualLimitDraft = {
  id: string;
  metric: UsageMetric;
  value: string;
  window: "minute" | "hour" | "day" | "month";
};

const manualWindowSeconds: Record<ManualLimitDraft["window"], number> = {
  day: 24 * 60 * 60,
  hour: 60 * 60,
  minute: 60,
  month: 30 * 24 * 60 * 60,
};

function manualLimitLabel(metric: UsageMetric, window: ManualLimitDraft["window"], t: TFunction) {
  const metricLabel =
    metric === "requests"
      ? t("usage.requests")
      : metric === "tokens"
        ? "tokens"
        : t("usage.credits");
  const windowLabel =
    window === "minute"
      ? t("usage.minute")
      : window === "hour"
        ? t("usage.hour")
        : window === "day"
          ? t("usage.day")
          : t("usage.month");
  return t("usage.manualLimit", { metric: metricLabel, window: windowLabel });
}

const periods = [
  { key: "24h", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", ms: 30 * 24 * 60 * 60 * 1000 },
  { key: "90d", ms: 90 * 24 * 60 * 60 * 1000 },
  { key: "all", ms: 0 },
] as const;

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function UsageDashboard({
  activeProviderId,
  activeSessionId,
  profileId,
  providers,
}: UsageDashboardProps) {
  const { t } = useTranslation();
  const [providerId, setProviderId] = useState(activeProviderId ?? providers[0]?.id ?? "");
  const [period, setPeriod] = useState<(typeof periods)[number]["key"]>("30d");
  const [sessionOnly, setSessionOnly] = useState(false);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [manualLimits, setManualLimits] = useState<ManualLimitDraft[]>([
    { id: "initial", metric: "tokens", value: "", window: "day" },
  ]);
  const [savingLimit, setSavingLimit] = useState(false);
  const [clearPending, setClearPending] = useState(false);

  useEffect(() => {
    if (activeProviderId) setProviderId(activeProviderId);
  }, [activeProviderId]);

  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const selected = periods.find((item) => item.key === period) ?? periods[2];
    const to = Date.now();
    const from = selected.ms ? to - selected.ms : undefined;
    const sessionId = sessionOnly && activeSessionId ? activeSessionId : undefined;
    void getUsageSummary({ providerId, profileId: profileId ?? undefined, sessionId, from, to })
      .then((next) => {
        if (!cancelled) setSummary(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Usage unavailable.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, period, profileId, providerId, sessionOnly]);

  async function saveManualLimit() {
    const limits = manualLimits.flatMap((draft) => {
      const value = Number(draft.value);
      return Number.isFinite(value) && value > 0
        ? [
            {
              label: manualLimitLabel(draft.metric, draft.window, t),
              limit: value,
              metric: draft.metric,
              windowSeconds: manualWindowSeconds[draft.window],
            },
          ]
        : [];
    });
    if (!providerId || !limits.length) return;
    setSavingLimit(true);
    setError("");
    try {
      await setProviderUsageLimits(providerId, limits);
      const selected = periods.find((item) => item.key === period) ?? periods[2];
      const to = Date.now();
      setSummary(
        await getUsageSummary({
          from: selected.ms ? to - selected.ms : undefined,
          profileId: profileId ?? undefined,
          providerId,
          to,
        }),
      );
      setManualLimits([{ id: "initial", metric: "tokens", value: "", window: "day" }]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the manual limit.");
    } finally {
      setSavingLimit(false);
    }
  }

  async function eraseHistory() {
    if (!clearPending) {
      setClearPending(true);
      return;
    }
    try {
      await clearUsageHistory();
      setClearPending(false);
      setSummary(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not clear usage history.");
    }
  }

  return (
    <section aria-labelledby="usage-dashboard-title" className="settings-section usage-dashboard">
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">{t("usage.usage")}</p>
          <h3 id="usage-dashboard-title">{t("usage.providerUsageAndLimits")}</h3>
        </div>
        <label className="usage-provider-select">
          <span className="sr-only">{t("usage.provider")}</span>
          <select
            aria-label={t("usage.usageProvider")}
            onChange={(event) => setProviderId(event.target.value)}
            value={providerId}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="usage-periods" role="tablist">
        {periods.map((item) => (
          <button
            aria-selected={period === item.key}
            className={period === item.key ? "is-active" : ""}
            disabled={sessionOnly}
            key={item.key}
            onClick={() => setPeriod(item.key)}
            role="tab"
            type="button"
          >
            {item.key === "all" ? t("usage.allTime") : item.key}
          </button>
        ))}
      </div>
      {activeSessionId && (
        <label className="usage-session-only">
          <input
            checked={sessionOnly}
            onChange={(event) => setSessionOnly(event.target.checked)}
            type="checkbox"
          />
          {t("usage.onlyThisSessionIgnoresThe")}
        </label>
      )}
      {loading ? (
        <div aria-label={t("usage.loadingUsage")} className="usage-skeleton" role="status" />
      ) : summary ? (
        <>
          {summary.lastRequest && (
            <div className="usage-context-grid">
              <p className="eyebrow">{t("usage.currentContextLastRequest")}</p>
              <div>
                <span>{t("usage.contextTokens")}</span>
                <strong>{formatNumber(summary.lastRequest.totalTokens)}</strong>
              </div>
              <div>
                <span>{t("usage.ofWhichCached")}</span>
                <strong>{formatNumber(summary.lastRequest.cachedInputTokens)}</strong>
              </div>
              {summary.lastRequest.contextLimit ? (
                <>
                  <div>
                    <span>{t("usage.contextLimit")}</span>
                    <strong>{formatNumber(summary.lastRequest.contextLimit)}</strong>
                  </div>
                  <div>
                    <span>{t("usage.usage")}</span>
                    <strong>
                      {Math.round(
                        (summary.lastRequest.totalTokens / summary.lastRequest.contextLimit) * 100,
                      )}
                      %
                    </strong>
                  </div>
                </>
              ) : null}
            </div>
          )}
          <div className="usage-total-grid">
            <p className="eyebrow">{t("usage.cumulativeAcrossAllRequestsBilling")}</p>
            <div>
              <span>{t("usage.requests")}</span>
              <strong>{formatNumber(summary.totals.requests)}</strong>
            </div>
            <div>
              <span>{t("usage.inputTokens")}</span>
              <strong>{formatNumber(summary.totals.inputTokens)}</strong>
            </div>
            <div>
              <span>{t("usage.outputTokens")}</span>
              <strong>{formatNumber(summary.totals.outputTokens)}</strong>
            </div>
            <div>
              <span>{t("usage.totalTokens")}</span>
              <strong>{formatNumber(summary.totals.totalTokens)}</strong>
            </div>
            <div>
              <span>{t("usage.cachedInputTokens")}</span>
              <strong>{formatNumber(summary.totals.cachedInputTokens)}</strong>
            </div>
            <div>
              <span>{t("usage.reasoningTokens")}</span>
              <strong>{formatNumber(summary.totals.reasoningTokens)}</strong>
            </div>
          </div>
          <div className="usage-window-list">
            {summary.windows.length ? (
              summary.windows.map((window) => (
                <div
                  className="usage-window"
                  key={`${window.source}-${window.metric}-${window.label}`}
                >
                  <div>
                    <strong>{window.label}</strong>
                    <span>
                      {window.source === "manual"
                        ? t("usage.manualEstimate")
                        : t("usage.reportedByProvider")}
                    </span>
                  </div>
                  <span>
                    {window.remainingPercent === undefined
                      ? t("usage.limitNotReported")
                      : `${Math.round(window.remainingPercent)}% ${t("usage.remaining")}`}
                    {window.resetAt && (
                      <small>
                        {t("usage.resets")}
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "short",
                          timeStyle: "short",
                        }).format(window.resetAt)}
                      </small>
                    )}
                  </span>
                </div>
              ))
            ) : (
              <p className="settings-empty">{t("usage.noProviderLimitWasReported")}</p>
            )}
          </div>
          {summary.daily.length > 0 && (
            <div className="usage-daily-table-wrap">
              <p className="eyebrow">{t("usage.dailyHistory")}</p>
              <table className="usage-daily-table">
                <thead>
                  <tr>
                    <th>{t("usage.date")}</th>
                    <th>{t("usage.requests")}</th>
                    <th>{t("usage.tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.daily.map((row) => (
                    <tr key={`${row.date}-${row.providerId}-${row.modelId}`}>
                      <td>{row.date}</td>
                      <td>{formatNumber(row.requests)}</td>
                      <td>{formatNumber(row.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <button className="text-button danger" onClick={() => void eraseHistory()} type="button">
            {clearPending ? t("usage.clickAgainToConfirm") : t("usage.deleteUsageHistory")}
          </button>
        </>
      ) : null}
      <section aria-labelledby="usage-manual-limits-title" className="usage-manual-limit">
        <p className="eyebrow" id="usage-manual-limits-title">
          {t("usage.manualLimitsEstimates")}
        </p>
        {manualLimits.map((draft) => (
          <div className="usage-manual-limit-row" key={draft.id}>
            <select
              aria-label={t("usage.manualLimitMetric")}
              onChange={(event) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id
                      ? { ...item, metric: event.target.value as UsageMetric }
                      : item,
                  ),
                )
              }
              value={draft.metric}
            >
              <option value="requests">{t("usage.requests")}</option>
              <option value="tokens">{t("usage.tokens")}</option>
              <option value="credits">{t("usage.credits2")}</option>
            </select>
            <input
              aria-label={t("usage.manualLimitValue")}
              inputMode="numeric"
              min="1"
              onChange={(event) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
              placeholder={t("usage.limit")}
              type="number"
              value={draft.value}
            />
            <select
              aria-label={t("usage.manualLimitWindow")}
              onChange={(event) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id
                      ? { ...item, window: event.target.value as ManualLimitDraft["window"] }
                      : item,
                  ),
                )
              }
              value={draft.window}
            >
              <option value="minute">{t("usage.minute")}</option>
              <option value="hour">{t("usage.hour")}</option>
              <option value="day">{t("usage.day")}</option>
              <option value="month">{t("usage.month2")}</option>
            </select>
            {manualLimits.length > 1 && (
              <button
                aria-label={t("usage.removeManualLimit")}
                className="text-button danger"
                onClick={() =>
                  setManualLimits((current) => current.filter((item) => item.id !== draft.id))
                }
                type="button"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <div className="settings-actions">
          <button
            className="button button-secondary"
            onClick={() =>
              setManualLimits((current) => [
                ...current,
                { id: crypto.randomUUID(), metric: "tokens", value: "", window: "day" },
              ])
            }
            type="button"
          >
            {t("usage.addLimit")}
          </button>
          <button
            className="button button-primary"
            disabled={savingLimit || !manualLimits.some((draft) => Number(draft.value) > 0)}
            onClick={() => void saveManualLimit()}
            type="button"
          >
            {savingLimit ? "…" : t("usage.saveEstimates")}
          </button>
        </div>
      </section>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export { UsageDashboard };

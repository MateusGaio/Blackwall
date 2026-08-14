// MIT License — Copyright (c) 2026 Mateus Gaio
import { useEffect, useState } from "react";
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
  isEnglish: boolean;
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

function manualLimitLabel(
  metric: UsageMetric,
  window: ManualLimitDraft["window"],
  isEnglish: boolean,
) {
  const metricLabel =
    metric === "requests"
      ? isEnglish
        ? "requests"
        : "requisições"
      : metric === "tokens"
        ? "tokens"
        : isEnglish
          ? "credits"
          : "créditos";
  const windowLabel =
    window === "minute"
      ? isEnglish
        ? "minute"
        : "minuto"
      : window === "hour"
        ? isEnglish
          ? "hour"
          : "hora"
        : window === "day"
          ? isEnglish
            ? "day"
            : "dia"
          : isEnglish
            ? "month"
            : "mês";
  return isEnglish
    ? `Manual ${metricLabel} per ${windowLabel}`
    : `${metricLabel} manuais por ${windowLabel}`;
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
  isEnglish,
  profileId,
  providers,
}: UsageDashboardProps) {
  const [providerId, setProviderId] = useState(activeProviderId ?? providers[0]?.id ?? "");
  const [period, setPeriod] = useState<(typeof periods)[number]["key"]>("30d");
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
    void getUsageSummary({ providerId, profileId: profileId ?? undefined, from, to })
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
  }, [period, profileId, providerId]);

  async function saveManualLimit() {
    const limits = manualLimits.flatMap((draft) => {
      const value = Number(draft.value);
      return Number.isFinite(value) && value > 0
        ? [
            {
              label: manualLimitLabel(draft.metric, draft.window, isEnglish),
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
          <p className="eyebrow">{isEnglish ? "Usage" : "Uso"}</p>
          <h3 id="usage-dashboard-title">
            {isEnglish ? "Provider usage and limits" : "Uso e limites dos provedores"}
          </h3>
        </div>
        <label className="usage-provider-select">
          <span className="sr-only">{isEnglish ? "Provider" : "Provedor"}</span>
          <select
            aria-label={isEnglish ? "Usage provider" : "Provedor do uso"}
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
            key={item.key}
            onClick={() => setPeriod(item.key)}
            role="tab"
            type="button"
          >
            {item.key === "all" ? (isEnglish ? "All time" : "Todo período") : item.key}
          </button>
        ))}
      </div>
      {loading ? (
        <div
          aria-label={isEnglish ? "Loading usage" : "Carregando uso"}
          className="usage-skeleton"
          role="status"
        />
      ) : summary ? (
        <>
          <div className="usage-total-grid">
            <div>
              <span>{isEnglish ? "Requests" : "Requisições"}</span>
              <strong>{formatNumber(summary.totals.requests)}</strong>
            </div>
            <div>
              <span>{isEnglish ? "Input tokens" : "Tokens de entrada"}</span>
              <strong>{formatNumber(summary.totals.inputTokens)}</strong>
            </div>
            <div>
              <span>{isEnglish ? "Output tokens" : "Tokens de saída"}</span>
              <strong>{formatNumber(summary.totals.outputTokens)}</strong>
            </div>
            <div>
              <span>{isEnglish ? "Total tokens" : "Tokens totais"}</span>
              <strong>{formatNumber(summary.totals.totalTokens)}</strong>
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
                        ? isEnglish
                          ? "Manual estimate"
                          : "Estimativa manual"
                        : isEnglish
                          ? "Reported by provider"
                          : "Informado pelo provedor"}
                    </span>
                  </div>
                  <span>
                    {window.remainingPercent === undefined
                      ? isEnglish
                        ? "Limit not reported"
                        : "Limite não informado"
                      : `${Math.round(window.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`}
                    {window.resetAt && (
                      <small>
                        {isEnglish ? " · resets " : " · renova "}
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
              <p className="settings-empty">
                {isEnglish
                  ? "No provider limit was reported."
                  : "Nenhum limite foi informado pelo provedor."}
              </p>
            )}
          </div>
          {summary.daily.length > 0 && (
            <div className="usage-daily-table-wrap">
              <p className="eyebrow">{isEnglish ? "Daily history" : "Histórico diário"}</p>
              <table className="usage-daily-table">
                <thead>
                  <tr>
                    <th>{isEnglish ? "Date" : "Data"}</th>
                    <th>{isEnglish ? "Requests" : "Requisições"}</th>
                    <th>{isEnglish ? "Tokens" : "Tokens"}</th>
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
            {clearPending
              ? isEnglish
                ? "Click again to confirm"
                : "Clique novamente para confirmar"
              : isEnglish
                ? "Delete usage history"
                : "Apagar histórico de uso"}
          </button>
        </>
      ) : null}
      <section aria-labelledby="usage-manual-limits-title" className="usage-manual-limit">
        <p className="eyebrow" id="usage-manual-limits-title">
          {isEnglish ? "Manual limits (estimates)" : "Limites manuais (estimativas)"}
        </p>
        {manualLimits.map((draft) => (
          <div className="usage-manual-limit-row" key={draft.id}>
            <select
              aria-label={isEnglish ? "Manual limit metric" : "Métrica do limite manual"}
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
              <option value="requests">{isEnglish ? "Requests" : "Requisições"}</option>
              <option value="tokens">{isEnglish ? "Tokens" : "Tokens"}</option>
              <option value="credits">{isEnglish ? "Credits" : "Créditos"}</option>
            </select>
            <input
              aria-label={isEnglish ? "Manual limit value" : "Valor do limite manual"}
              inputMode="numeric"
              min="1"
              onChange={(event) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id ? { ...item, value: event.target.value } : item,
                  ),
                )
              }
              placeholder={isEnglish ? "Limit" : "Limite"}
              type="number"
              value={draft.value}
            />
            <select
              aria-label={isEnglish ? "Manual limit window" : "Janela do limite manual"}
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
              <option value="minute">{isEnglish ? "Minute" : "Minuto"}</option>
              <option value="hour">{isEnglish ? "Hour" : "Hora"}</option>
              <option value="day">{isEnglish ? "Day" : "Dia"}</option>
              <option value="month">{isEnglish ? "Month" : "Mês"}</option>
            </select>
            {manualLimits.length > 1 && (
              <button
                aria-label={isEnglish ? "Remove manual limit" : "Remover limite manual"}
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
            {isEnglish ? "Add limit" : "Adicionar limite"}
          </button>
          <button
            className="button button-primary"
            disabled={savingLimit || !manualLimits.some((draft) => Number(draft.value) > 0)}
            onClick={() => void saveManualLimit()}
            type="button"
          >
            {savingLimit ? "…" : isEnglish ? "Save estimates" : "Salvar estimativas"}
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

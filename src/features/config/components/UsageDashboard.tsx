// MIT License — Copyright (c) 2026 Mateus Gaio
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
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

const eyebrowClass = "font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground";

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-0.5">
      <span className="font-mono text-[0.68rem] text-muted-foreground">{label}</span>
      <strong className="text-sm font-medium">{value}</strong>
    </div>
  );
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
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : t("usage.usageUnavailable"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, period, profileId, providerId, sessionOnly, t]);

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
      setError(reason instanceof Error ? reason.message : t("usage.saveManualLimitFailed"));
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
      setError(reason instanceof Error ? reason.message : t("usage.clearHistoryFailed"));
    }
  }

  return (
    <section aria-labelledby="usage-dashboard-title" className="grid gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={eyebrowClass}>{t("usage.usage")}</p>
          <h3 className="mt-1 text-sm font-medium" id="usage-dashboard-title">
            {t("usage.providerUsageAndLimits")}
          </h3>
        </div>
        <Select value={providerId} onValueChange={setProviderId}>
          <SelectTrigger aria-label={t("usage.usageProvider")} size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providers.map((provider) => (
              <SelectItem key={provider.id} value={provider.id}>
                {provider.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Tabs value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
        <TabsList aria-label={t("usage.providerUsageAndLimits")}>
          {periods.map((item) => (
            <TabsTrigger disabled={sessionOnly} key={item.key} value={item.key}>
              {item.key === "all" ? t("usage.allTime") : item.key}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {activeSessionId && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            checked={sessionOnly}
            className="size-3.5 accent-foreground"
            onChange={(event) => setSessionOnly(event.target.checked)}
            type="checkbox"
          />
          {t("usage.onlyThisSessionIgnoresThe")}
        </label>
      )}
      {loading ? (
        <Skeleton aria-hidden className="h-28 rounded-lg" />
      ) : summary ? (
        <>
          {summary.lastRequest && (
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
              <p className={`${eyebrowClass} col-span-full mt-0`}>
                {t("usage.currentContextLastRequest")}
              </p>
              <Stat
                label={t("usage.contextTokens")}
                value={formatNumber(summary.lastRequest.totalTokens)}
              />
              <Stat
                label={t("usage.ofWhichCached")}
                value={formatNumber(summary.lastRequest.cachedInputTokens)}
              />
              {summary.lastRequest.contextLimit ? (
                <>
                  <Stat
                    label={t("usage.contextLimit")}
                    value={formatNumber(summary.lastRequest.contextLimit)}
                  />
                  <Stat
                    label={t("usage.usage")}
                    value={`${Math.round(
                      (summary.lastRequest.totalTokens / summary.lastRequest.contextLimit) * 100,
                    )}%`}
                  />
                </>
              ) : null}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
            <p className={`${eyebrowClass} col-span-full mt-0`}>
              {t("usage.cumulativeAcrossAllRequestsBilling")}
            </p>
            <Stat label={t("usage.requests")} value={formatNumber(summary.totals.requests)} />
            <Stat label={t("usage.inputTokens")} value={formatNumber(summary.totals.inputTokens)} />
            <Stat
              label={t("usage.outputTokens")}
              value={formatNumber(summary.totals.outputTokens)}
            />
            <Stat label={t("usage.totalTokens")} value={formatNumber(summary.totals.totalTokens)} />
            <Stat
              label={t("usage.cachedInputTokens")}
              value={formatNumber(summary.totals.cachedInputTokens)}
            />
            <Stat
              label={t("usage.reasoningTokens")}
              value={formatNumber(summary.totals.reasoningTokens)}
            />
          </div>
          <div className="grid gap-1.5">
            {summary.windows.length ? (
              summary.windows.map((window) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                  key={`${window.source}-${window.metric}-${window.label}`}
                >
                  <div>
                    <strong className="block text-[0.82rem] font-medium">{window.label}</strong>
                    <span className="font-mono text-[0.68rem] text-muted-foreground">
                      {window.source === "manual"
                        ? t("usage.manualEstimate")
                        : t("usage.reportedByProvider")}
                    </span>
                  </div>
                  <span className="text-right font-mono text-xs">
                    {window.remainingPercent === undefined
                      ? t("usage.limitNotReported")
                      : `${Math.round(window.remainingPercent)}% ${t("usage.remaining")}`}
                    {window.resetAt && (
                      <small className="block text-muted-foreground">
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
              <p className="text-sm text-muted-foreground">
                {t("usage.noProviderLimitWasReported")}
              </p>
            )}
          </div>
          {summary.daily.length > 0 && (
            <div>
              <p className={eyebrowClass}>{t("usage.dailyHistory")}</p>
              <table className="mt-2 w-full border-collapse text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-1.5 pr-3 font-normal">{t("usage.date")}</th>
                    <th className="py-1.5 pr-3 font-normal">{t("usage.requests")}</th>
                    <th className="py-1.5 font-normal">{t("usage.tokens")}</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.daily.map((row) => (
                    <tr
                      className="border-b border-border/50"
                      key={`${row.date}-${row.providerId}-${row.modelId}`}
                    >
                      <td className="py-1.5 pr-3">{row.date}</td>
                      <td className="py-1.5 pr-3">{formatNumber(row.requests)}</td>
                      <td className="py-1.5">{formatNumber(row.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button
            className="w-fit justify-self-start"
            onClick={() => void eraseHistory()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="text-destructive">
              {clearPending ? t("usage.clickAgainToConfirm") : t("usage.deleteUsageHistory")}
            </span>
          </Button>
        </>
      ) : null}
      <section aria-labelledby="usage-manual-limits-title" className="grid gap-3">
        <p className={eyebrowClass} id="usage-manual-limits-title">
          {t("usage.manualLimitsEstimates")}
        </p>
        {manualLimits.map((draft) => (
          <div className="flex flex-wrap items-end gap-2" key={draft.id}>
            <Select
              value={draft.metric}
              onValueChange={(value) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id ? { ...item, metric: value as UsageMetric } : item,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={t("usage.manualLimitMetric")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="requests">{t("usage.requests")}</SelectItem>
                <SelectItem value="tokens">{t("usage.tokens")}</SelectItem>
                <SelectItem value="credits">{t("usage.credits2")}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label={t("usage.manualLimitValue")}
              className="w-32"
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
            <Select
              value={draft.window}
              onValueChange={(value) =>
                setManualLimits((current) =>
                  current.map((item) =>
                    item.id === draft.id
                      ? { ...item, window: value as ManualLimitDraft["window"] }
                      : item,
                  ),
                )
              }
            >
              <SelectTrigger aria-label={t("usage.manualLimitWindow")} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="minute">{t("usage.minute")}</SelectItem>
                <SelectItem value="hour">{t("usage.hour")}</SelectItem>
                <SelectItem value="day">{t("usage.day")}</SelectItem>
                <SelectItem value="month">{t("usage.month2")}</SelectItem>
              </SelectContent>
            </Select>
            {manualLimits.length > 1 && (
              <Button
                aria-label={t("usage.removeManualLimit")}
                onClick={() =>
                  setManualLimits((current) => current.filter((item) => item.id !== draft.id))
                }
                size="icon-xs"
                type="button"
                variant="ghost"
              >
                ×
              </Button>
            )}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2">
          <Button
            onClick={() =>
              setManualLimits((current) => [
                ...current,
                { id: crypto.randomUUID(), metric: "tokens", value: "", window: "day" },
              ])
            }
            type="button"
            variant="secondary"
          >
            {t("usage.addLimit")}
          </Button>
          <Button
            disabled={savingLimit || !manualLimits.some((draft) => Number(draft.value) > 0)}
            onClick={() => void saveManualLimit()}
            type="submit"
          >
            {savingLimit ? "…" : t("usage.saveEstimates")}
          </Button>
        </div>
      </section>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export { UsageDashboard };

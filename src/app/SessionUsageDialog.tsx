// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage, UsageSummary } from "../shared/api/sidecar";

type SessionUsageDialogProps = {
  messages: ChatMessage[];
  modelName: string;
  onClose: () => void;
  providerName: string;
  sessionTitle: string;
  summary: UsageSummary | null;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="session-usage-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Session-scoped usage, matching how other harnesses report it: the headline
 * figure is the context the conversation currently occupies (the most recent
 * request), not the cumulative sum of every request — those are shown apart.
 */
function SessionUsageDialog({
  messages,
  modelName,
  onClose,
  providerName,
  sessionTitle,
  summary,
}: SessionUsageDialogProps) {
  const { t } = useTranslation();
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const last = summary?.lastRequest;
  // The provider reports prompt_tokens as already including the cached portion,
  // so subtract it to show the freshly billed input on its own.
  const freshInput = last ? Math.max(0, last.inputTokens - last.cachedInputTokens) : 0;
  const usagePercent =
    last?.contextLimit && last.contextLimit > 0
      ? Math.round((last.totalTokens / last.contextLimit) * 100)
      : undefined;
  const userMessages = messages.filter((message) => message.role === "user").length;
  const assistantMessages = messages.filter((message) => message.role === "assistant").length;
  const unavailable = t("usage.notReported");

  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        aria-labelledby="session-usage-title"
        aria-modal="true"
        className="session-usage-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p className="eyebrow">{t("usage.usage")}</p>
            <h2 id="session-usage-title">{t("usage.sessionUsage")}</h2>
          </div>
          <button className="text-button" onClick={onClose} ref={closeRef} type="button">
            {t("usage.close")}
          </button>
        </header>

        <div className="session-usage-grid">
          <Field label={t("usage.session")} value={sessionTitle} />
          <Field label={t("usage.messages")} value={formatNumber(messages.length)} />
          <Field label={t("usage.provider")} value={providerName} />
          <Field label={t("usage.model")} value={modelName} />
        </div>

        {last ? (
          <>
            <p className="eyebrow session-usage-section">{t("usage.currentContext")}</p>
            {usagePercent !== undefined && (
              <div className="session-usage-meter">
                <div style={{ width: `${Math.min(100, usagePercent)}%` }} />
              </div>
            )}
            <div className="session-usage-grid">
              <Field
                label={t("usage.contextLimit")}
                value={last.contextLimit ? formatNumber(last.contextLimit) : unavailable}
              />
              <Field
                label={t("usage.usage")}
                value={usagePercent === undefined ? unavailable : `${usagePercent}%`}
              />
              <Field label={t("usage.totalTokens")} value={formatNumber(last.totalTokens)} />
              <Field label={t("usage.inputTokens")} value={formatNumber(freshInput)} />
              <Field
                label={t("usage.cacheTokensRead")}
                value={formatNumber(last.cachedInputTokens)}
              />
              <Field
                label={t("usage.outputTokensInclReasoning")}
                value={formatNumber(last.outputTokens)}
              />
              <Field
                label={t("usage.reasoningTokens")}
                value={formatNumber(last.reasoningTokens)}
              />
              <Field label={t("usage.userMessages")} value={formatNumber(userMessages)} />
              <Field label={t("usage.assistantMessages")} value={formatNumber(assistantMessages)} />
            </div>
          </>
        ) : (
          <p className="settings-empty">{t("usage.noRequestRecordedForThis")}</p>
        )}

        <p className="eyebrow session-usage-section">{t("usage.cumulativeBilling")}</p>
        <p className="session-usage-note">{t("usage.everyRequestResendsTheWhole")}</p>
        <div className="session-usage-grid">
          <Field label={t("usage.requests")} value={formatNumber(summary?.totals.requests ?? 0)} />
          <Field
            label={t("usage.totalTokens")}
            value={formatNumber(summary?.totals.totalTokens ?? 0)}
          />
          <Field
            label={t("usage.inputTokens")}
            value={formatNumber(summary?.totals.inputTokens ?? 0)}
          />
          <Field
            label={t("usage.outputTokens")}
            value={formatNumber(summary?.totals.outputTokens ?? 0)}
          />
        </div>
      </section>
    </div>
  );
}

export { SessionUsageDialog };

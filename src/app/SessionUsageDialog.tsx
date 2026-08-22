// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import { ProgressIndicator } from "@/shared/components/motion/ProgressIndicator";
import { Button } from "@/shared/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
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
    <div className="grid gap-1">
      <span className="font-mono text-[0.68rem] text-muted-foreground">{label}</span>
      <strong className="text-sm font-medium">{value}</strong>
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
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
            {t("usage.usage")}
          </p>
          <DialogTitle>{t("usage.sessionUsage")}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("usage.session")} value={sessionTitle} />
          <Field label={t("usage.messages")} value={formatNumber(messages.length)} />
          <Field label={t("usage.provider")} value={providerName} />
          <Field label={t("usage.model")} value={modelName} />
        </div>

        {last ? (
          <>
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
              {t("usage.currentContext")}
            </p>
            {usagePercent !== undefined && (
              <ProgressIndicator label={t("usage.usage")} value={Math.min(100, usagePercent)} />
            )}
            <div className="grid grid-cols-2 gap-3">
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
          <p className="text-sm text-muted-foreground">{t("usage.noRequestRecordedForThis")}</p>
        )}

        <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
          {t("usage.cumulativeBilling")}
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("usage.everyRequestResendsTheWhole")}
        </p>
        <div className="grid grid-cols-2 gap-3">
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
        <Button onClick={onClose} size="sm" variant="secondary" className="w-fit">
          {t("usage.close")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export { SessionUsageDialog };

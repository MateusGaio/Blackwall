// MIT License — Copyright (c) 2026 Mateus Gaio

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import type { ConnectedProvider, UsageSummary } from "../../../shared/api/sidecar";

type SessionStatusLineProps = {
  activeProvider: ConnectedProvider | null;
  modelName: string;
  onOpenDetails: () => void;
  queuedCount: number;
  streamingStatus: string;
  summary: UsageSummary | null;
};

/**
 * Linha de sessão da U5 (padrão status line do Claude Code, adaptado):
 * provedor › modelo · ctx % com barra de blocos · janela do roteador · fila.
 * Headline de contexto é a última requisição — ocupação da conversa, não soma
 * acumulada. Custo não existe no Blackwall (grátis): o análogo é a janela de
 * limite mais restritiva conhecida.
 */
export function SessionStatusLine({
  activeProvider,
  modelName,
  onOpenDetails,
  queuedCount,
  streamingStatus,
  summary,
}: SessionStatusLineProps) {
  const { t } = useTranslation();

  const last = summary?.lastRequest;
  const ctxPercent =
    last?.contextLimit && last.contextLimit > 0
      ? Math.min(100, Math.round((last.totalTokens / last.contextLimit) * 100))
      : undefined;
  const filled = ctxPercent === undefined ? 0 : Math.round(ctxPercent / 10);
  const bar = `${"▓".repeat(filled)}${"░".repeat(10 - filled)}`;
  const compact = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1, notation: "compact" }),
    [],
  );

  const restrictiveWindow = useMemo(() => {
    const candidates = (summary?.windows ?? [])
      .filter((window) => window.remainingPercent !== undefined)
      .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101));
    return candidates[0];
  }, [summary?.windows]);

  return (
    <EnterExit offsetPx={2} show={Boolean(activeProvider)}>
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.68rem] text-muted-foreground"
        data-testid="session-statusline"
      >
        {streamingStatus ? (
          <span className="flex items-center gap-1">
            <span aria-hidden="true">▸</span>
            {streamingStatus}
          </span>
        ) : null}
        {activeProvider && (
          <span className="max-w-[24ch] truncate">
            {activeProvider.name} › {modelName}
          </span>
        )}
        {last && last.totalTokens > 0 ? (
          <button
            aria-haspopup="dialog"
            className="transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
            onClick={onOpenDetails}
            title={t("chat.viewFullUsage")}
            type="button"
          >
            {t("chat.ctx")}{" "}
            {ctxPercent !== undefined
              ? `${ctxPercent}% [${bar}] `
              : ""}{compact.format(last.totalTokens)}
            {last.contextLimit ? `/${compact.format(last.contextLimit)}` : ""}
          </button>
        ) : null}
        {restrictiveWindow?.remainingPercent !== undefined && (
          <span>
            {t("chat.routerWindow")} {Math.round(restrictiveWindow.remainingPercent)}%{" "}
            {t("chat.remaining")}
          </span>
        )}
        {queuedCount > 0 && <span>{t("chat.queueCount", { count: queuedCount })}</span>}
      </div>
    </EnterExit>
  );
}

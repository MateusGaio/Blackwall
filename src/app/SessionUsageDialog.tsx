// MIT License — Copyright (c) 2026 Mateus Gaio
import { useEffect, useRef } from "react";
import type { ChatMessage, UsageSummary } from "../shared/api/sidecar";

type SessionUsageDialogProps = {
  isEnglish: boolean;
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
  isEnglish,
  messages,
  modelName,
  onClose,
  providerName,
  sessionTitle,
  summary,
}: SessionUsageDialogProps) {
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
  const unavailable = isEnglish ? "not reported" : "não informado";

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
            <p className="eyebrow">{isEnglish ? "Usage" : "Uso"}</p>
            <h2 id="session-usage-title">{isEnglish ? "Session usage" : "Uso da sessão"}</h2>
          </div>
          <button className="text-button" onClick={onClose} ref={closeRef} type="button">
            {isEnglish ? "Close" : "Fechar"}
          </button>
        </header>

        <div className="session-usage-grid">
          <Field label={isEnglish ? "Session" : "Sessão"} value={sessionTitle} />
          <Field
            label={isEnglish ? "Messages" : "Mensagens"}
            value={formatNumber(messages.length)}
          />
          <Field label={isEnglish ? "Provider" : "Provedor"} value={providerName} />
          <Field label={isEnglish ? "Model" : "Modelo"} value={modelName} />
        </div>

        {last ? (
          <>
            <p className="eyebrow session-usage-section">
              {isEnglish ? "Current context" : "Contexto atual"}
            </p>
            {usagePercent !== undefined && (
              <div className="session-usage-meter">
                <div style={{ width: `${Math.min(100, usagePercent)}%` }} />
              </div>
            )}
            <div className="session-usage-grid">
              <Field
                label={isEnglish ? "Context limit" : "Limite de contexto"}
                value={last.contextLimit ? formatNumber(last.contextLimit) : unavailable}
              />
              <Field
                label={isEnglish ? "Usage" : "Uso"}
                value={usagePercent === undefined ? unavailable : `${usagePercent}%`}
              />
              <Field
                label={isEnglish ? "Total tokens" : "Total de tokens"}
                value={formatNumber(last.totalTokens)}
              />
              <Field
                label={isEnglish ? "Input tokens" : "Tokens de entrada"}
                value={formatNumber(freshInput)}
              />
              <Field
                label={isEnglish ? "Cache tokens (read)" : "Tokens de cache (leitura)"}
                value={formatNumber(last.cachedInputTokens)}
              />
              <Field
                label={
                  isEnglish
                    ? "Output tokens (incl. reasoning)"
                    : "Tokens de saída (inclui raciocínio)"
                }
                value={formatNumber(last.outputTokens)}
              />
              <Field
                label={isEnglish ? "Reasoning tokens" : "Tokens de raciocínio"}
                value={formatNumber(last.reasoningTokens)}
              />
              <Field
                label={isEnglish ? "User messages" : "Mensagens do usuário"}
                value={formatNumber(userMessages)}
              />
              <Field
                label={isEnglish ? "Assistant messages" : "Mensagens do assistente"}
                value={formatNumber(assistantMessages)}
              />
            </div>
          </>
        ) : (
          <p className="settings-empty">
            {isEnglish
              ? "No request recorded for this session yet."
              : "Nenhuma requisição registrada nesta sessão ainda."}
          </p>
        )}

        <p className="eyebrow session-usage-section">
          {isEnglish ? "Cumulative (billing)" : "Acumulado (cobrança)"}
        </p>
        <p className="session-usage-note">
          {isEnglish
            ? "Every request resends the whole transcript, so this sum grows much faster than the context above."
            : "Cada requisição reenvia o transcript inteiro, então esta soma cresce muito mais rápido que o contexto acima."}
        </p>
        <div className="session-usage-grid">
          <Field
            label={isEnglish ? "Requests" : "Requisições"}
            value={formatNumber(summary?.totals.requests ?? 0)}
          />
          <Field
            label={isEnglish ? "Total tokens" : "Tokens totais"}
            value={formatNumber(summary?.totals.totalTokens ?? 0)}
          />
          <Field
            label={isEnglish ? "Input tokens" : "Tokens de entrada"}
            value={formatNumber(summary?.totals.inputTokens ?? 0)}
          />
          <Field
            label={isEnglish ? "Output tokens" : "Tokens de saída"}
            value={formatNumber(summary?.totals.outputTokens ?? 0)}
          />
        </div>
      </section>
    </div>
  );
}

export { SessionUsageDialog };

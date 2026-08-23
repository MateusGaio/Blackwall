// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import { CompactIcon } from "../../../../app/shell/CompactIcon";
import type { ChatMessage } from "../../../../shared/api/sidecar";

const actionBar =
  "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type MessageActionsProps = {
  copiedMessageId: string | null;
  copyMessage: (message: ChatMessage) => void;
  isLastAssistant: boolean;
  message: ChatMessage;
  onEditingStart: (message: ChatMessage) => void;
  regenerate: () => void;
};

/** Ações pós-resposta: editar (usuário), copiar e regenerar (última do agente). */
export function MessageActions({
  copiedMessageId,
  copyMessage,
  isLastAssistant,
  message,
  onEditingStart,
  regenerate,
}: MessageActionsProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex gap-1 opacity-70 transition-opacity duration-[120ms] hover:opacity-100">
      {message.role === "user" && (
        <button
          aria-label={t("chat.editMessage")}
          className={actionBar}
          onClick={() => onEditingStart(message)}
          title={t("chat.edit")}
          type="button"
        >
          <CompactIcon kind="edit" />
        </button>
      )}
      {message.role === "assistant" && isLastAssistant && (
        <>
          <button
            aria-label={t("chat.copyMessage")}
            className={actionBar}
            onClick={() => copyMessage(message)}
            title={copiedMessageId === message.id ? t("chat.copied") : t("chat.copy")}
            type="button"
          >
            {copiedMessageId === message.id ? (
              <span aria-hidden="true">✓</span>
            ) : (
              <CompactIcon kind="copy" />
            )}
          </button>
          <button
            aria-label={t("chat.regenerateResponse")}
            className={actionBar}
            onClick={regenerate}
            title={t("chat.regenerate")}
            type="button"
          >
            <CompactIcon kind="refresh" />
          </button>
        </>
      )}
    </div>
  );
}

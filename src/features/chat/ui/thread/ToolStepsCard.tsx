// MIT License — Copyright (c) 2026 Mateus Gaio

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import { EnterExit } from "../../../../shared/components/motion/EnterExit";

/**
 * Passos agênticos estilo Codex App: grupo colapsado por padrão com rótulo
 * mono ("agiu · N ações"); ao expandir, revela linhas mono com a ferramenta
 * e um trecho cru do resultado.
 */
export function ToolStepsCard({ steps }: { steps: readonly ChatMessage[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <EnterExit offsetPx={4} show>
        <div className="font-mono text-xs text-muted-foreground">
          <button
            aria-expanded={open}
            className="group inline-flex items-center gap-1.5 rounded px-1 py-0.5 transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none"
            data-expanded={open}
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span
              aria-hidden="true"
              className="inline-block transition-transform duration-[120ms] group-data-[expanded=true]:rotate-90"
            >
              ▸
            </span>
            <span>{t("chat.workedSteps", { count: steps.length })}</span>
            <span aria-hidden="true" className="text-muted-foreground/60">
              ·
            </span>
            <span className="text-muted-foreground/80">
              {open ? t("chat.hideDetails") : t("chat.showDetails")}
            </span>
          </button>
          <EnterExit show={open}>
            <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 pl-3">
              {steps.map((step, index) => (
                <li className="truncate" key={step.id}>
                  <span aria-hidden="true">{index === steps.length - 1 ? "└─ " : "├─ "}</span>
                  {step.toolName ?? step.toolCallId ?? t("chat.toolFallbackName")}
                  {step.content.trim() ? ` · ${step.content.slice(0, 80)}` : ""}
                </li>
              ))}
            </ul>
          </EnterExit>
        </div>
      </EnterExit>
    </li>
  );
}

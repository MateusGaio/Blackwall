// MIT License — Copyright (c) 2026 Mateus Gaio

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../../shared/api/sidecar";
import { EnterExit } from "../../../../shared/components/motion/EnterExit";

/** Bloco de passos de ferramenta — recolhido por padrão, linhas mono ao expandir. */
export function ToolStepsCard({ steps }: { steps: readonly ChatMessage[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <li>
      <EnterExit offsetPx={4} show>
        <div className="font-mono text-xs text-muted-foreground">
          <button
            aria-expanded={open}
            className="rounded px-1 py-0.5 transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:outline-none"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            <span aria-hidden="true">{open ? "▾" : "▸"} </span>
            {t("chat.toolSteps", { count: steps.length })}
          </button>
          <EnterExit show={open}>
            <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 pl-3">
              {steps.map((step) => (
                <li className="truncate" key={step.id}>
                  <span aria-hidden="true">├─ </span>
                  {step.toolName ?? step.toolCallId ?? t("chat.toolFallbackName")}
                  {step.content.trim() ? ` · ${step.content.slice(0, 80)}` : ""}
                </li>
              ))}
              <li aria-hidden="true">└─</li>
            </ul>
          </EnterExit>
        </div>
      </EnterExit>
    </li>
  );
}

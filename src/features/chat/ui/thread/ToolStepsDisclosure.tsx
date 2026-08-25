// MIT License — Copyright (c) 2026 Mateus Gaio

import { type KeyboardEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../../shared/api/sidecar";

/**
 * Disclosure discreto dos passos agênticos (decisão do owner, #218):
 * um chevron "›" de 22 px na linha de ações APÓS a resposta — sem pill,
 * sem rótulos "agiu/ver detalhes" quando recolhido. Tooltip real em hover
 * e foco. Abertura por teclado é instantânea; por ponteiro usa 120 ms.
 * Conteúdo expandido quebra dentro do transcript (sem parede horizontal).
 */
export function ToolStepsDisclosure({
  steps,
  variant = "inline",
}: {
  steps: readonly ChatMessage[];
  /** inline: logo após a resposta; fallback: bloco órfão no transcript. */
  variant?: "inline" | "fallback";
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);

  if (steps.length === 0) return null;
  const label = open
    ? t("chat.actionDetailsHide", { count: steps.length })
    : t("chat.actionDetailsShow", { count: steps.length });

  function toggle(event: { preventDefault(): void }, viaKeyboard = false) {
    event.preventDefault();
    setInstant(viaKeyboard);
    setOpen((current) => !current);
  }
  function toggleFromKeyboard(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") toggle(event, true);
  }

  return (
    <div className={variant === "fallback" ? "pl-1" : ""} data-testid="agent-steps">
      <button
        aria-expanded={open}
        aria-label={label}
        className="group relative inline-flex size-[22px] items-center justify-center rounded text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none motion-reduce:transition-none"
        data-instant={instant || undefined}
        onClick={(event) => toggle(event)}
        onKeyDown={toggleFromKeyboard}
        type="button"
      >
        <span
          aria-hidden="true"
          className={`inline-block transition-transform duration-[120ms] motion-reduce:transition-none ${
            open ? "rotate-90" : ""
          } ${instant ? "!transition-none" : ""}`}
        >
          <svg
            aria-hidden="true"
            className="size-3"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
        {/* Tooltip real (hover E focus) — title isolado não satisfaz. */}
        <span
          className="pointer-events-none absolute bottom-full left-0 z-20 mb-1 hidden whitespace-nowrap rounded border border-border bg-popover px-1.5 py-0.5 text-[0.68rem] text-popover-foreground group-hover:block group-focus-visible:block"
          role="tooltip"
        >
          {label}
        </span>
      </button>
      {open && (
        <ul className="m-0 mt-1 grid list-none gap-0.5 overflow-y-auto p-0 pl-1 [max-height:14rem]">
          {steps.map((step) => (
            <li
              className="min-w-0 whitespace-normal break-words text-xs leading-snug text-muted-foreground"
              key={step.id}
            >
              <span aria-hidden="true" className="mr-1">
                {(step as { status?: string }).status === "failed" ? "✕" : "✓"}
              </span>
              <span className="text-foreground/80">{step.toolName ?? step.toolCallId}</span>
              {step.content.trim() ? ` · ${step.content.slice(0, 120)}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import { Progress } from "@/shared/components/ui/progress";
import { cn } from "@/shared/lib/utils";

type ProgressIndicatorProps = {
  /** Valor determinado (0–100). Omita para o modo indeterminado. */
  value?: number;
  /** Rótulo acessível; por padrão usa `motion.progressLabel`/`motion.progressBusy`. */
  label?: string;
  className?: string;
};

/** Indicador de progresso determinado/indeterminado (ADR-09 item 4), com rótulo via t(). */
export function ProgressIndicator({ value, label, className }: ProgressIndicatorProps) {
  const { t } = useTranslation();
  const indeterminate = value === undefined;
  const accessibleLabel =
    label ?? (indeterminate ? t("motion.progressBusy") : t("motion.progressLabel"));

  return (
    <Progress
      value={value}
      aria-label={accessibleLabel}
      aria-busy={indeterminate ? true : undefined}
      className={cn(indeterminate && "progress-indeterminate", className)}
    />
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import { Skeleton as SkeletonPrimitive } from "@/shared/components/ui/skeleton";
import { cn } from "@/shared/lib/utils";

type MotionSkeletonProps = {
  /** Rótulo acessível; por padrão usa `motion.skeletonLoading`. */
  label?: string;
  className?: string;
};

/** Wrapper consistente sobre o skeleton do shadcn, com status acessível via t(). */
export function Skeleton({ label, className }: MotionSkeletonProps) {
  const { t } = useTranslation();
  return (
    <div data-slot="motion-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label ?? t("motion.skeletonLoading")}</span>
      <SkeletonPrimitive aria-hidden className={cn("w-full", className)} />
    </div>
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio

import { type ElementType, useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

type MotionDuration = "fast" | "base" | "slow";

/** Fallback em ms, espelho dos tokens --motion-{fast,base,slow} de index.css. */
const FALLBACK_MS: Record<MotionDuration, number> = {
  fast: 120,
  base: 180,
  slow: 280,
};

type EnterExitProps = {
  /** Controla presença do conteúdo: `false` anima a saída antes de desmontar. */
  show: boolean;
  /** Duração ligada aos tokens --motion-* (padrão: base). */
  duration?: MotionDuration;
  /** Deslocamento vertical inicial da entrada, em px. */
  offsetPx?: number;
  className?: string;
  children: React.ReactNode;
  /** Chamado quando a saída termina e o conteúdo é desmontado. */
  onExited?: () => void;
  /** Desliga a transição para ações iniciadas pelo teclado. */
  instant?: boolean;
  /** Elemento host renderizado (padrão `div`; use `li` dentro de listas). */
  as?: "div" | "li";
};

/**
 * Animação de entrada E saída (ADR-09 item 3). Monocromática:
 * apenas opacity/transform/blur com os tokens --motion-*. Com
 * `prefers-reduced-motion`, troca opacidade instantaneamente e
 * ignora transform/blur.
 */
export function EnterExit({
  show,
  duration = "base",
  offsetPx = 4,
  className,
  onExited,
  as = "div",
  children,
  instant = false,
}: EnterExitProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(show);
  const [entered, setEntered] = useState(show);
  const hostRef = useRef<HTMLElement>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;
  const Host = as as ElementType;

  useEffect(() => {
    if (!show) {
      setEntered(false);
      return;
    }
    setMounted(true);
    if (reducedMotion || instant) {
      setEntered(true);
      return;
    }
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [show, reducedMotion, instant]);

  useEffect(() => {
    if (show || !mounted || entered) return;
    if (reducedMotion || instant) {
      setMounted(false);
      onExitedRef.current?.();
      return;
    }
    let ms = FALLBACK_MS[duration];
    if (hostRef.current && typeof window.getComputedStyle === "function") {
      const raw = window
        .getComputedStyle(hostRef.current)
        .getPropertyValue(`--motion-${duration}`)
        .trim();
      const parsed = Number.parseFloat(raw);
      if (!Number.isNaN(parsed)) ms = parsed;
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
      onExitedRef.current?.();
    }, ms + 30);
    return () => {
      window.clearTimeout(timer);
    };
  }, [show, mounted, entered, reducedMotion, duration, instant]);

  if (!mounted) return null;

  const state = show ? (entered ? "entered" : "entering") : "exiting";
  const motionOffset = show ? offsetPx : -2;

  return (
    <Host
      ref={hostRef}
      data-slot="motion-enter-exit"
      data-state={state}
      aria-hidden={show ? undefined : true}
      className={className}
      style={
        reducedMotion || instant
          ? { opacity: show ? 1 : 0 }
          : {
              opacity: entered ? 1 : 0,
              transform: entered ? "translateY(0)" : `translateY(${motionOffset}px)`,
              filter: entered ? "blur(0px)" : "blur(2px)",
              transitionProperty: "opacity, transform, filter",
              transitionDuration: `var(--motion-${duration})`,
              transitionTimingFunction: "var(--ease-out-quart)",
              willChange: entered ? undefined : "opacity, transform, filter",
            }
      }
    >
      {children}
    </Host>
  );
}

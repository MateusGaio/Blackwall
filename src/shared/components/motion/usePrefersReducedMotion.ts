// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function reducedMotionMatches() {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  return (
    window.matchMedia(QUERY).matches || document.documentElement.dataset.qaMotion === "reduced"
  );
}

/** Observa `prefers-reduced-motion` do usuário (ADR-09: respeito obrigatório). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : reducedMotionMatches(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(QUERY);
    const onChange = () => setReduced(reducedMotionMatches());
    mediaQuery.addEventListener("change", onChange);
    window.addEventListener("blackwall:qa-motion-change", onChange);
    return () => {
      mediaQuery.removeEventListener("change", onChange);
      window.removeEventListener("blackwall:qa-motion-change", onChange);
    };
  }, []);

  return reduced;
}

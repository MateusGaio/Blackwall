// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/** Observa `prefers-reduced-motion` do usuário (ADR-09: respeito obrigatório). */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(QUERY);
    const onChange = (event: MediaQueryListEvent) => {
      setReduced(event.matches);
    };
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

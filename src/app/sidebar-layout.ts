// MIT License — Copyright (c) 2026 Mateus Gaio

export const defaultSidebarWidth = 256;
export const minimumSidebarWidth = 200;
export const maximumSidebarWidth = 420;

/** Mantém a largura persistida e a largura recebida do divisor no contrato da UI. */
export function clampSidebarWidth(width: number, fallback = defaultSidebarWidth) {
  const safeWidth = Number.isFinite(width) ? width : fallback;
  return Math.min(maximumSidebarWidth, Math.max(minimumSidebarWidth, safeWidth));
}

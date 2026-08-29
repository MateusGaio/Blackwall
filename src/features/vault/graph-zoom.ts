// MIT License — Copyright (c) 2026 Mateus Gaio

export const minimumGraphZoom = 0.15;
export const maximumGraphZoom = 3.5;

export function clampGraphZoom(scale: number) {
  return Math.min(maximumGraphZoom, Math.max(minimumGraphZoom, scale));
}

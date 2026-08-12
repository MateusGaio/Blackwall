// MIT License — Copyright (c) 2026 Mateus Gaio
import { isTauri } from "@tauri-apps/api/core";

export function currentRuntime(): "desktop" | "web" {
  return isTauri() ? "desktop" : "web";
}

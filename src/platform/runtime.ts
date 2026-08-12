// MIT License — Copyright (c) 2026 Mateus Gaio
import { invoke, isTauri } from "@tauri-apps/api/core";

export function currentRuntime(): "desktop" | "web" {
  return isTauri() ? "desktop" : "web";
}

export async function sidecarUrl(): Promise<string> {
  if (isTauri()) {
    const config = await invoke<{ sidecar_url: string }>("runtime_config");
    return config.sidecar_url;
  }
  return import.meta.env.VITE_SIDECAR_URL ?? "";
}

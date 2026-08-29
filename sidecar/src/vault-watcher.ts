// MIT License — Copyright (c) 2026 Mateus Gaio

import { watch as fsWatch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const ignoredDirectories = new Set([
  ".blackwall",
  ".git",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

type WatchHandle = { close: () => void };
type WatchFactory = (
  directory: string,
  onEvent: (event: string, filename?: string) => void,
) => WatchHandle;

type VaultWatcherOptions = {
  debounceMs?: number;
  onChange: (paths: string[]) => void | Promise<void>;
  reconcileMs?: number;
  rootPath: string;
  watchFactory?: WatchFactory;
};

async function directoriesUnder(rootPath: string, currentPath = rootPath, result: string[] = []) {
  result.push(currentPath);
  const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || ignoredDirectories.has(entry.name))
      continue;
    await directoriesUnder(rootPath, join(currentPath, entry.name), result);
  }
  return result;
}

function markdownPath(path: string) {
  return /\.(md|markdown)$/i.test(path);
}

export function createVaultWatcher(options: VaultWatcherOptions) {
  const rootPath = resolve(options.rootPath);
  const debounceMs = options.debounceMs ?? 250;
  const factory =
    options.watchFactory ??
    ((directory, onEvent) =>
      fsWatch(directory, { persistent: false }, (event, filename) =>
        onEvent(event, filename?.toString()),
      ));
  const handles = new Map<string, WatchHandle>();
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const internalWrites = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;

  const schedule = (path: string) => {
    if (stopped || !markdownPath(path)) return;
    const oldTimer = pending.get(path);
    if (oldTimer) clearTimeout(oldTimer);
    pending.set(
      path,
      setTimeout(() => {
        pending.delete(path);
        void options.onChange([path]);
      }, debounceMs),
    );
  };

  const install = async () => {
    for (const directory of await directoriesUnder(rootPath)) {
      if (stopped || handles.has(directory)) continue;
      const handle = factory(directory, (_event, filename) => {
        const path = resolve(directory, filename ?? "");
        const internalTimer = internalWrites.get(path);
        if (internalTimer) {
          clearTimeout(internalTimer);
          internalWrites.delete(path);
          return;
        }
        schedule(path);
        void install();
      });
      handles.set(directory, handle);
    }
  };

  const start = async () => {
    await install();
    if (options.reconcileMs !== 0) {
      reconcileTimer = setInterval(() => void install(), options.reconcileMs ?? 30_000);
    }
    return controller;
  };

  const controller = {
    async start() {
      return start();
    },
    markInternalWrite(path: string) {
      const absolutePath = resolve(rootPath, path);
      const oldTimer = internalWrites.get(absolutePath);
      if (oldTimer) clearTimeout(oldTimer);
      internalWrites.set(
        absolutePath,
        setTimeout(() => internalWrites.delete(absolutePath), Math.max(debounceMs * 4, 1000)),
      );
    },
    stop() {
      stopped = true;
      if (reconcileTimer) clearInterval(reconcileTimer);
      for (const timer of pending.values()) clearTimeout(timer);
      for (const timer of internalWrites.values()) clearTimeout(timer);
      for (const handle of handles.values()) handle.close();
      pending.clear();
      internalWrites.clear();
      handles.clear();
    },
  };
  return controller;
}

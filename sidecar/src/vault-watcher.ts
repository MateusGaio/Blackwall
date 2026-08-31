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
  onError?: (error: unknown) => void;
  reconcileMs?: number;
  rootPath: string;
  watchFactory?: WatchFactory;
};

async function directoriesUnder(rootPath: string, currentPath = rootPath, result: string[] = []) {
  const entries = await readdir(currentPath, { withFileTypes: true }).catch(() => null);
  if (!entries) return result;
  result.push(currentPath);
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
    ((directory, onEvent) => {
      const watcher = fsWatch(directory, { persistent: false }, (event, filename) =>
        onEvent(event, filename?.toString()),
      );
      watcher.on("error", (error) => options.onError?.(error));
      return watcher;
    });
  const handles = new Map<string, WatchHandle>();
  const pending = new Set<string>();
  const internalWrites = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let installing: Promise<void> | undefined;

  const schedule = (path: string) => {
    if (stopped || !markdownPath(path)) return;
    pending.add(path);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      const paths = [...pending].sort();
      pending.clear();
      void Promise.resolve(options.onChange(paths)).catch((error) => options.onError?.(error));
    }, debounceMs);
  };

  const install = () => {
    if (installing) return installing;
    installing = (async () => {
      const directories = await directoriesUnder(rootPath);
      const discovered = new Set(directories);
      for (const [directory, handle] of handles) {
        if (discovered.has(directory)) continue;
        handle.close();
        handles.delete(directory);
      }
      for (const directory of directories) {
        if (stopped || handles.has(directory)) continue;
        try {
          const handle = factory(directory, (_event, filename) => {
            const path = resolve(directory, filename ?? "");
            if (internalWrites.has(path)) return;
            schedule(path);
            void install();
          });
          handles.set(directory, handle);
        } catch (error) {
          options.onError?.(error);
        }
      }
    })().finally(() => {
      installing = undefined;
    });
    return installing;
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
      if (stopped) return;
      stopped = true;
      if (reconcileTimer) clearInterval(reconcileTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      for (const timer of internalWrites.values()) clearTimeout(timer);
      for (const handle of handles.values()) handle.close();
      pending.clear();
      internalWrites.clear();
      handles.clear();
    },
  };
  return controller;
}

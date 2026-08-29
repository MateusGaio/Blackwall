// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createVaultWatcher } from "./vault-watcher.js";

describe("watcher do Vault", () => {
  it("debounceia Markdown, permite injeção e encerra handles", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-watcher-test-"));
    await mkdir(join(root, "nested"));
    const events = new Map<string, (event: string, filename?: string) => void>();
    const close = vi.fn();
    const changes: string[][] = [];
    const watcher = createVaultWatcher({
      debounceMs: 5,
      onChange: (paths) => changes.push(paths),
      reconcileMs: 0,
      rootPath: root,
      watchFactory: (directory, listener) => {
        events.set(directory, listener);
        return { close };
      },
    });
    const started = await watcher.start();
    const rootListener = events.get(root);
    expect(rootListener).toBeDefined();
    rootListener?.("change", "nota.md");
    rootListener?.("change", "nota.md");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([[join(root, "nota.md")]]);
    watcher.stop();
    expect(close).toHaveBeenCalled();
    expect(started).toBe(watcher);
    await rm(root, { force: true, recursive: true });
  });
});

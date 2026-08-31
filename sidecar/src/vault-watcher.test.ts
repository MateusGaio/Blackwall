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

  it("agrupa, deduplica e ordena caminhos de uma janela", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-watcher-batch-"));
    const events = new Map<string, (event: string, filename?: string) => void>();
    const changes: string[][] = [];
    const watcher = createVaultWatcher({
      debounceMs: 5,
      onChange: (paths) => changes.push(paths),
      reconcileMs: 0,
      rootPath: root,
      watchFactory: (directory, listener) => {
        events.set(directory, listener);
        return { close: vi.fn() };
      },
    });
    await watcher.start();
    const listener = events.get(root);
    listener?.("change", "z.md");
    listener?.("change", "a.md");
    listener?.("rename", "z.md");
    listener?.("change", "ignore.txt");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([[join(root, "a.md"), join(root, "z.md")]]);
    watcher.stop();
    await rm(root, { force: true, recursive: true });
  });

  it("suprime todos os eventos nativos de uma escrita interna e para duas vezes", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-watcher-internal-"));
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
    await watcher.start();
    watcher.markInternalWrite("nota.md");
    const listener = events.get(root);
    listener?.("change", "nota.md");
    listener?.("change", "nota.md");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([]);
    watcher.stop();
    watcher.stop();
    expect(close).toHaveBeenCalledOnce();
    await rm(root, { force: true, recursive: true });
  });

  it("descobre diretório novo quando o pai recebe o evento", async () => {
    const root = await mkdtemp(join(tmpdir(), "blackwall-watcher-discovery-"));
    const events = new Map<string, (event: string, filename?: string) => void>();
    const changes: string[][] = [];
    const watcher = createVaultWatcher({
      debounceMs: 5,
      onChange: (paths) => changes.push(paths),
      reconcileMs: 0,
      rootPath: root,
      watchFactory: (directory, listener) => {
        events.set(directory, listener);
        return { close: vi.fn() };
      },
    });
    await watcher.start();
    await mkdir(join(root, "new-folder"));
    events.get(root)?.("rename", "new-folder");
    await new Promise((resolve) => setTimeout(resolve, 10));
    events.get(join(root, "new-folder"))?.("rename", "created.md");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(changes).toEqual([[join(root, "new-folder", "created.md")]]);
    watcher.stop();
    await rm(root, { force: true, recursive: true });
  });
});

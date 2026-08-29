// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { enqueueExplicitCapture } from "./memory-capture.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("fila de captura de memória", () => {
  it("é idempotente para a mesma revisão e não persiste segredo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-memory-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Projeto",
      workspaceRootPath: "",
      workspaceSoul: "Workspace",
      workspaceMode: "none",
    });
    const input = {
      content: "api_key=secret123: usar local-first",
      profileId: state.activeProfileId as string,
      requestId: "req-1",
      sourceRevisionHash: "rev-1",
      turnMessageId: "msg-1",
    };
    const first = enqueueExplicitCapture(database.client, input);
    const second = enqueueExplicitCapture(database.client, input);
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    const row = database.client.prepare("SELECT input_json FROM memory_capture_jobs").get() as {
      input_json: string;
    };
    expect(row.input_json).not.toContain("secret123");
    database.close();
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createRunStore } from "./run-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("run store", () => {
  it("persiste o terminal antes do replay e rejeita duplicata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-run-store-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createRunStore(database.client);
    store.start({ requestId: "req-store" });
    expect(store.finish("req-store", "completed", { safe: true })).toBe(true);
    expect(store.finish("req-store", "failed", { safe: false })).toBe(false);
    expect(
      database.client
        .prepare(
          "SELECT terminal, COUNT(*) AS events FROM chat_runs JOIN chat_run_events USING(request_id) WHERE request_id = ?",
        )
        .get("req-store"),
    ).toMatchObject({ events: 1, terminal: "completed" });
    database.close();
  });
});

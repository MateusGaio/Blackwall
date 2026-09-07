// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { MEMORY_DISCLOSURE_VERSION } from "./memory-policy.js";
import { updateMemorySettings } from "./memory-store.js";
import { createMemoryWorker } from "./memory-worker.js";
import { createRunStore } from "./run-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("worker de memória", () => {
  it("processa fora do terminal, registra memory_extract e promove preferência segura", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-memory-worker-"));
    directories.push(directory);
    const database = openDatabase(directory);
    const store = createStore(database);
    const state = await store.bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Soul",
      workspaceName: "",
      workspaceRootPath: "",
      workspaceSoul: "",
      workspaceMode: "none",
    });
    const profileId = state.activeProfileId as string;
    const sessionId = state.activeSessionId as string;
    updateMemorySettings(database.client, profileId, {
      acceptDisclosure: true,
      automaticEnabled: true,
      disclosureVersion: MEMORY_DISCLOSURE_VERSION,
    });
    const user = store.appendMessage({
      content: "Prefiro respostas objetivas.",
      role: "user",
      sessionId,
    });
    const run = createRunStore(database.client);
    run.start({ profileId, requestId: "worker-run", sessionId });
    const committed = run.finishWithAssistant({
      assistantContent: "Certo.",
      model: "model",
      payload: {},
      profileId,
      providerId: "provider",
      requestId: "worker-run",
      sessionId,
      sourceUserMessageId: user.id,
    });
    expect(committed.jobId).toEqual(expect.any(String));
    const events: Array<Record<string, unknown>> = [];
    const worker = createMemoryWorker({
      client: database.client,
      extract: async () => ({
        candidates: [
          {
            confidence: 0.99,
            kind: "preference",
            reasonCode: "user_preference",
            scope: "profile",
            statement: "Prefere respostas objetivas.",
            subject: "estilo",
            value: "respostas objetivas",
          },
        ],
        tokens: { inputTokens: 10, outputTokens: 5 },
        windows: [],
      }),
      onEvent: (event) => events.push(event),
    });
    await worker.start();
    await worker.processOnce();
    await worker.stop();
    expect(
      database.client.prepare("SELECT status, input_json FROM memory_capture_jobs").get(),
    ).toMatchObject({ input_json: "{}", status: "succeeded" });
    expect(
      database.client
        .prepare("SELECT status, statement, evidence_count FROM profile_memories")
        .get(),
    ).toMatchObject({
      evidence_count: 1,
      status: "organized",
      statement: "Prefere respostas objetivas.",
    });
    expect(
      database.client.prepare("SELECT purpose FROM provider_usage_events").get(),
    ).toMatchObject({ purpose: "memory_extract" });
    expect(events.map((event) => event.type)).toContain("memory.capture.committed");
    database.close();
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { MEMORY_DISCLOSURE_VERSION } from "./memory-policy.js";
import {
  enqueueAutomaticMemoryCapture,
  listMemorySettings,
  updateMemorySettings,
} from "./memory-store.js";
import { createRunStore } from "./run-store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("memória automática", () => {
  it("começa desligada, exige disclosure e é idempotente", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-memory-v2-"));
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
    expect(listMemorySettings(database.client, profileId).automaticEnabled).toBe(false);
    expect(() =>
      updateMemorySettings(database.client, profileId, {
        automaticEnabled: true,
        disclosureVersion: MEMORY_DISCLOSURE_VERSION,
      }),
    ).toThrow("disclosure");
    updateMemorySettings(database.client, profileId, {
      acceptDisclosure: true,
      automaticEnabled: true,
      disclosureVersion: MEMORY_DISCLOSURE_VERSION,
    });
    const sessionId = state.activeSessionId as string;
    const user = store.appendMessage({
      content: "Prefiro respostas objetivas.",
      role: "user",
      sessionId,
    });
    const runStore = createRunStore(database.client);
    runStore.start({ profileId, requestId: "req-memory", sessionId });
    const result = runStore.finishWithAssistant({
      assistantContent: "Entendido.",
      model: "model",
      payload: { content: "Entendido." },
      profileId,
      providerId: "provider",
      requestId: "req-memory",
      sessionId,
      sourceUserMessageId: user.id,
    });
    expect(result.committed).toBe(true);
    expect(result.jobId).toEqual(expect.any(String));
    expect(
      database.client
        .prepare(
          "SELECT COUNT(*) AS count FROM messages WHERE session_id = ? AND role = 'assistant'",
        )
        .get(sessionId),
    ).toMatchObject({ count: 1 });
    expect(
      database.client
        .prepare("SELECT status, input_json, pipeline_version FROM memory_capture_jobs")
        .get(),
    ).toMatchObject({ input_json: "{}", pipeline_version: "v2", status: "pending" });
    expect(
      enqueueAutomaticMemoryCapture(database.client, {
        modelId: "model",
        profileId,
        requestId: "req-memory",
        sessionId,
        sourceContent: user.content,
        sourceProviderId: "provider",
        turnMessageId: user.id,
      }),
    ).toMatchObject({ inserted: false });
    database.close();
  });
});

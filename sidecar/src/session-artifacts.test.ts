// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { listSessionArtifacts, recordSessionArtifacts } from "./session-artifacts.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("artefatos por sessão", () => {
  it("mantém somente o último estado de cada caminho e preserva o primeiro avistamento", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-artifacts-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    });
    const sessionId = state.activeSessionId as string;
    const workspaceId = state.activeWorkspaceId as string;
    const created = recordSessionArtifacts(database.client, {
      artifacts: [
        { operation: "created", path: "src/new.ts" },
        { operation: "modified", path: "docs/guide.md" },
        { operation: "created", path: "../outside.txt" },
      ],
      sessionId,
      workspaceId,
    });
    const firstSeen = listSessionArtifacts(database.client, workspaceId, sessionId)?.find(
      (artifact) => artifact.path === "src/new.ts",
    )?.firstSeenAt;
    expect(created).toEqual({ created: 1, deleted: 0, modified: 1 });

    const updated = recordSessionArtifacts(database.client, {
      artifacts: [
        { operation: "modified", path: "src/new.ts" },
        { operation: "deleted", path: "docs/guide.md" },
      ],
      sessionId,
      workspaceId,
    });
    const artifacts = listSessionArtifacts(database.client, workspaceId, sessionId);
    database.close();

    expect(updated).toEqual({ created: 0, deleted: 1, modified: 1 });
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "modified", path: "src/new.ts" }),
        expect.objectContaining({ operation: "deleted", path: "docs/guide.md" }),
      ]),
    );
    expect(artifacts).toHaveLength(2);
    expect(artifacts?.find((artifact) => artifact.path === "src/new.ts")?.firstSeenAt).toBe(
      firstSeen,
    );
  });

  it("não retorna artefatos para sessão inexistente ou de outro workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-artifacts-scope-"));
    const root = join(directory, "workspace");
    const otherRoot = join(directory, "other");
    await mkdir(root);
    await mkdir(otherRoot);
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Ada",
      profileSoul: "Profile",
      workspaceName: "Project",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    });
    const other = await createStore(database).createWorkspace({
      name: "Other",
      profileId: state.activeProfileId as string,
      rootPath: otherRoot,
      soul: "Other",
    });
    const result = listSessionArtifacts(database.client, other.id, state.activeSessionId as string);
    database.close();
    expect(result).toBeNull();
  });
});

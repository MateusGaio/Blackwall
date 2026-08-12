// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { type ApprovalRequest, executeTool, resolveApproval } from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture(permissionMode: "ask" | "automatic" | "read-only" = "ask") {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-tools-"));
  const workspaceRoot = join(directory, "workspace");
  await mkdir(workspaceRoot);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    permissionMode,
    profileName: "Ada",
    profileSoul: "Profile",
    workspaceName: "Project",
    workspaceRootPath: workspaceRoot,
    workspaceSoul: "Workspace",
  });
  database.close();
  return { directory, state, workspaceRoot };
}

describe("ferramentas locais e permissões", () => {
  it("permite leitura automática e bloqueia escrita no modo read-only", async () => {
    const { directory, state, workspaceRoot } = await fixture("read-only");
    await expect(
      executeTool(
        {
          args: { path: "." },
          sessionId: state.activeSessionId,
          tool: "list_directory",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).resolves.toEqual({ entries: [] });
    await expect(
      executeTool(
        {
          args: { content: "blocked", path: "blocked.txt" },
          tool: "create_or_update_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toThrow("somente leitura");
    await expect(readFile(join(workspaceRoot, "blocked.txt"))).rejects.toThrow();
  });

  it("pede autorização antes de escrever e aceita permitir durante a sessão", async () => {
    const { directory, state } = await fixture("ask");
    let approval: ApprovalRequest | undefined;
    const execution = executeTool(
      {
        args: { content: "local", path: "notes.txt" },
        requestId: "request-write",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: (request) => (approval = request) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(approval?.requestId).toBe("request-write");
    await resolveApproval("request-write", "allow_session", directory);
    await expect(execution).resolves.toMatchObject({ path: "notes.txt" });
  });

  it("bloqueia links simbólicos e caminhos fora do workspace", async () => {
    const { directory, state } = await fixture("automatic");
    await expect(
      executeTool(
        {
          args: { path: "../secret.txt" },
          tool: "read_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toThrow("fora da pasta");
  });
});

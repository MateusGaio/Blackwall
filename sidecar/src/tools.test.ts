// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import {
  type ApprovalRequest,
  cancelPendingApprovals,
  executeTool,
  resolveApproval,
} from "./tools.js";

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
  it("lista caminhos canônicos, ignora dependências e trunca arquivos grandes", async () => {
    const { directory, state, workspaceRoot } = await fixture("automatic");
    await mkdir(join(workspaceRoot, "src"));
    await mkdir(join(workspaceRoot, "node_modules"));
    await writeFile(join(workspaceRoot, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(join(workspaceRoot, "large.txt"), "x".repeat(140_000));
    const listing = await executeTool(
      {
        args: { path: "." },
        tool: "list_directory",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
    );
    expect(listing.path).toBe(".");
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src", type: "directory" }),
        expect.objectContaining({ path: "large.txt", size: 140_000, type: "file" }),
      ]),
    );
    expect(listing.entries.some((entry) => entry.name === "node_modules")).toBe(false);
    const read = await executeTool(
      {
        args: { path: "large.txt" },
        tool: "read_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
    );
    expect(read).toMatchObject({
      bytesRead: 128_000,
      end: 128_000,
      path: "large.txt",
      size: 140_000,
      start: 0,
      truncated: true,
    });
  });

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
    ).resolves.toEqual({ entries: [], path: "." });
    await expect(
      executeTool(
        {
          args: { path: "" },
          sessionId: state.activeSessionId,
          tool: "list_directory",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).resolves.toEqual({ entries: [], path: "." });
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

  it("sanitiza o ambiente dos comandos e nega aprovações canceladas", async () => {
    const { directory, state } = await fixture("ask");
    const previousSecret = process.env.BLACKWALL_TEST_SECRET;
    process.env.BLACKWALL_TEST_SECRET = "must-not-cross-the-boundary";
    try {
      let approval: ApprovalRequest | undefined;
      const execution = executeTool(
        {
          args: {
            args: ["-e", "console.log(process.env.BLACKWALL_TEST_SECRET ?? '')"],
            command: process.execPath,
          },
          requestId: "request-sanitized",
          sessionId: state.activeSessionId,
          tool: "execute_command",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { onApproval: (request) => (approval = request) },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(approval?.requestId).toBe("request-sanitized");
      cancelPendingApprovals("request-sanitized", directory);
      await expect(execution).rejects.toThrow("negada");

      const allowedExecution = executeTool(
        {
          args: {
            args: ["-e", "console.log(process.env.BLACKWALL_TEST_SECRET ?? '')"],
            command: process.execPath,
          },
          requestId: "request-sanitized-allowed",
          sessionId: state.activeSessionId,
          tool: "execute_command",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { onApproval: () => undefined },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await resolveApproval("request-sanitized-allowed", "allow_once", directory);
      const result = await allowedExecution;
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("must-not-cross-the-boundary");
    } finally {
      if (previousSecret === undefined) delete process.env.BLACKWALL_TEST_SECRET;
      else process.env.BLACKWALL_TEST_SECRET = previousSecret;
    }
  });
});

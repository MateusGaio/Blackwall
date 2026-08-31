// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import {
  listMcpServers,
  mcpHasSecret,
  publicMcpToolName,
  removeMcpServer,
  saveMcpServer,
} from "./mcp.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-mcp-"));
  const workspaceRoot = join(directory, "workspace");
  await mkdir(workspaceRoot);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    permissionMode: "ask",
    profileName: "Ada",
    profileSoul: "Profile",
    workspaceName: "Project",
    workspaceRootPath: workspaceRoot,
    workspaceSoul: "Workspace",
  });
  database.close();
  return { directory, workspaceId: state.activeWorkspaceId as string };
}

describe("cliente MCP", () => {
  it("persiste somente referências de segredos e remove tudo em cascata", async () => {
    const { directory, workspaceId } = await fixture();
    const server = await saveMcpServer(
      workspaceId,
      {
        bearer: "bearer-value-never-in-db",
        config: { args: ["server.mjs"], command: "node", cwd: "isolated" },
        environment: { PRIVATE_TOKEN: "env-value-never-in-db" },
        name: "Filesystem helper",
        transport: "stdio",
      },
      directory,
    );

    expect(server).toMatchObject({ enabled: false, hasBearer: true, state: "disabled" });
    expect(server.envNames).toEqual(["PRIVATE_TOKEN"]);
    expect(listMcpServers(workspaceId, directory)).toHaveLength(1);
    expect(await mcpHasSecret(server.id, "bearer", "", directory)).toBe(true);
    expect(await mcpHasSecret(server.id, "env", "PRIVATE_TOKEN", directory)).toBe(true);

    const database = openDatabase(directory);
    const persisted = database.client
      .prepare(
        "SELECT config_json, secret_ref FROM mcp_servers JOIN mcp_server_secrets ON mcp_servers.id = mcp_server_secrets.server_id",
      )
      .all();
    database.close();
    expect(JSON.stringify(persisted)).not.toContain("bearer-value-never-in-db");
    expect(JSON.stringify(persisted)).not.toContain("env-value-never-in-db");

    await removeMcpServer(workspaceId, server.id, directory);
    expect(listMcpServers(workspaceId, directory)).toEqual([]);
    expect(await mcpHasSecret(server.id, "bearer", "", directory)).toBe(false);
  });

  it("gera nome público determinístico, opaco e limitado", () => {
    const first = publicMcpToolName(
      "Servidor com um nome bem longo para testar",
      "40f3b33e-8428-4427-9476-77458bd3c986",
      "ferramenta remota com um nome bem longo para testar",
    );
    const second = publicMcpToolName(
      "Servidor com um nome bem longo para testar",
      "40f3b33e-8428-4427-9476-77458bd3c986",
      "ferramenta remota com um nome bem longo para testar",
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^mcp__[a-z0-9_-]+__[a-z0-9_-]+$/);
    expect(first.length).toBeLessThanOrEqual(64);
  });
});

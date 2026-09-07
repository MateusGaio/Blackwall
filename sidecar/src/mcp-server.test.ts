// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createSidecar, SIDECAR_HOST } from "./index.js";

const directories: string[] = [];
const servers: import("node:http").Server[] = [];
const nativeFetch = globalThis.fetch;

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-mcp-server-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  await writeFile(
    join(root, "shared.md"),
    "# Shared\n\nApenas este workspace pode aparecer.",
    "utf8",
  );
  directories.push(directory);
  const sidecarToken = "sidecar-token";
  const sidecar = await createSidecar(0, directory, { token: sidecarToken });
  servers.push(sidecar.server);
  const baseUrl = `http://${SIDECAR_HOST}:${sidecar.port}`;
  const bootstrap = await nativeFetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "MCP",
      profileSoul: "P",
      workspaceName: "W",
      workspaceRootPath: root,
      workspaceSoul: "W",
    }),
    headers: { authorization: `Bearer ${sidecarToken}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrap.json()) as { activeWorkspaceId: string };
  await nativeFetch(`${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/vault/reindex`, {
    headers: { authorization: `Bearer ${sidecarToken}` },
    method: "POST",
  });
  return { baseUrl, directory, sidecarToken, workspaceId: state.activeWorkspaceId };
}

function apiHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("servidor MCP local", () => {
  it("mantém o token fora do SQLite e só expõe busca após configuração explícita", async () => {
    const { baseUrl, directory, sidecarToken, workspaceId } = await fixture();
    const path = `/v1/workspaces/${workspaceId}/mcp/export`;
    const initial = await nativeFetch(`${baseUrl}${path}`, { headers: apiHeaders(sidecarToken) });
    await expect(initial.json()).resolves.toMatchObject({
      export: { enabled: false, hasToken: false, id: null },
    });

    const configured = await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ tools: ["search_workspace"] }),
      headers: apiHeaders(sidecarToken),
      method: "PUT",
    });
    expect(configured.status).toBe(200);
    const rotated = await nativeFetch(`${baseUrl}${path}/token/rotate`, {
      headers: apiHeaders(sidecarToken),
      method: "POST",
    });
    const body = (await rotated.json()) as { export: { endpointPath: string }; token: string };
    expect(body.token.length).toBeGreaterThan(40);
    const database = openDatabase(directory);
    const stored = database.client.prepare("SELECT * FROM mcp_exports").all();
    database.close();
    expect(JSON.stringify(stored)).not.toContain(body.token);

    const enabled = await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ enabled: true }),
      headers: apiHeaders(sidecarToken),
      method: "PUT",
    });
    expect(enabled.status).toBe(200);
    const unauthorized = await nativeFetch(`${baseUrl}${body.export.endpointPath}`, {
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);
    const sidecarAsMcp = await nativeFetch(`${baseUrl}${body.export.endpointPath}`, {
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      headers: { authorization: `Bearer ${sidecarToken}`, "content-type": "application/json" },
      method: "POST",
    });
    expect(sidecarAsMcp.status).toBe(401);
  });

  it("aceita o cliente oficial v2 e retorna apenas citações verificadas", async () => {
    const { baseUrl, sidecarToken, workspaceId } = await fixture();
    const path = `/v1/workspaces/${workspaceId}/mcp/export`;
    await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ tools: ["search_workspace"] }),
      headers: apiHeaders(sidecarToken),
      method: "PUT",
    });
    const rotated = await nativeFetch(`${baseUrl}${path}/token/rotate`, {
      headers: apiHeaders(sidecarToken),
      method: "POST",
    });
    const configured = (await rotated.json()) as {
      export: { endpointPath: string };
      token: string;
    };
    await nativeFetch(`${baseUrl}${path}`, {
      body: JSON.stringify({ enabled: true }),
      headers: apiHeaders(sidecarToken),
      method: "PUT",
    });

    const client = new Client(
      { name: "Blackwall test", version: "1" },
      { versionNegotiation: { mode: "auto" } },
    );
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}${configured.export.endpointPath}`),
      {
        authProvider: { token: async () => configured.token },
      },
    );
    await client.connect(transport);
    await expect(client.listTools()).resolves.toMatchObject({
      tools: [{ name: "search_workspace" }],
    });
    const result = await client.callTool({
      arguments: { limit: 6, query: "workspace" },
      name: "search_workspace",
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain("shared.md");
    expect(JSON.stringify(result)).not.toContain("blackwall-mcp-server-");
    await client.close();
  });
});

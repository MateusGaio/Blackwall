// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSidecar, SIDECAR_HOST } from "./index.js";

const servers: import("node:http").Server[] = [];
const directories: string[] = [];

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
  const directory = await mkdtemp(join(tmpdir(), "blackwall-vault-http-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const token = "vault-editor-token";
  const { port, server } = await createSidecar(0, directory, { token });
  servers.push(server);
  const baseUrl = `http://${SIDECAR_HOST}:${port}`;
  const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "Vault",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrap.json()) as { activeWorkspaceId: string };
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return { baseUrl, headers, root, workspaceId: state.activeWorkspaceId };
}

describe("API autenticada do editor do Vault", () => {
  it("não expõe mutações sem bearer e executa create, patch, archive e delete", async () => {
    const { baseUrl, headers, workspaceId } = await fixture();
    const endpoint = `${baseUrl}/v1/workspaces/${workspaceId}/vault/notes`;
    expect((await fetch(endpoint, { method: "POST" })).status).toBe(401);
    const createdResponse = await fetch(endpoint, {
      body: JSON.stringify({ body: "Conteúdo", title: "API note", type: "Note" }),
      headers,
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      note: { contentHash: string; portentId: string; path: string };
    };
    const detailResponse = await fetch(`${endpoint}/${created.note.portentId}`, {
      headers,
      method: "GET",
    });
    const detail = (await detailResponse.json()) as { note: { contentHash: string } };
    const archivedResponse = await fetch(`${endpoint}/${created.note.portentId}`, {
      body: JSON.stringify({ expectedHash: detail.note.contentHash, status: "archived" }),
      headers,
      method: "PATCH",
    });
    expect(archivedResponse.status).toBe(200);
    const archived = (await archivedResponse.json()) as {
      note: { contentHash: string; status: string };
    };
    expect(archived.note.status).toBe("archived");
    const conflict = await fetch(`${endpoint}/${created.note.portentId}`, {
      body: JSON.stringify({ body: "stale", expectedHash: detail.note.contentHash }),
      headers,
      method: "PATCH",
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      errorCode: "vault_note_conflict",
      currentHash: expect.any(String),
    });
    const deleted = await fetch(`${endpoint}/${created.note.portentId}`, {
      body: JSON.stringify({ expectedHash: archived.note.contentHash }),
      headers,
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(
      (await fetch(`${endpoint}/${created.note.portentId}`, { headers, method: "GET" })).status,
    ).toBe(404);
  });

  it("valida campos estritos, pagina sem corpo e não vaza root absoluto", async () => {
    const { baseUrl, headers, root, workspaceId } = await fixture();
    await mkdir(join(root, "Blackwall Vault", "Notes"), { recursive: true });
    await writeFile(join(root, "Blackwall Vault", "Notes", "external.md"), "# Externa", "utf8");
    const endpoint = `${baseUrl}/v1/workspaces/${workspaceId}/vault/notes`;
    const invalid = await fetch(endpoint, {
      body: JSON.stringify({ body: "x", title: "x", unknown: "no" }),
      headers,
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    const reindex = await fetch(`${baseUrl}/v1/workspaces/${workspaceId}/vault/reindex`, {
      headers,
      method: "POST",
    });
    expect(reindex.status).toBe(200);
    const listed = await fetch(`${endpoint}?page=1&pageSize=2`, { headers, method: "GET" });
    const body = await listed.text();
    expect(listed.status).toBe(200);
    expect(body).not.toContain(root);
    const diagnostics = await fetch(
      `${baseUrl}/v1/workspaces/${workspaceId}/vault/diagnostics?page=1&pageSize=10`,
      { headers, method: "GET" },
    );
    expect(diagnostics.status).toBe(200);
  });
});

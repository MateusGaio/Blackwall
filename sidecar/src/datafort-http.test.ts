// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  const directory = await mkdtemp(join(tmpdir(), "blackwall-datafort-http-"));
  const root = join(directory, "workspace");
  await mkdir(root);
  directories.push(directory);
  const token = "datafort-http-token";
  const { port, server } = await createSidecar(0, directory, { token });
  servers.push(server);
  const baseUrl = `http://${SIDECAR_HOST}:${port}`;
  const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "Datafort",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrap.json()) as { activeWorkspaceId: string };
  return { baseUrl, token, workspaceId: state.activeWorkspaceId };
}

function jsonHeaders(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("API do workspace Datafort", () => {
  it("protege as rotas, cria, salva draft, detecta conflito, move e restaura", async () => {
    const { baseUrl, token, workspaceId } = await fixture();
    const endpoint = `${baseUrl}/v1/workspaces/${workspaceId}/datafort`;
    expect((await fetch(`${endpoint}/settings`)).status).toBe(401);

    const settings = await fetch(`${endpoint}/settings`, { headers: jsonHeaders(token) });
    expect(settings.status).toBe(200);
    await expect(settings.json()).resolves.toMatchObject({
      settings: {
        explorerScope: "knowledge",
        newNoteDirectory: "Blackwall Vault/Notes",
      },
    });

    const createdResponse = await fetch(`${endpoint}/documents`, {
      body: JSON.stringify({ title: "HTTP note" }),
      headers: jsonHeaders(token),
      method: "POST",
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      document: { content: string; contentHash: string; fileId: string; path: string };
    };

    const draft = await fetch(`${endpoint}/drafts`, {
      body: JSON.stringify({
        content: "# draft",
        fileId: created.document.fileId,
        path: created.document.path,
      }),
      headers: jsonHeaders(token),
      method: "POST",
    });
    expect(draft.status).toBe(200);
    const updatedResponse = await fetch(`${endpoint}/documents`, {
      body: JSON.stringify({
        content: `${created.document.content}updated\n`,
        expectedHash: created.document.contentHash,
        fileId: created.document.fileId,
        path: created.document.path,
      }),
      headers: jsonHeaders(token),
      method: "PATCH",
    });
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()) as { document: { contentHash: string } };

    const conflict = await fetch(`${endpoint}/documents`, {
      body: JSON.stringify({
        content: "# stale",
        expectedHash: created.document.contentHash,
        fileId: created.document.fileId,
        path: created.document.path,
      }),
      headers: jsonHeaders(token),
      method: "PATCH",
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      errorCode: "datafort_conflict",
      currentHash: updated.document.contentHash,
    });

    const moved = await fetch(`${endpoint}/entries/move`, {
      body: JSON.stringify({
        expectedHash: updated.document.contentHash,
        sourcePath: created.document.path,
        targetPath: "Blackwall Vault/Notes/Moved.md",
      }),
      headers: jsonHeaders(token),
      method: "POST",
    });
    expect(moved.status).toBe(200);

    const tree = await fetch(`${endpoint}/tree`, { headers: jsonHeaders(token) });
    const treeBody = (await tree.json()) as { entries: Array<{ path: string }> };
    expect(treeBody.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "Blackwall Vault/Notes/Moved.md" })]),
    );

    const movedDocument = await fetch(
      `${endpoint}/documents?path=Blackwall%20Vault%2FNotes%2FMoved.md`,
      { headers: jsonHeaders(token) },
    );
    const movedBody = (await movedDocument.json()) as {
      documents: [{ contentHash: string; path: string }];
    };
    const deleted = await fetch(`${endpoint}/entries`, {
      body: JSON.stringify({
        expectedHash: movedBody.documents[0].contentHash,
        path: movedBody.documents[0].path,
      }),
      headers: jsonHeaders(token),
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const deletedBody = (await deleted.json()) as { entryId: string };
    const restored = await fetch(`${endpoint}/trash/restore`, {
      body: JSON.stringify({ entryId: deletedBody.entryId }),
      headers: jsonHeaders(token),
      method: "POST",
    });
    expect(restored.status).toBe(200);
  });

  it("recebe um anexo do editor, resolve colisão e entrega preview binário sem root absoluto", async () => {
    const { baseUrl, token, workspaceId } = await fixture();
    const endpoint = `${baseUrl}/v1/workspaces/${workspaceId}/datafort`;
    const payload = JSON.stringify({
      contentBase64: Buffer.from("conteúdo", "utf8").toString("base64"),
      filename: "fonte.txt",
    });
    const first = await fetch(`${endpoint}/attachments`, {
      body: payload,
      headers: jsonHeaders(token),
      method: "POST",
    });
    expect(first.status).toBe(201);
    const firstBody = (await first.json()) as {
      attachment: { path: string; fileId: string; contentHash: string };
    };
    const second = await fetch(`${endpoint}/attachments`, {
      body: payload,
      headers: jsonHeaders(token),
      method: "POST",
    });
    const secondBody = (await second.json()) as { attachment: { path: string } };
    expect(second.status).toBe(201);
    expect(secondBody.attachment.path).toContain("fonte (1).txt");
    const content = await fetch(
      `${endpoint}/attachments/content?path=${encodeURIComponent(firstBody.attachment.path)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("text/plain");
    expect(await content.text()).toBe("conteúdo");
    expect(firstBody.attachment.fileId).not.toContain("/");
    expect(firstBody.attachment.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

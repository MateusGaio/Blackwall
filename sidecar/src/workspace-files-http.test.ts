// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createSidecar, SIDECAR_HOST } from "./index.js";
import { recordSessionArtifacts } from "./session-artifacts.js";

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
  const directory = await mkdtemp(join(tmpdir(), "blackwall-files-http-"));
  const root = join(directory, "workspace");
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await writeFile(join(root, "README.md"), "# Local workspace\n", "utf8");
  await writeFile(join(root, "src", "main.ts"), "export const ok = true;\n", "utf8");
  await writeFile(join(root, "manual.pdf"), Buffer.from("%PDF-1.7\n"));
  directories.push(directory);
  const token = "files-http-token";
  const { port, server } = await createSidecar(0, directory, { token });
  servers.push(server);
  const baseUrl = `http://${SIDECAR_HOST}:${port}`;
  const bootstrap = await fetch(`${baseUrl}/v1/bootstrap`, {
    body: JSON.stringify({
      locale: "pt-BR",
      profileName: "Files HTTP",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    }),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
  const state = (await bootstrap.json()) as {
    activeSessionId: string;
    activeWorkspaceId: string;
  };
  return { baseUrl, root, state, token };
}

function auth(token: string) {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

describe("endpoints do workbench de arquivos", () => {
  it("exige bearer, lista árvore segura, carrega texto/PDF e rejeita traversal", async () => {
    const { baseUrl, state, token } = await fixture();
    const treePath = `/v1/workspaces/${state.activeWorkspaceId}/files/tree`;
    await expect(fetch(`${baseUrl}${treePath}`)).resolves.toMatchObject({ status: 401 });

    const tree = await fetch(`${baseUrl}${treePath}?path=.`, { headers: auth(token) });
    const treeBody = (await tree.json()) as { entries: Array<{ path: string }> };
    expect(tree.status).toBe(200);
    expect(treeBody.entries.map((entry) => entry.path)).toEqual(["src", "manual.pdf", "README.md"]);
    expect(treeBody.entries.map((entry) => entry.path)).not.toContain(".git");

    const text = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/files/content?path=README.md`,
      { headers: auth(token) },
    );
    await expect(text.json()).resolves.toMatchObject({
      content: "# Local workspace\n",
      kind: "markdown",
    });

    const pdf = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/files/pdf?path=manual.pdf`,
      { headers: auth(token) },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("application/pdf");
    await expect(pdf.arrayBuffer()).resolves.toEqual(new TextEncoder().encode("%PDF-1.7\n").buffer);

    const traversal = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/files/content?path=${encodeURIComponent("../secret.txt")}`,
      { headers: auth(token) },
    );
    expect(traversal.status).toBe(403);
  });

  it("entrega anexo somente dentro do workspace e sem expor stored_path", async () => {
    const { baseUrl, state, token } = await fixture();
    const upload = await fetch(`${baseUrl}/v1/attachments`, {
      body: JSON.stringify({
        contentBase64: Buffer.from("Attachment preview").toString("base64"),
        filename: "context.txt",
        mimeType: "text/plain",
        sessionId: state.activeSessionId,
        workspaceId: state.activeWorkspaceId,
      }),
      headers: auth(token),
      method: "POST",
    });
    const uploadBody = (await upload.json()) as { attachment: { id: string } };
    expect(upload.status).toBe(201);

    const content = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/attachments/${uploadBody.attachment.id}/content`,
      { headers: auth(token) },
    );
    expect(content.status).toBe(200);
    expect(await content.text()).toBe("Attachment preview");

    const wrongScope = await fetch(
      `${baseUrl}/v1/workspaces/other/attachments/${uploadBody.attachment.id}/content`,
      { headers: auth(token) },
    );
    expect(wrongScope.status).toBe(404);
  });

  it("retorna os artefatos persistidos da sessão e rejeita sessão de outro escopo", async () => {
    const { baseUrl, state, token } = await fixture();
    const database = openDatabase(directories.at(-1));
    recordSessionArtifacts(database.client, {
      artifacts: [{ operation: "created", path: "src/main.ts" }],
      sessionId: state.activeSessionId,
      workspaceId: state.activeWorkspaceId,
    });
    database.close();
    const response = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/sessions/${state.activeSessionId}/artifacts`,
      { headers: auth(token) },
    );
    await expect(response.json()).resolves.toEqual({
      artifacts: [expect.objectContaining({ operation: "created", path: "src/main.ts" })],
    });
    const missingSession = await fetch(
      `${baseUrl}/v1/workspaces/${state.activeWorkspaceId}/sessions/other/artifacts`,
      { headers: auth(token) },
    );
    expect(missingSession.status).toBe(404);
  });
});

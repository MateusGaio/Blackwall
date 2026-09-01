// MIT License — Copyright (c) 2026 Mateus Gaio

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DatafortService } from "./datafort.js";
import {
  searchDatafortAttachmentsDetailed,
  syncDatafortAttachmentIndex,
} from "./datafort-attachments.js";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("índice dos anexos do Datafort", () => {
  it("indexa conteúdo e caminho após a cópia e remove o registro ao receber delete", async () => {
    const directory = await mkdtemp(join(tmpdir(), "blackwall-datafort-attachments-"));
    const root = join(directory, "workspace");
    await mkdir(root);
    directories.push(directory);
    const database = openDatabase(directory);
    const state = await createStore(database).bootstrap({
      locale: "pt-BR",
      profileName: "Datafort",
      profileSoul: "Profile",
      workspaceName: "Workspace",
      workspaceRootPath: root,
      workspaceSoul: "Workspace",
    });
    const workspaceId = state.activeWorkspaceId as string;
    const service = new DatafortService(database.client);
    const attachment = await service.attachFile(workspaceId, {
      contentBase64: Buffer.from("conteúdo indexável", "utf8").toString("base64"),
      filename: "segredo.txt",
    });
    await syncDatafortAttachmentIndex(database.client, {
      attachmentDirectory: "Blackwall Vault/Attachments",
      paths: [attachment.attachment.path],
      rootPath: root,
      workspaceId,
    });
    expect(
      searchDatafortAttachmentsDetailed(database.client, workspaceId, "indexável")[0],
    ).toMatchObject({
      filename: "segredo.txt",
      path: "Blackwall Vault/Attachments/segredo.txt",
    });
    await rm(join(root, attachment.attachment.path));
    const removed = await syncDatafortAttachmentIndex(database.client, {
      attachmentDirectory: "Blackwall Vault/Attachments",
      paths: [attachment.attachment.path],
      rootPath: root,
      workspaceId,
    });
    expect(removed.removedPaths).toContain(attachment.attachment.path);
    expect(searchDatafortAttachmentsDetailed(database.client, workspaceId, "indexável")).toEqual(
      [],
    );
    await expect(readFile(join(root, attachment.attachment.path))).rejects.toThrow();
    database.close();
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { openDatabase } from "../sidecar/dist/db/database.js";
import { createStore } from "../sidecar/dist/db/store.js";
import { saveProvider } from "../sidecar/dist/providers.js";

const dataDirectory = resolve(process.env.BLACKWALL_DATA_DIR ?? "");
const workspaceDirectory = resolve(process.env.BLACKWALL_HARNESS_WORKSPACE ?? "");
if (!process.env.BLACKWALL_DATA_DIR || !process.env.BLACKWALL_HARNESS_WORKSPACE) {
  throw new Error("BLACKWALL_DATA_DIR e BLACKWALL_HARNESS_WORKSPACE são obrigatórios.");
}

await mkdir(join(workspaceDirectory, "src"), { recursive: true });
await mkdir(join(workspaceDirectory, "tests"), { recursive: true });
await writeFile(join(workspaceDirectory, "README.md"), "# Desktop Harness\n\nVeja [[ARCHITECTURE]].\n");
await writeFile(join(workspaceDirectory, "ARCHITECTURE.md"), "# Architecture\n\nTauri local-first.\n");
await writeFile(join(workspaceDirectory, "src/index.ts"), "export const main = () => 'desktop';\n");
await writeFile(join(workspaceDirectory, "tests/index.test.ts"), "test('desktop', () => {});\n");
await writeFile(join(workspaceDirectory, "package.json"), '{"name":"desktop-harness"}\n');

const database = openDatabase(dataDirectory);
const store = createStore(database, dataDirectory);
await store.bootstrap({
  locale: "pt-BR",
  permissionMode: "ask",
  profileName: "Perfil Desktop E2E",
  profileSoul: "Use as ferramentas locais e siga os caminhos retornados.",
  workspaceMode: "workspace",
  workspaceName: "Workspace Desktop E2E",
  workspaceRootPath: workspaceDirectory,
  workspaceSoul: "",
});
await saveProvider(
  {
    apiKey: "desktop-e2e-key",
    baseUrl: "http://127.0.0.1:17999/v1",
    model: "mock-model",
    name: "Mock provider",
  },
  dataDirectory,
);
database.client.close();

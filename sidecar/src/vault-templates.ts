// MIT License — Copyright (c) 2026 Mateus Gaio

import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readdir, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type Database from "better-sqlite3";
import {
  contentHash,
  isBlackwallTemplate,
  parseMarkdownObject,
  serializePortentMarkdown,
} from "./vault-portent.js";

const DEFAULT_TEMPLATE_DIRECTORY = "Blackwall Vault/Templates";
const MAX_TEMPLATE_NAME_LENGTH = 160;
const MAX_TEMPLATE_TYPE_LENGTH = 64;
const MAX_TEMPLATE_BODY_LENGTH = 2_000_000;

type VaultTemplateSummary = {
  id: string;
  name: string;
  path: string;
  status: string;
  type: string;
};

type VaultTemplateApplyResult = {
  content: string;
  contentHash: string;
  note: {
    id: string;
    path: string;
    title: string;
    type: string;
  };
  templateId: string;
};

type WorkspaceRow = { permissionMode: string; rootPath: string };

class VaultTemplateError extends Error {
  constructor(
    readonly code:
      | "vault_template_workspace_not_found"
      | "vault_template_invalid_input"
      | "vault_template_not_found"
      | "vault_template_not_writable"
      | "vault_template_conflict"
      | "vault_template_path_unsafe",
    message: string,
  ) {
    super(message);
    this.name = "VaultTemplateError";
  }

  get status() {
    if (this.code === "vault_template_workspace_not_found") return 404;
    if (this.code === "vault_template_not_found") return 404;
    if (this.code === "vault_template_not_writable" || this.code === "vault_template_path_unsafe")
      return 403;
    if (this.code === "vault_template_conflict") return 409;
    return 400;
  }
}

function cleanText(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string")
    throw new VaultTemplateError("vault_template_invalid_input", `${field} é obrigatório.`);
  const cleaned = value.trim();
  if (!cleaned || cleaned.length > maxLength || hasControlCharacters(cleaned))
    throw new VaultTemplateError("vault_template_invalid_input", `${field} é inválido.`);
  return cleaned;
}

function hasControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f;
  });
}

function templateBody(value: unknown) {
  if (typeof value !== "string")
    throw new VaultTemplateError("vault_template_invalid_input", "body é obrigatório.");
  if (
    !value.trim() ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > MAX_TEMPLATE_BODY_LENGTH ||
    /^---\r?\n/u.test(value)
  )
    throw new VaultTemplateError(
      "vault_template_invalid_input",
      "O corpo do template deve conter somente o body Markdown, sem frontmatter adicional.",
    );
  return value;
}

function safeRelativeDirectory(value: unknown) {
  if (typeof value !== "string") return DEFAULT_TEMPLATE_DIRECTORY;
  const normalized = value.trim();
  if (
    !normalized ||
    isAbsolute(normalized) ||
    normalized.includes("\\") ||
    hasControlCharacters(normalized) ||
    normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new VaultTemplateError(
      "vault_template_path_unsafe",
      "A pasta de templates precisa ser relativa e segura.",
    );
  return normalized;
}

function safeSlug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^a-zA-Z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLocaleLowerCase()
      .slice(0, 80) || "template"
  );
}

function localDateTime(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  };
}

function isInside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export class VaultTemplateService {
  constructor(private readonly client: Database.Database) {}

  private workspace(workspaceId: string) {
    const row = this.client
      .prepare(
        "SELECT permission_mode AS permissionMode, root_path AS rootPath FROM workspaces WHERE id = ?",
      )
      .get(workspaceId) as WorkspaceRow | undefined;
    if (!row)
      throw new VaultTemplateError("vault_template_workspace_not_found", "O workspace não existe.");
    return row;
  }

  private settings(workspaceId: string) {
    return this.client
      .prepare(
        "SELECT template_directory AS templateDirectory, new_note_directory AS newNoteDirectory FROM datafort_settings WHERE workspace_id = ?",
      )
      .get(workspaceId) as { newNoteDirectory?: string; templateDirectory?: string } | undefined;
  }

  private async rootFor(workspaceId: string) {
    const workspace = this.workspace(workspaceId);
    const root = await realpath(resolve(workspace.rootPath)).catch(() => null);
    if (!root)
      throw new VaultTemplateError(
        "vault_template_workspace_not_found",
        "A pasta do workspace não está disponível.",
      );
    return { root, workspace };
  }

  private async directoryFor(workspaceId: string, create = false) {
    const { root } = await this.rootFor(workspaceId);
    const settings = this.settings(workspaceId);
    const directory = safeRelativeDirectory(
      settings?.templateDirectory ?? DEFAULT_TEMPLATE_DIRECTORY,
    );
    const target = resolve(root, directory);
    if (!isInside(root, target))
      throw new VaultTemplateError(
        "vault_template_path_unsafe",
        "A pasta de templates não é segura.",
      );
    if (create) await mkdir(target, { recursive: true, mode: 0o700 });
    const realDirectory = await realpath(target).catch(() => null);
    if (!realDirectory || !isInside(root, realDirectory))
      throw new VaultTemplateError(
        "vault_template_path_unsafe",
        "A pasta de templates não é segura.",
      );
    return { directory, root, target: realDirectory };
  }

  private async readTemplates(workspaceId: string) {
    const { directory, target } = await this.directoryFor(workspaceId, true);
    const entries = await readdir(target, { withFileTypes: true });
    const templates: Array<VaultTemplateSummary & { content: string }> = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isFile() || !/\.md$/iu.test(entry.name)) continue;
      const path = `${directory}/${entry.name}`;
      const content = await readFile(join(target, entry.name), "utf8").catch(() => null);
      if (!content) continue;
      const parsed = parseMarkdownObject(content, path);
      if (!isBlackwallTemplate(parsed.frontmatter)) continue;
      const id = typeof parsed.frontmatter.id === "string" ? parsed.frontmatter.id.trim() : "";
      const name =
        typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name.trim() : "";
      const type =
        typeof parsed.frontmatter.type === "string" ? parsed.frontmatter.type.trim() : "";
      const status =
        typeof parsed.frontmatter.status === "string" ? parsed.frontmatter.status.trim() : "";
      if (!id || !name || !type || !status) continue;
      templates.push({ content, id, name, path, status, type });
    }
    return templates;
  }

  async list(workspaceId: string): Promise<VaultTemplateSummary[]> {
    return (await this.readTemplates(workspaceId)).map(
      ({ content: _content, ...summary }) => summary,
    );
  }

  async create(workspaceId: string, input: Record<string, unknown>): Promise<VaultTemplateSummary> {
    const { workspace } = await this.rootFor(workspaceId);
    if (workspace.permissionMode === "read-only")
      throw new VaultTemplateError(
        "vault_template_not_writable",
        "O workspace está em modo somente leitura.",
      );
    const name = cleanText(input.name, "name", MAX_TEMPLATE_NAME_LENGTH);
    const type = cleanText(input.type, "type", MAX_TEMPLATE_TYPE_LENGTH);
    const status = cleanText(input.status ?? "active", "status", 32);
    const body = templateBody(input.body);
    const { directory, target } = await this.directoryFor(workspaceId, true);
    const id = `template_${randomUUID().replaceAll("-", "")}`;
    const path = `${directory}/${safeSlug(name)}--${id.slice(-8)}.md`;
    const content = serializePortentMarkdown(
      { id, name, status, template: "blackwall/v1", type },
      body,
    );
    const absolutePath = resolve(target, basename(path));
    if (!isInside(target, absolutePath))
      throw new VaultTemplateError(
        "vault_template_path_unsafe",
        "O caminho do template não é seguro.",
      );
    try {
      await writeExclusive(absolutePath, content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new VaultTemplateError(
          "vault_template_conflict",
          "Já existe um template nesse caminho.",
        );
      throw error;
    }
    return { id, name, path, status, type };
  }

  async apply(
    workspaceId: string,
    templateId: string,
    input: Record<string, unknown>,
  ): Promise<VaultTemplateApplyResult> {
    const { root, workspace } = await this.rootFor(workspaceId);
    if (workspace.permissionMode === "read-only")
      throw new VaultTemplateError(
        "vault_template_not_writable",
        "O workspace está em modo somente leitura.",
      );
    const title = cleanText(input.title, "title", 240);
    const template = (await this.readTemplates(workspaceId)).find((item) => item.id === templateId);
    if (!template)
      throw new VaultTemplateError("vault_template_not_found", "O template não existe.");
    const values = localDateTime();
    const body = template.content
      .replace(/\{\{title\}\}/gu, title)
      .replace(/\{\{date\}\}/gu, values.date)
      .replace(/\{\{time\}\}/gu, values.time);
    const parsed = parseMarkdownObject(body, template.path);
    const noteBody = parsed.body;
    const settings = this.settings(workspaceId);
    const noteDirectory = safeRelativeDirectory(
      settings?.newNoteDirectory ?? "Blackwall Vault/Notes",
    );
    const noteId = `note_${randomUUID().replaceAll("-", "")}`;
    const notePath = `${noteDirectory}/${safeSlug(title)}--${noteId.slice(-8)}.md`;
    const content = serializePortentMarkdown(
      {
        created_at: new Date().toISOString(),
        id: noteId,
        source: "blackwall",
        source_kind: "template",
        status: "captured",
        title,
        type: template.type,
        updated_at: new Date().toISOString(),
      },
      noteBody,
    );
    const noteDirectoryPath = resolve(root, noteDirectory);
    if (!isInside(root, noteDirectoryPath))
      throw new VaultTemplateError("vault_template_path_unsafe", "A pasta de notas não é segura.");
    await mkdir(noteDirectoryPath, { recursive: true, mode: 0o700 });
    const absolutePath = resolve(root, notePath);
    await writeExclusive(absolutePath, content).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new VaultTemplateError(
          "vault_template_conflict",
          "Já existe uma nota nesse caminho.",
        );
      throw error;
    });
    return {
      content,
      contentHash: contentHash(content),
      note: { id: noteId, path: notePath, title, type: template.type },
      templateId,
    };
  }
}

async function writeExclusive(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${createHash("sha256").update(`${path}\0${Date.now()}\0${Math.random()}`).digest("hex")}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

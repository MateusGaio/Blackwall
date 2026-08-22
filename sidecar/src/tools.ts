// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDirectory, openSharedDatabase } from "./db/database.js";
import { approvals, workspaces } from "./db/schema.js";

const maxReadBytes = 128_000;
const maxCommandOutput = 64_000;
const maxCommandCaptureChars = 1_000_000;
const commandTimeoutMs = 15_000;
const commandKillGraceMs = 2_000;
const ignoredDirectoryNames = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".tox",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor",
]);
const binaryExtensions = new Set([
  ".7z",
  ".a",
  ".bin",
  ".class",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".jpeg",
  ".jpg",
  ".lockb",
  ".o",
  ".pdf",
  ".png",
  ".so",
  ".tar",
  ".wasm",
  ".webp",
  ".zip",
]);

const commandEnvironmentKeys = [
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PATH",
  "TMPDIR",
  "TMP",
  "TEMP",
  "USER",
];

export type ToolName =
  | "apply_patch"
  | "create_or_update_file"
  | "execute_command"
  | "list_directory"
  | "read_file"
  | "search_text";

export type ToolInput = {
  args: Record<string, unknown>;
  requestId?: string;
  sessionId?: string | null;
  tool: ToolName;
  workspaceId: string;
};

export type ApprovalDecision = "allow_once" | "allow_session" | "deny";

export type ApprovalRequest = {
  id: string;
  requestId: string;
  sessionId: string | null;
  tool: ToolName;
  workspaceId: string;
};

type ToolExecutionOptions = {
  onApproval?: (approval: ApprovalRequest) => void;
};

type Workspace = typeof workspaces.$inferSelect;
type PendingApproval = {
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
};

const pendingApprovals = new Map<string, PendingApproval>();
const sessionApprovals = new Set<string>();

function clipped(value: string) {
  return value.length > maxCommandOutput
    ? `${value.slice(0, maxCommandOutput)}\n[saída truncada]`
    : value;
}

function isInside(root: string, candidate: string) {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function workspaceFor(workspaceId: string, storageDirectory: string): Promise<Workspace> {
  const database = openSharedDatabase(storageDirectory);
  try {
    const workspace = database.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    if (!workspace) throw new Error("O workspace selecionado não existe.");
    return workspace;
  } finally {
    database.close();
  }
}

async function workspaceRoot(workspace: Workspace) {
  const root = await realpath(workspace.rootPath).catch(() => null);
  if (!root) throw new Error("A pasta do workspace não está disponível.");
  return root;
}

async function safePath(root: string, requested: string, allowMissing = false) {
  if (!requested.trim()) throw new Error("Informe um caminho dentro do workspace.");
  const candidate = resolve(root, requested);
  if (!isInside(root, candidate)) throw new Error("O caminho está fora da pasta do workspace.");
  const existing = await realpath(candidate).catch(() => null);
  if (existing) {
    if (!isInside(root, existing))
      throw new Error("Links simbólicos fora do workspace são bloqueados.");
    return existing;
  }
  if (!allowMissing) throw new Error("O caminho solicitado não existe.");
  const parent = await realpath(dirname(candidate)).catch(() => null);
  if (!parent || !isInside(root, parent)) {
    throw new Error("A pasta de destino precisa existir dentro do workspace.");
  }
  return candidate;
}

function isDestructive(tool: ToolName) {
  return tool === "apply_patch" || tool === "create_or_update_file" || tool === "execute_command";
}

async function requestApproval(
  input: ToolInput,
  storageDirectory: string,
  approval: ApprovalRequest,
): Promise<ApprovalDecision> {
  const requestId = approval.requestId;
  const database = openSharedDatabase(storageDirectory);
  database.db
    .insert(approvals)
    .values({
      createdAt: Date.now(),
      id: approval.id,
      payload: JSON.stringify(input.args),
      requestId,
      scope: "once",
      sessionId: input.sessionId ?? null,
      status: "pending",
      tool: input.tool,
      workspaceId: input.workspaceId,
    })
    .run();
  database.close();

  return new Promise((resolveDecision) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(requestId);
      resolveDecision("deny");
    }, 5 * 60_000);
    pendingApprovals.set(requestId, { resolve: resolveDecision, timer });
  });
}

export async function resolveApproval(
  requestId: string,
  decision: ApprovalDecision,
  storageDirectory = dataDirectory(),
) {
  if (decision !== "allow_once" && decision !== "allow_session" && decision !== "deny") {
    throw new Error("Decisão de autorização inválida.");
  }
  const database = openSharedDatabase(storageDirectory);
  const approval = database.db
    .select()
    .from(approvals)
    .where(and(eq(approvals.requestId, requestId), eq(approvals.status, "pending")))
    .get();
  if (!approval) {
    database.close();
    throw new Error("O pedido de autorização não está pendente.");
  }
  database.db
    .update(approvals)
    .set({
      resolvedAt: Date.now(),
      scope: decision === "allow_session" ? "session" : "once",
      status: decision === "deny" ? "denied" : "allowed",
    })
    .where(eq(approvals.id, approval.id))
    .run();
  database.close();
  if (decision === "allow_session" && !isDestructive(approval.tool as ToolName)) {
    sessionApprovals.add(`${approval.workspaceId}:${approval.sessionId ?? ""}:${approval.tool}`);
  }
  const pending = pendingApprovals.get(requestId);
  if (pending) {
    clearTimeout(pending.timer);
    pendingApprovals.delete(requestId);
    pending.resolve(decision);
  }
  return { requestId, decision };
}

/**
 * Closing a browser window or switching away from a chat must not leave an
 * approval promise alive. Pending requests are explicitly denied and marked
 * as such in SQLite so a later reconnect cannot resume an old action.
 */
export function cancelPendingApprovals(requestId: string, storageDirectory = dataDirectory()) {
  const database = openSharedDatabase(storageDirectory);
  database.client
    .prepare(
      "UPDATE approvals SET resolved_at = ?, status = 'denied' WHERE status = 'pending' AND (request_id = ? OR request_id LIKE ?)",
    )
    .run(Date.now(), requestId, `${requestId}:%`);
  database.close();

  for (const [pendingRequestId, pending] of pendingApprovals) {
    if (pendingRequestId !== requestId && !pendingRequestId.startsWith(`${requestId}:`)) continue;
    clearTimeout(pending.timer);
    pendingApprovals.delete(pendingRequestId);
    pending.resolve("deny");
  }
}

export async function executeTool(
  input: ToolInput,
  storageDirectory = dataDirectory(),
  options: ToolExecutionOptions = {},
) {
  const workspace = await workspaceFor(input.workspaceId, storageDirectory);
  if (workspace.permissionMode === "read-only" && isDestructive(input.tool)) {
    throw new Error("O workspace está em modo somente leitura; esta ação foi bloqueada.");
  }
  const key = `${workspace.id}:${input.sessionId ?? ""}:${input.tool}`;
  const requiresApproval =
    workspace.permissionMode === "ask" ||
    (workspace.permissionMode === "automatic" && isDestructive(input.tool));
  if (requiresApproval && !sessionApprovals.has(key)) {
    const requestId = input.requestId ?? randomUUID();
    const approval: ApprovalRequest = {
      id: randomUUID(),
      requestId,
      sessionId: input.sessionId ?? null,
      tool: input.tool,
      workspaceId: input.workspaceId,
    };
    options.onApproval?.(approval);
    const decisionPromise = requestApproval({ ...input, requestId }, storageDirectory, approval);
    const decision = await decisionPromise;
    if (decision === "deny") throw new Error("A ação foi negada pelo usuário.");
  }

  const root = await workspaceRoot(workspace);
  switch (input.tool) {
    case "list_directory": {
      const path = await safePath(root, String(input.args.path || "."));
      const entries = await readdir(path, { withFileTypes: true });
      return {
        path: relative(root, path) || ".",
        entries: await Promise.all(
          entries
            .filter(
              (entry) =>
                !entry.isSymbolicLink() &&
                !(entry.isDirectory() && ignoredDirectoryNames.has(entry.name)),
            )
            .map(async (entry) => {
              const child = join(path, entry.name);
              const info = await stat(child).catch(() => null);
              return {
                name: entry.name,
                path: relative(root, child).split("\\").join("/"),
                size: entry.isFile() ? (info?.size ?? 0) : null,
                type: entry.isDirectory() ? "directory" : "file",
              };
            }),
        ),
      };
    }
    case "read_file": {
      const path = await safePath(root, String(input.args.path ?? ""));
      const info = await stat(path);
      if (!info.isFile()) throw new Error("O caminho solicitado não é um arquivo.");
      const handle = await import("node:fs/promises").then(({ open }) => open(path, "r"));
      try {
        const length = Math.min(info.size, maxReadBytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, 0);
        if (buffer.includes(0))
          throw new Error("O arquivo parece ser binário e não pode ser lido.");
        return {
          bytesRead: length,
          content: buffer.toString("utf8"),
          end: length,
          path: relative(root, path).split("\\").join("/"),
          size: info.size,
          start: 0,
          truncated: info.size > length,
        };
      } finally {
        await handle.close();
      }
    }
    case "search_text": {
      const query = String(input.args.query ?? "");
      if (!query.trim()) throw new Error("Informe o texto a pesquisar.");
      const start = await safePath(root, String(input.args.path || "."));
      const matches: Array<{ line: number; path: string; text: string }> = [];
      async function walk(directory: string) {
        if (matches.length >= 100) return;
        const entries = await readdir(directory, { withFileTypes: true });
        for (const entry of entries) {
          if (
            matches.length >= 100 ||
            entry.isSymbolicLink() ||
            (entry.isDirectory() && ignoredDirectoryNames.has(entry.name))
          )
            continue;
          const child = join(directory, entry.name);
          if (entry.isDirectory()) await walk(child);
          else if (entry.isFile()) {
            const extension = entry.name.includes(".")
              ? `.${entry.name.split(".").at(-1)?.toLocaleLowerCase()}`
              : "";
            // Race: o arquivo pode sumir entre readdir e stat — trata como
            // skip (tamanho infinito) em vez de abortar a busca inteira.
            const size = await stat(child)
              .then((info) => info.size)
              .catch(() => Number.POSITIVE_INFINITY);
            if (binaryExtensions.has(extension) || size > maxReadBytes) continue;
            const content = await readFile(child, "utf8").catch(() => "");
            content.split("\n").forEach((line, index) => {
              if (
                line.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
                matches.length < 100
              ) {
                matches.push({ line: index + 1, path: relative(root, child), text: line });
              }
            });
          }
        }
      }
      await walk(start);
      return { matches };
    }
    case "create_or_update_file": {
      const path = await safePath(root, String(input.args.path ?? ""), true);
      const content = String(input.args.content ?? "");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
      return { path: relative(root, path), bytes: Buffer.byteLength(content) };
    }
    case "apply_patch": {
      const path = await safePath(root, String(input.args.path ?? ""));
      const current = await readFile(path, "utf8");
      const oldText = String(input.args.oldText ?? "");
      const newText = String(input.args.newText ?? "");
      if (!oldText || current.indexOf(oldText) === -1)
        throw new Error("O trecho original não foi encontrado.");
      if (current.indexOf(oldText) !== current.lastIndexOf(oldText))
        throw new Error("O trecho original aparece mais de uma vez.");
      await writeFile(path, current.replace(oldText, newText), "utf8");
      return { path: relative(root, path) };
    }
    case "execute_command": {
      const command = String(input.args.command ?? "").trim();
      const args = Array.isArray(input.args.args) ? input.args.args.map(String) : [];
      if (!command) throw new Error("Informe um comando estruturado.");
      const cwd = await safePath(root, String(input.args.cwd ?? "."));
      const { spawn } = await import("node:child_process");
      const env = Object.fromEntries(
        commandEnvironmentKeys.flatMap((key) =>
          process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
        ),
      );
      return new Promise<{ code: number | null; stderr: string; stdout: string }>(
        (resolveCommand, reject) => {
          const child = spawn(command, args, { cwd, env, shell: false });
          let stdout = "";
          let stderr = "";
          let killTimer: NodeJS.Timeout | undefined;
          const timer = setTimeout(() => {
            child.kill("SIGTERM");
            // Processo que ignora SIGTERM não emite close — sem o SIGKILL de
            // escalão a promessa (e o turno inteiro) fica pendurada para sempre.
            killTimer = setTimeout(() => child.kill("SIGKILL"), commandKillGraceMs);
            reject(new Error("O comando excedeu o limite de 15 segundos."));
          }, commandTimeoutMs);
          child.stdout.on("data", (chunk: Buffer) => {
            if (stdout.length < maxCommandCaptureChars) stdout += chunk.toString();
          });
          child.stderr.on("data", (chunk: Buffer) => {
            if (stderr.length < maxCommandCaptureChars) stderr += chunk.toString();
          });
          child.on("error", (error) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            reject(error);
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            resolveCommand({ code, stderr: clipped(stderr), stdout: clipped(stdout) });
          });
        },
      );
    }
  }
}

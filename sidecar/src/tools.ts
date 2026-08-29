// MIT License — Copyright (c) 2026 Mateus Gaio
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { and, eq } from "drizzle-orm";
import { dataDirectory, openSharedDatabase } from "./db/database.js";
import { approvals, workspaces } from "./db/schema.js";
import {
  type LegacyCommandSpec,
  legacyCommandSpec,
  normalizeCommandArgs,
  normalizeToolArguments,
} from "./tool-contract.js";
import {
  classifyTool,
  evaluateToolPolicy,
  type PermissionMode,
  type PolicyDecision,
} from "./tool-policy.js";
import { createVaultNote } from "./vault-capture.js";

const maxReadBytes = 128_000;
const maxCommandOutput = 64_000;
const maxCommandCaptureBytes = 1_048_576;
const defaultCommandTimeoutMs = 120_000;
const maxCommandTimeoutMs = 600_000;
const commandKillGraceMs = 3_000;
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
  | "bash"
  | "create_or_update_file"
  | "create_vault_note"
  | "execute_command"
  | "list_directory"
  | "read_file"
  | "search_text";

type ToolInput = {
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
  /** Evento para o cliente remover o ApprovalCard mesmo sem ação do botão. */
  onApprovalResolved?: (event: { requestId: string; status: string }) => void;
  signal?: AbortSignal;
};

/** Negação de POLÍTICA (não de execução): carrega código estável + mensagem. */
export class ToolPolicyDenied extends Error {
  readonly code: string;

  constructor(code: string, userMessage: string) {
    super(userMessage);
    this.name = "ToolPolicyDenied";
    this.code = code;
  }
}

type Workspace = typeof workspaces.$inferSelect;
type PendingApproval = {
  resolve: (decision: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
  workspaceId: string;
};

const pendingApprovals = new Map<string, PendingApproval>();
const sessionApprovals = new Set<string>();
/** Motivo de política quando a negação veio de transição de modo (#209). */
const policyDeniedMessages = new Map<string, string>();

/* ------------------------------------------------------------------ */
/* Coordenação policyEpoch + gate por workspace (P0 da auditoria)      */
/* ------------------------------------------------------------------ */

type WorkspaceGate = {
  epoch: number;
  /** Mutex por promessa: serializa mudança de modo × início de efeito. */
  tail: Promise<void>;
};

const workspaceGates = new Map<string, WorkspaceGate>();

function gateFor(workspaceId: string): WorkspaceGate {
  let gate = workspaceGates.get(workspaceId);
  if (!gate) {
    gate = { epoch: 0, tail: Promise.resolve() };
    workspaceGates.set(workspaceId, gate);
  }
  return gate;
}

/** Executa `critical` com exclusão mútua por workspace. */
async function withWorkspaceGate<T>(
  workspaceId: string,
  critical: (gate: WorkspaceGate) => Promise<T>,
): Promise<T> {
  const gate = gateFor(workspaceId);
  const previous = gate.tail;
  let release!: () => void;
  gate.tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => undefined);
  try {
    return await critical(gate);
  } finally {
    release();
  }
}

/**
 * Hook de teste para barreira determinística EXATAMENTE antes do commit
 * point (após validações, antes do efeito). Nulo em produção.
 */
let commitBarrierHook: ((workspaceId: string) => Promise<void>) | null = null;

export function setCommitBarrierForTests(hook: ((workspaceId: string) => Promise<void>) | null) {
  commitBarrierHook = hook;
}

/**
 * Mudança de modo serializada: incrementa o epoch DENTRO do gate — uma
 * operação em fase crítica termina antes; qualquer decisão tomada fora da
 * própria seção crítica enxerga o epoch novo e aborta por mismatch.
 */
export function setWorkspacePermissionModeGuarded(
  workspaceId: string,
  mode: PermissionMode,
  storageDirectory = dataDirectory(),
) {
  return withWorkspaceGate(workspaceId, async (gate) => {
    const database = openSharedDatabase(storageDirectory);
    try {
      const updated = database.db
        .update(workspaces)
        .set({ permissionMode: mode })
        .where(eq(workspaces.id, workspaceId))
        .returning()
        .get();
      if (!updated) throw new Error("O workspace selecionado não existe.");
      // Grants da sessão morrem com a política que os emitiu.
      revokeSessionGrants({ workspaceId });
      gate.epoch += 1;
      return updated;
    } finally {
      database.close();
    }
  });
}

function revokeSessionGrants(filter: { workspaceId?: string; sessionId?: string }) {
  for (const key of [...sessionApprovals]) {
    const [workspaceId, sessionId] = key.split(":");
    if (filter.workspaceId && filter.workspaceId !== workspaceId) continue;
    if (filter.sessionId && filter.sessionId !== (sessionId ?? "")) continue;
    sessionApprovals.delete(key);
  }
}

export function revokeGrants(filter: { workspaceId?: string; sessionId?: string }) {
  revokeSessionGrants(filter);
}

/**
 * Na inicialização, toda approval persistida como `pending` pertence a um
 * processo anterior: vira terminal `cancelled` com resolvedAt — nunca
 * retoma efeito antigo nem ressuscita card (#209).
 */
export function terminateStaleApprovals(storageDirectory = dataDirectory()) {
  const database = openSharedDatabase(storageDirectory);
  try {
    database.client
      .prepare(
        "UPDATE approvals SET status = 'cancelled', resolved_at = ? WHERE status = 'pending'",
      )
      .run(Date.now());
  } finally {
    database.close();
  }
}

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
    pendingApprovals.set(requestId, {
      resolve: resolveDecision,
      timer,
      workspaceId: input.workspaceId,
    });
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
  const status = decision === "deny" ? "denied" : "allowed";
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
      status,
    })
    .where(eq(approvals.id, approval.id))
    .run();
  database.close();
  // Grant de sessão limitado a leitura (capacidade explicitada): nunca
  // cobre mutação/comando e jamais supera um deny reavaliado depois.
  if (decision === "allow_session" && classifyTool(approval.tool) === "read") {
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
 * Reavalia TODAS as aprovações pendentes do workspace após troca de modo:
 * allow → executa uma vez; caso contrário → nega com motivo. Cada card é
 * resolvido EXATAMENTE uma vez e o status terminal persiste.
 */
export function notifyWorkspacePolicyChanged(
  changedWorkspaceId: string,
  storageDirectory = dataDirectory(),
  options: { onApprovalResolved?: (event: { requestId: string; status: string }) => void } = {},
) {
  const mode = workspaceModeOf(changedWorkspaceId, storageDirectory);
  if (!mode) return;
  for (const [pendingRequestId, pending] of [...pendingApprovals]) {
    if (pending.workspaceId !== changedWorkspaceId) continue;
    const toolClass = classifyTool(
      (databaseToolOf(pendingRequestId, storageDirectory) ?? "execute_command") as ToolName,
    );
    const decision = evaluateToolPolicy(mode, toolClass);
    const next: ApprovalDecision = decision.kind === "allow" ? "allow_once" : "deny";
    if (next === "deny" && decision.kind === "deny") {
      policyDeniedMessages.set(pendingRequestId, decision.userMessage);
    }
    void resolveApproval(pendingRequestId, next, storageDirectory)
      .then((result) => {
        const event = {
          requestId: result.requestId,
          status: result.decision === "deny" ? "denied" : "allowed",
        };
        policyChangeListeners.forEach((listener) => {
          listener(event);
        });
        options?.onApprovalResolved?.(event);
      })
      .catch(() => undefined);
  }
}

const policyChangeListeners = new Set<(event: { requestId: string; status: string }) => void>();

function workspaceModeOf(workspaceId: string, storageDirectory: string): PermissionMode | null {
  const database = openSharedDatabase(storageDirectory);
  try {
    const row = database.db
      .select({ permissionMode: workspaces.permissionMode })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    return row?.permissionMode as PermissionMode | null;
  } finally {
    database.close();
  }
}

function databaseToolOf(requestId: string, storageDirectory: string): string | null {
  const database = openSharedDatabase(storageDirectory);
  try {
    const row = database.db
      .select({ tool: approvals.tool })
      .from(approvals)
      .where(and(eq(approvals.requestId, requestId), eq(approvals.status, "pending")))
      .get();
    return row?.tool ?? null;
  } finally {
    database.close();
  }
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

  for (const [pendingRequestId, pending] of pendingApprovals) {
    if (pendingRequestId !== requestId && !pendingRequestId.startsWith(`${requestId}:`)) continue;
    clearTimeout(pending.timer);
    pendingApprovals.delete(pendingRequestId);
    pending.resolve("deny");
  }
  database.close();
}

/**
 * Escrita com mitigação de path race (P1): o parent é revalidado por
 * realpath IMEDIATAMENTE antes do commit e a gravação usa temporário no
 * mesmo diretório validado + rename. Limite documentado em SECURITY.md:
 * processos EXTERNOS ao sidecar continuam fora do modelo de ameaças.
 */
async function atomicWriteWithin(
  root: string,
  requested: string,
  content: string,
): Promise<string> {
  const { rename, rm } = await import("node:fs/promises");
  let candidate = await safePath(root, requested, true);
  await mkdir(dirname(candidate), { recursive: true });
  const parentReal = await realpath(dirname(candidate)).catch(() => null);
  if (!parentReal || !isInside(root, parentReal)) {
    throw new ToolPolicyDenied(
      "PATH_OUTSIDE_WORKSPACE",
      "A pasta de destino deixou de estar dentro do workspace; escrita cancelada.",
    );
  }
  const temp = join(parentReal, `.bw-tmp-${randomUUID()}`);
  await writeFile(temp, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    await rename(temp, candidate);
  } catch {
    // Windows não permite rename sobre existente: substitui controlado.
    await rm(candidate, { force: true });
    candidate = await safePath(root, requested, true);
    await rename(temp, candidate);
  }
  return candidate;
}

export async function executeTool(
  input: ToolInput,
  storageDirectory = dataDirectory(),
  options: ToolExecutionOptions = {},
) {
  const legacySpec: LegacyCommandSpec | undefined =
    input.tool === "execute_command"
      ? {
          args: normalizeCommandArgs(input.args.args),
          command: String(input.args.command ?? "").trim(),
        }
      : ((input.args as Record<PropertyKey, unknown>)[legacyCommandSpec] as
          | LegacyCommandSpec
          | undefined);
  const canonicalTool = input.tool === "execute_command" ? "bash" : input.tool;
  const executionArgs =
    input.tool === "execute_command"
      ? normalizeToolArguments("execute_command", input.args)
      : input.args;
  const canonicalInput = { ...input, args: executionArgs, tool: canonicalTool } as ToolInput;
  // Commit point da política (Issue #209): o modo é RELIDO imediatamente
  // antes do efeito — nem o modo em cache, nem o modo de cinco minutos atrás.
  const toolClass = classifyTool(canonicalTool);
  const workspace = await workspaceFor(input.workspaceId, storageDirectory);
  let decision: PolicyDecision = evaluateToolPolicy(
    workspace.permissionMode as PermissionMode,
    toolClass,
  );
  if (decision.kind === "deny") {
    throw new ToolPolicyDenied(decision.reasonCode, decision.userMessage);
  }

  if (decision.kind === "prompt") {
    const key = `${workspace.id}:${input.sessionId ?? ""}:${canonicalTool}`;
    if (!sessionApprovals.has(key)) {
      const requestId = input.requestId ?? randomUUID();
      const approval: ApprovalRequest = {
        id: randomUUID(),
        requestId,
        sessionId: input.sessionId ?? null,
        tool: canonicalTool,
        workspaceId: input.workspaceId,
      };
      options.onApproval?.(approval);
      const decided = await requestApproval(
        { ...canonicalInput, requestId },
        storageDirectory,
        approval,
      );
      if (decided === "deny") {
        const policyMessage = policyDeniedMessages.get(requestId);
        policyDeniedMessages.delete(requestId);
        throw policyMessage
          ? new ToolPolicyDenied("POLICY_CHANGED_DURING_APPROVAL", policyMessage)
          : new ToolPolicyDenied("APPROVAL_DENIED", "A ação foi negada pelo usuário.");
      }
      // Reavaliação pós-espera (fecha a janela TOCTOU): se o modo mudou
      // enquanto o card estava aberto, a política ATUAL decide o efeito.
      const fresh = await workspaceFor(input.workspaceId, storageDirectory);
      decision = evaluateToolPolicy(fresh.permissionMode as PermissionMode, toolClass);
      if (decision.kind === "deny") {
        throw new ToolPolicyDenied(decision.reasonCode, decision.userMessage);
      }
    }
  }

  const runEffect = async (root: string): Promise<unknown> => {
    switch (canonicalTool) {
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
        const written = await atomicWriteWithin(
          root,
          String(input.args.path ?? ""),
          String(input.args.content ?? ""),
        );
        return {
          path: relative(root, written),
          bytes: Buffer.byteLength(String(input.args.content ?? "")),
        };
      }
      case "create_vault_note": {
        const database = openSharedDatabase(storageDirectory);
        try {
          return await createVaultNote({
            belongsTo: input.args.belongsTo === null ? null : String(input.args.belongsTo ?? ""),
            body: String(input.args.body ?? ""),
            client: database.client,
            relatedTo: Array.isArray(input.args.relatedTo) ? input.args.relatedTo.map(String) : [],
            title: String(input.args.title ?? ""),
            type: input.args.type as "Project" | "Event" | "Note" | "Topic",
            workspaceId: input.workspaceId,
            workspaceRoot: root,
          });
        } finally {
          database.close();
        }
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
        await atomicWriteWithin(
          root,
          String(input.args.path ?? ""),
          current.replace(oldText, newText),
        );
        return { path: relative(root, path) };
      }
      case "bash": {
        const command = String(executionArgs.command ?? "").trim();
        if (!command) throw new Error("Informe um comando estruturado.");
        const cwd = await safePath(root, String(executionArgs.workdir ?? executionArgs.cwd ?? "."));
        const { spawn } = await import("node:child_process");
        const env = Object.fromEntries(
          commandEnvironmentKeys.flatMap((key) =>
            process.env[key] === undefined ? [] : [[key, process.env[key] as string]],
          ),
        );
        const requestedTimeout = Number(executionArgs.timeout ?? defaultCommandTimeoutMs);
        const timeoutMs = Math.min(
          maxCommandTimeoutMs,
          Math.max(
            defaultCommandTimeoutMs,
            Number.isFinite(requestedTimeout) ? requestedTimeout : defaultCommandTimeoutMs,
          ),
        );
        const shell =
          process.platform === "win32"
            ? process.env.COMSPEC || "cmd.exe"
            : process.env.SHELL || "/bin/sh";
        return new Promise<{
          code: number | null;
          exitCode: number | null;
          stderr: string;
          stdout: string;
          output: string;
          ok: boolean;
          timedOut: boolean;
          truncated: boolean;
          durationMs: number;
          outputBytes: number;
        }>((resolveCommand, reject) => {
          const startedAt = Date.now();
          // Comandos legados com argumentos usam spawn estruturado, evitando
          // que quoting dependente do shell quebre no Windows. Sem argumentos,
          // mantemos o shell para que comandos inexistentes retornem um
          // resultado com código de saída, em vez de rejeitar com ENOENT.
          const child =
            legacySpec && legacySpec.args.length > 0
              ? spawn(legacySpec.command, legacySpec.args, {
                  cwd,
                  env,
                  detached: process.platform !== "win32",
                  stdio: ["ignore", "pipe", "pipe"],
                })
              : spawn(command, {
                  cwd,
                  env,
                  shell,
                  detached: process.platform !== "win32",
                  stdio: ["ignore", "pipe", "pipe"],
                });
          let stdout = "";
          let stderr = "";
          let output = "";
          let outputBytes = 0;
          let truncated = false;
          let timedOut = false;
          let settled = false;
          let killTimer: NodeJS.Timeout | undefined;
          const killTree = (signal: "SIGTERM" | "SIGKILL") => {
            if (process.platform !== "win32" && child.pid) {
              try {
                process.kill(-child.pid, signal);
                return;
              } catch {
                // Fall through to the direct child when the group already exited.
              }
            }
            child.kill(signal);
          };
          const timer = setTimeout(() => {
            timedOut = true;
            killTree("SIGTERM");
            killTimer = setTimeout(() => killTree("SIGKILL"), commandKillGraceMs);
          }, timeoutMs);
          const append = (kind: "stdout" | "stderr", chunk: Buffer) => {
            const text = chunk.toString();
            const bytes = Buffer.byteLength(text);
            outputBytes += bytes;
            if (Buffer.byteLength(output) < maxCommandCaptureBytes) {
              const remaining = maxCommandCaptureBytes - Buffer.byteLength(output);
              const part = Buffer.from(text).subarray(0, remaining).toString();
              output += part;
              if (part.length < text.length) truncated = true;
            } else truncated = true;
            if (kind === "stdout") {
              const remaining = maxCommandCaptureBytes - Buffer.byteLength(stdout);
              const part = Buffer.from(text).subarray(0, Math.max(0, remaining)).toString();
              stdout += part;
              if (part.length < text.length) truncated = true;
            } else {
              const remaining = maxCommandCaptureBytes - Buffer.byteLength(stderr);
              const part = Buffer.from(text).subarray(0, Math.max(0, remaining)).toString();
              stderr += part;
              if (part.length < text.length) truncated = true;
            }
          };
          child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
          child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
          const abort = () => {
            if (settled) return;
            killTree("SIGTERM");
            killTimer = setTimeout(() => killTree("SIGKILL"), commandKillGraceMs);
          };
          if (options.signal?.aborted) abort();
          else options.signal?.addEventListener("abort", abort, { once: true });
          child.on("error", (error) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            options.signal?.removeEventListener("abort", abort);
            const wrapped = new Error(
              `O comando não pôde ser iniciado: ${error instanceof Error ? error.message : String(error)}`,
            );
            (wrapped as Error & { code?: string }).code = "COMMAND_SPAWN_FAILED";
            if (!settled) {
              settled = true;
              reject(wrapped);
            }
          });
          child.on("close", (code) => {
            clearTimeout(timer);
            if (killTimer) clearTimeout(killTimer);
            options.signal?.removeEventListener("abort", abort);
            if (settled) return;
            settled = true;
            const exitCode = code ?? (options.signal?.aborted || timedOut ? null : 1);
            resolveCommand({
              code: exitCode,
              exitCode,
              ok: exitCode === 0 && !timedOut && !options.signal?.aborted,
              output: truncated ? `${output}\n[output truncated]` : output,
              outputBytes,
              stderr: clipped(stderr),
              stdout: clipped(stdout),
              timedOut,
              truncated,
              durationMs: Date.now() - startedAt,
            });
          });
        });
      }
    }
  };

  if (toolClass === "read") {
    // Leitura pura não precisa do gate (permitida em todos os modos).
    const root = await workspaceRoot(workspace);
    return runEffect(root);
  }

  /*
   * Seção crítica de mutação/comando (P0): epoch capturado FORA do gate;
   * dentro dele, modo/epoch são revalidados e só então o commit point é
   * marcado (barreira de teste) e o efeito inicia. Uma troca de modo
   * concorrente fica na fila do gate e passa a valer para as PRÓXIMAS
   * operações — nunca intercala entre decisão e efeito.
   */
  const snapshotEpoch = gateFor(input.workspaceId).epoch;
  return withWorkspaceGate(input.workspaceId, async (gate) => {
    const fresh = await workspaceFor(input.workspaceId, storageDirectory);
    const committed = evaluateToolPolicy(fresh.permissionMode as PermissionMode, toolClass);
    if (gate.epoch !== snapshotEpoch) {
      throw new ToolPolicyDenied(
        "POLICY_EPOCH_CHANGED",
        "O modo de permissão mudou durante a operação; a ação foi cancelada antes do efeito.",
      );
    }
    if (committed.kind === "deny") {
      throw new ToolPolicyDenied(committed.reasonCode, committed.userMessage);
    }
    if (commitBarrierHook) await commitBarrierHook(input.workspaceId);
    const root = await workspaceRoot(fresh);
    return runEffect(root);
  });
}

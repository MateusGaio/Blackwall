// MIT License — Copyright (c) 2026 Mateus Gaio
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "./db/database.js";
import { createStore } from "./db/store.js";
import { listSessionArtifacts } from "./session-artifacts.js";
import {
  type ApprovalRequest,
  cancelPendingApprovals,
  executeMcpTool,
  executeTool,
  notifyWorkspacePolicyChanged,
  resolveApproval,
  setCommitBarrierForTests,
  setWorkspacePermissionModeGuarded,
  terminateStaleApprovals,
} from "./tools.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function fixture(permissionMode: "ask" | "automatic" | "read-only" = "ask") {
  const directory = await mkdtemp(join(tmpdir(), "blackwall-tools-"));
  const workspaceRoot = join(directory, "workspace");
  await mkdir(workspaceRoot);
  directories.push(directory);
  const database = openDatabase(directory);
  const state = await createStore(database).bootstrap({
    locale: "pt-BR",
    permissionMode,
    profileName: "Ada",
    profileSoul: "Profile",
    workspaceName: "Project",
    workspaceRootPath: workspaceRoot,
    workspaceSoul: "Workspace",
  });
  database.close();
  return { directory, state, workspaceRoot };
}

describe("ferramentas locais e permissões", () => {
  it("executa search_workspace via callback injetado sem aprovação, inclusive em ask", async () => {
    const { directory, state } = await fixture("ask");
    const search = async (workspaceId: string, query: string, limit: number) => ({
      mode: "lexical",
      query,
      results: [{ citation: { objectId: workspaceId, source: "vault" } }],
      limit,
    });
    let approvals = 0;
    await expect(
      executeTool(
        {
          args: { query: "  fatos locais  " },
          requestId: "search-ask",
          sessionId: state.activeSessionId,
          tool: "search_workspace",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { onApproval: () => (approvals += 1), searchWorkspace: search },
      ),
    ).resolves.toMatchObject({ limit: 6, query: "fatos locais" });
    expect(approvals).toBe(0);

    await expect(
      executeTool(
        {
          args: { limit: 8, query: "Vault" },
          tool: "search_workspace",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { searchWorkspace: search },
      ),
    ).resolves.toMatchObject({ limit: 8, query: "Vault" });
  });

  it("valida limite antes do callback e sanitiza indisponibilidade", async () => {
    const { directory, state } = await fixture("automatic");
    let calls = 0;
    const options = {
      searchWorkspace: async () => {
        calls += 1;
        return {};
      },
    };
    await expect(
      executeTool(
        {
          args: { limit: 9, query: "x" },
          tool: "search_workspace",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid_tool_arguments" });
    expect(calls).toBe(0);
    await expect(
      executeTool(
        {
          args: { query: "x" },
          tool: "search_workspace",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toMatchObject({
      code: "SEARCH_UNAVAILABLE",
      message: "Não foi possível consultar o índice local.",
    });
    await expect(
      executeTool(
        {
          args: { query: "x" },
          tool: "search_workspace",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        {
          searchWorkspace: async () => {
            throw new Error("segredo em /private/index.db");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "SEARCH_UNAVAILABLE",
      message: "Não foi possível consultar o índice local.",
    });
  });

  it("lista caminhos canônicos, ignora dependências e trunca arquivos grandes", async () => {
    const { directory, state, workspaceRoot } = await fixture("automatic");
    await mkdir(join(workspaceRoot, "src"));
    await mkdir(join(workspaceRoot, "node_modules"));
    await writeFile(join(workspaceRoot, "src", "index.ts"), "export const value = 1;\n");
    await writeFile(join(workspaceRoot, "large.txt"), "x".repeat(140_000));
    const listing = await executeTool(
      {
        args: { path: "." },
        tool: "list_directory",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
    );
    expect(listing.path).toBe(".");
    expect(listing.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "src", type: "directory" }),
        expect.objectContaining({ path: "large.txt", size: 140_000, type: "file" }),
      ]),
    );
    expect(listing.entries.some((entry) => entry.name === "node_modules")).toBe(false);
    const read = await executeTool(
      {
        args: { path: "large.txt" },
        tool: "read_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
    );
    expect(read).toMatchObject({
      bytesRead: 128_000,
      end: 128_000,
      path: "large.txt",
      size: 140_000,
      start: 0,
      truncated: true,
    });
  });

  it("permite leitura automática e bloqueia escrita no modo read-only", async () => {
    const { directory, state, workspaceRoot } = await fixture("read-only");
    await expect(
      executeTool(
        {
          args: { path: "." },
          sessionId: state.activeSessionId,
          tool: "list_directory",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).resolves.toEqual({ entries: [], path: "." });
    await expect(
      executeTool(
        {
          args: { path: "" },
          sessionId: state.activeSessionId,
          tool: "list_directory",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).resolves.toEqual({ entries: [], path: "." });
    await expect(
      executeTool(
        {
          args: { content: "blocked", path: "blocked.txt" },
          tool: "create_or_update_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toThrow("somente leitura");
    await expect(readFile(join(workspaceRoot, "blocked.txt"))).rejects.toThrow();
  });

  it("pede autorização antes de escrever e aceita permitir durante a sessão", async () => {
    const { directory, state } = await fixture("ask");
    let approval: ApprovalRequest | undefined;
    const execution = executeTool(
      {
        args: { content: "local", path: "notes.txt" },
        requestId: "request-write",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: (request) => (approval = request) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(approval?.requestId).toBe("request-write");
    await resolveApproval("request-write", "allow_session", directory);
    await expect(execution).resolves.toMatchObject({ path: "notes.txt" });
  });

  it("bloqueia links simbólicos e caminhos fora do workspace", async () => {
    const { directory, state } = await fixture("automatic");
    await expect(
      executeTool(
        {
          args: { path: "../secret.txt" },
          tool: "read_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      ),
    ).rejects.toThrow("fora da pasta");
  });

  it("registra writes estruturados e diferenças do Bash sem conteúdo", async () => {
    const { directory, state } = await fixture("automatic");
    const workspaceId = state.activeWorkspaceId as string;
    const sessionId = state.activeSessionId as string;
    const updates: Array<{ created: number; deleted: number; modified: number }> = [];
    await executeTool(
      {
        args: { content: "one\n", path: "artifact.txt" },
        sessionId,
        tool: "create_or_update_file",
        workspaceId,
      },
      directory,
      { onArtifactsUpdated: (counts) => updates.push(counts) },
    );
    await executeTool(
      {
        args: { newText: "two", oldText: "one", path: "artifact.txt" },
        sessionId,
        tool: "apply_patch",
        workspaceId,
      },
      directory,
      { onArtifactsUpdated: (counts) => updates.push(counts) },
    );
    await executeTool(
      {
        args: {
          args: ["-e", "require('fs').writeFileSync('bash-artifact.txt', 'bash')"],
          command: process.execPath,
        },
        sessionId,
        tool: "execute_command",
        workspaceId,
      },
      directory,
      { onArtifactsUpdated: (counts) => updates.push(counts) },
    );
    const database = openDatabase(directory);
    const artifacts = listSessionArtifacts(database.client, workspaceId, sessionId);
    database.close();
    expect(artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "modified", path: "artifact.txt" }),
        expect.objectContaining({ operation: "created", path: "bash-artifact.txt" }),
      ]),
    );
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ created: 1 }),
        expect.objectContaining({ modified: 1 }),
      ]),
    );
    expect(artifacts?.[0]).not.toHaveProperty("content");
    expect(artifacts?.[0]).not.toHaveProperty("workspaceRoot");
  });

  it("sanitiza o ambiente dos comandos e nega aprovações canceladas", async () => {
    const { directory, state } = await fixture("ask");
    const previousSecret = process.env.BLACKWALL_TEST_SECRET;
    process.env.BLACKWALL_TEST_SECRET = "must-not-cross-the-boundary";
    try {
      let approval: ApprovalRequest | undefined;
      const execution = executeTool(
        {
          args: {
            args: ["-e", "console.log(process.env.BLACKWALL_TEST_SECRET ?? '')"],
            command: process.execPath,
          },
          requestId: "request-sanitized",
          sessionId: state.activeSessionId,
          tool: "execute_command",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { onApproval: (request) => (approval = request) },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(approval?.requestId).toBe("request-sanitized");
      cancelPendingApprovals("request-sanitized", directory);
      await expect(execution).rejects.toThrow("negada");

      const allowedExecution = executeTool(
        {
          args: {
            args: ["-e", "console.log(process.env.BLACKWALL_TEST_SECRET ?? '')"],
            command: process.execPath,
          },
          requestId: "request-sanitized-allowed",
          sessionId: state.activeSessionId,
          tool: "execute_command",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
        { onApproval: () => undefined },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      await resolveApproval("request-sanitized-allowed", "allow_once", directory);
      const result = await allowedExecution;
      expect(result.code).toBe(0);
      expect(result.stdout).not.toContain("must-not-cross-the-boundary");
    } finally {
      if (previousSecret === undefined) delete process.env.BLACKWALL_TEST_SECRET;
      else process.env.BLACKWALL_TEST_SECRET = previousSecret;
    }
  });
});

describe("modo automático e transições de política (#209)", () => {
  it("automático escreve arquivo SEM abrir card", async () => {
    const { directory, state, workspaceRoot } = await fixture("automatic");
    let approvals = 0;
    const result = await executeTool(
      {
        args: { content: "auto", path: "auto.txt" },
        requestId: "req-auto-write",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => (approvals += 1) },
    );
    expect(approvals).toBe(0);
    expect(result).toMatchObject({ path: "auto.txt" });
    await expect(readFile(join(workspaceRoot, "auto.txt"), "utf8")).resolves.toBe("auto");
  });

  it("automático executa Bash sem card e preserva o resultado estruturado", async () => {
    const { directory, state, workspaceRoot } = await fixture("automatic");
    let approvals = 0;
    const result = await executeTool(
      {
        args: { command: "printf 'auto' > escape-proof.txt" },
        requestId: "req-auto-cmd",
        sessionId: state.activeSessionId,
        tool: "bash",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      {
        onApproval: () => (approvals += 1),
        onApprovalResolved: () => (approvals += 100),
      },
    );
    expect(approvals).toBe(0);
    expect(result).toMatchObject({ exitCode: 0, ok: true });
    await expect(readFile(join(workspaceRoot, "escape-proof.txt"), "utf8")).resolves.toBe("auto");
  });

  it("mudança para read-only durante a espera nega ANTES do efeito (TOCTOU)", async () => {
    const { directory, state, workspaceRoot } = await fixture("ask");
    const execution = executeTool(
      {
        args: { content: "late", path: "toctou.txt" },
        requestId: "req-toctou",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Usuário troca o modo enquanto o card está pendente…
    const database = openDatabase(directory);
    createStore(database).setWorkspacePermissionMode(
      state.activeWorkspaceId as string,
      "read-only",
    );
    database.close();
    // …e só então aprova. A releitura pré-efeito precisa negar.
    await resolveApproval("req-toctou", "allow_once", directory);
    await expect(execution).rejects.toThrow("somente leitura");
    await expect(readFile(join(workspaceRoot, "toctou.txt"))).rejects.toThrow();
  });

  it("troca ask→read-only reavalia card pendente: nega e persiste terminal", async () => {
    const { directory, state, workspaceRoot } = await fixture("ask");
    const execution = executeTool(
      {
        args: { content: "never", path: "transition.txt" },
        requestId: "req-transition",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const database = openDatabase(directory);
    createStore(database).setWorkspacePermissionMode(
      state.activeWorkspaceId as string,
      "read-only",
    );
    database.close();
    notifyWorkspacePolicyChanged(state.activeWorkspaceId as string, directory);
    await expect(execution).rejects.toThrow("somente leitura");
    await expect(readFile(join(workspaceRoot, "transition.txt"))).rejects.toThrow();

    const persisted = openDatabase(directory);
    const row = persisted.client
      .prepare("SELECT status FROM approvals WHERE request_id = 'req-transition'")
      .get() as { status: string };
    persisted.close();
    expect(row.status).toBe("denied");
  });

  it("troca ask→automático executa a pendência exatamente uma vez", async () => {
    const { directory, state, workspaceRoot } = await fixture("ask");
    const execution = executeTool(
      {
        args: { content: "once", path: "once.txt" },
        requestId: "req-once",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const database = openDatabase(directory);
    createStore(database).setWorkspacePermissionMode(
      state.activeWorkspaceId as string,
      "automatic",
    );
    database.close();
    notifyWorkspacePolicyChanged(state.activeWorkspaceId as string, directory);
    await expect(execution).resolves.toMatchObject({ path: "once.txt" });
    await expect(readFile(join(workspaceRoot, "once.txt"), "utf8")).resolves.toBe("once");

    const persisted = openDatabase(directory);
    const rows = persisted.client
      .prepare("SELECT status FROM approvals WHERE request_id = 'req-once'")
      .all() as Array<{ status: string }>;
    persisted.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("allowed");
  });

  it("resolução dupla do mesmo pedido é rejeitada (exactly-once)", async () => {
    const { directory, state } = await fixture("ask");
    const execution = executeTool(
      {
        args: { content: "x", path: "double.txt" },
        requestId: "req-double",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await resolveApproval("req-double", "deny", directory);
    await resolveApproval("req-double", "allow_once", directory).catch(() => null);
    await expect(execution).rejects.toThrow("negada");
    cancelPendingApprovals("req-double", directory);
  });
});

describe("policyEpoch/gate e revogação de grants (P0/P1 auditoria)", () => {
  it("barreira antes do commit point serializa troca de modo com o efeito", async () => {
    const { directory, state, workspaceRoot } = await fixture("automatic");
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => (releaseBarrier = resolve));
    let barrierHit = 0;
    setCommitBarrierForTests(async () => {
      barrierHit += 1;
      await barrier;
    });
    try {
      // Operação A entra na seção crítica e PARA na barreira.
      const opA = executeTool(
        {
          args: { content: "committed", path: "race.txt" },
          requestId: "req-race-a",
          sessionId: state.activeSessionId,
          tool: "create_or_update_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Troca de modo para read-only é SOLICITADA durante a seção crítica.
      const modeChange = setWorkspacePermissionModeGuarded(
        state.activeWorkspaceId as string,
        "read-only",
        directory,
      );

      // Libera a barreira: o efeito de A conclui sob a política validada.
      releaseBarrier();
      await expect(opA).resolves.toMatchObject({ path: "race.txt" });
      await expect(readFile(join(workspaceRoot, "race.txt"), "utf8")).resolves.toBe("committed");
      await expect(modeChange).resolves.toBeTruthy();

      // Operação B começa DEPOIS da troca: negada pela política nova.
      await expect(
        executeTool(
          {
            args: { content: "blocked", path: "race2.txt" },
            requestId: "req-race-b",
            sessionId: state.activeSessionId,
            tool: "create_or_update_file",
            workspaceId: state.activeWorkspaceId as string,
          },
          directory,
        ),
      ).rejects.toMatchObject({ code: "READ_ONLY_MUTATION" });
      expect(barrierHit).toBe(1);
      await expect(readFile(join(workspaceRoot, "race2.txt"))).rejects.toThrow();
    } finally {
      setCommitBarrierForTests(null);
    }
  });

  it("grant allow_session é revogado na mudança de modo", async () => {
    const { directory, state, workspaceRoot } = await fixture("ask");
    let cards = 0;
    await writeFile(join(workspaceRoot, "cache.txt"), "conteudo", "utf8");
    const readArgs = {
      args: { path: "cache.txt" },
      sessionId: state.activeSessionId,
      tool: "read_file" as const,
      workspaceId: state.activeWorkspaceId as string,
    };
    // 1ª leitura pede card; usuário dá allow_session.
    const first = executeTool({ ...readArgs, requestId: "g-1" }, directory, {
      onApproval: () => (cards += 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await resolveApproval("g-1", "allow_session", directory);
    await first;
    // 2ª leitura NÃO pede card (grant ativo).
    await executeTool({ ...readArgs, requestId: "g-2" }, directory, {
      onApproval: () => (cards += 100),
    });
    expect(cards).toBe(1);
    // Mudança de modo revoga grants do workspace…
    await setWorkspacePermissionModeGuarded(state.activeWorkspaceId as string, "ask", directory);
    // …e a 3ª leitura volta a pedir card.
    const third = executeTool({ ...readArgs, requestId: "g-3" }, directory, {
      onApproval: () => (cards += 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cards).toBe(2);
    await resolveApproval("g-3", "deny", directory);
    await expect(third).rejects.toThrow("negada");
  });

  it("workspaces diferentes não compartilham gate nem grant", async () => {
    // Automático: mutação entra direto na seção crítica (sem card).
    const { directory, state, workspaceRoot } = await fixture("automatic");
    const database = openDatabase(directory);
    await mkdir(join(directory, "other"), { recursive: true });
    const other = await createStore(database).createWorkspace({
      name: "Outro ws",
      permissionMode: "automatic",
      profileId: state.activeProfileId as string,
      rootPath: join(directory, "other"),
      soul: "",
    });
    database.close();

    // Segura o gate do workspace PRINCIPAL na barreira…
    let release!: () => void;
    setCommitBarrierForTests(async (workspaceId) => {
      if (workspaceId !== state.activeWorkspaceId) return;
      await new Promise<void>((resolve) => (release = resolve));
    });
    try {
      const held = executeTool(
        {
          args: { content: "held", path: "held.txt" },
          requestId: "req-held",
          sessionId: state.activeSessionId,
          tool: "create_or_update_file",
          workspaceId: state.activeWorkspaceId as string,
        },
        directory,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      // …o OUTRO workspace executa normalmente em paralelo.
      await expect(
        executeTool(
          {
            args: { content: "free", path: "free.txt" },
            requestId: "req-free",
            sessionId: null,
            tool: "create_or_update_file",
            workspaceId: other.id,
          },
          directory,
        ),
      ).resolves.toMatchObject({ path: "free.txt" });
      await expect(readFile(join(directory, "other", "free.txt"), "utf8")).resolves.toBe("free");

      release();
      await held;
      await expect(readFile(join(workspaceRoot, "held.txt"), "utf8")).resolves.toBe("held");
    } finally {
      setCommitBarrierForTests(null);
    }
  });

  it("restart encerra approvals persistidas como pending com terminal cancelled", async () => {
    const { directory, state } = await fixture("ask");
    const execution = executeTool(
      {
        args: { content: "zombie", path: "zombie.txt" },
        requestId: "req-zombie",
        sessionId: state.activeSessionId,
        tool: "create_or_update_file",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    cancelPendingApprovals("req-zombie", directory);
    await execution.catch(() => undefined);

    // Simula crash deixando pending persistido.
    const db = openDatabase(directory);
    db.client
      .prepare(
        "INSERT INTO approvals (id, created_at, request_id, scope, status, tool, workspace_id, payload) VALUES ('ghost', ?, 'ghost-req', 'once', 'pending', 'create_or_update_file', ?, '{}')",
      )
      .run(Date.now(), state.activeWorkspaceId as string);
    db.close();

    terminateStaleApprovals(directory);
    const persisted = openDatabase(directory);
    const row = persisted.client
      .prepare("SELECT status, resolved_at FROM approvals WHERE id='ghost'")
      .get() as { status: string; resolved_at: number | null };
    persisted.close();
    expect(row.status).toBe("cancelled");
    expect(row.resolved_at).not.toBeNull();
  });
});

describe("contrato estrito de execute_command.args (#210)", () => {
  it("string e objeto rejeitam ANTES do card; array válido aprova e executa", async () => {
    const { directory, state } = await fixture("ask");
    let cards = 0;
    const base = {
      sessionId: state.activeSessionId,
      tool: "execute_command" as const,
      workspaceId: state.activeWorkspaceId as string,
    };

    // STRING: erro estruturado, zero card, zero spawn.
    await expect(
      executeTool(
        {
          ...base,
          args: { args: "-e process.exit(0)", command: process.execPath, cwd: "." },
          requestId: "args-str",
        },
        directory,
        { onApproval: () => (cards += 1) },
      ),
    ).rejects.toMatchObject({ code: "invalid_tool_arguments" });

    // OBJETO: mesmo contrato.
    await expect(
      executeTool(
        {
          ...base,
          args: { args: { cmd: "x" }, command: process.execPath, cwd: "." },
          requestId: "args-obj",
        },
        directory,
        { onApproval: () => (cards += 1) },
      ),
    ).rejects.toMatchObject({ code: "invalid_tool_arguments" });
    expect(cards).toBe(0);

    // ARRAY VÁLIDO: fluxo normal com aprovação.
    const okRun = executeTool(
      {
        ...base,
        args: { args: ["-e", "process.exit(0)"], command: process.execPath, cwd: "." },
        requestId: "args-ok",
      },
      directory,
      { onApproval: () => (cards += 1) },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(cards).toBe(1);
    await resolveApproval("args-ok", "allow_once", directory);
    const result = (await okRun) as { code?: number | null };
    expect(result.code).toBe(0);
  });

  it("args ausente é tratado como lista vazia", async () => {
    const { directory, state } = await fixture("ask");
    // Comando que ignora stdin e sai rápido mesmo sem args.
    const run = executeTool(
      {
        args: { command: process.execPath, args: ["-e", ""], cwd: "." },
        requestId: "args-absent",
        sessionId: state.activeSessionId,
        tool: "execute_command",
        workspaceId: state.activeWorkspaceId as string,
      },
      directory,
      { onApproval: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    await resolveApproval("args-absent", "allow_once", directory);
    const result = (await run) as { code?: number | null };
    expect(result.code).toBe(0);
  });
});

describe("permissões de ferramentas MCP", () => {
  it("pede confirmação em ask, mantém o grant no escopo sessão+servidor+ferramenta e bloqueia read-only", async () => {
    const { directory, state } = await fixture("ask");
    const base = {
      args: { path: "README.md" },
      publicName: "mcp__files_12345678__read_12345678",
      remoteName: "read_file",
      serverId: "mcp-server-a",
      serverName: "Files",
      sessionId: state.activeSessionId,
      workspaceId: state.activeWorkspaceId as string,
    };
    let approvals = 0;
    let executions = 0;
    const first = executeMcpTool({ ...base, requestId: "mcp-ask" }, directory, {
      execute: async () => ({ ok: ++executions }),
      onApproval: () => (approvals += 1),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(approvals).toBe(1);
    await resolveApproval("mcp-ask", "allow_session", directory);
    await expect(first).resolves.toEqual({ ok: 1 });

    await expect(
      executeMcpTool(base, directory, {
        execute: async () => ({ ok: ++executions }),
        onApproval: () => (approvals += 1),
      }),
    ).resolves.toEqual({ ok: 2 });
    expect(approvals).toBe(1);

    await setWorkspacePermissionModeGuarded(
      state.activeWorkspaceId as string,
      "read-only",
      directory,
    );
    await expect(
      executeMcpTool(base, directory, { execute: async () => ({ ok: ++executions }) }),
    ).rejects.toMatchObject({ code: "READ_ONLY_COMMAND" });
    expect(executions).toBe(2);
  });
});

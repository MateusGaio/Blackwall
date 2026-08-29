// MIT License — Copyright (c) 2026 Mateus Gaio

/**
 * Corpus sintético local de evals (#211) — camada 1: gates determinísticos
 * de CI. Nenhum conteúdo real, nenhum modelo remoto, nenhum dado pessoal.
 *
 * Categorias e denominadores (definidos no runner):
 * - explore (10): leitura/listagem/busca;
 * - edit (10): criação/patch com validações;
 * - execute (8): comandos — exit codes, espera assíncrona, ambiente e falhas estruturadas;
 * - recovery (6): args/path inválidos → erro estruturado recuperável;
 * - stream (6): protocolo — terminal único em falhas de stream.
 */

export type TaskCategory = "explore" | "edit" | "execute" | "recovery" | "stream";

export type OkExpectation = {
  kind: "ok";
  /** Campo esperado no resultado (ex.: code === 0 implícito). */
  field?: string;
  value?: unknown;
};

export type ToolTaskSpec = {
  id: string;
  category: Exclude<TaskCategory, "stream">;
  /** Modo do workspace sintético. */
  mode: "ask" | "automatic" | "read-only";
  /** Arquivos criados no workspace temporário. */
  files: Record<string, string>;
  tool: string;
  args: Record<string, unknown>;
  /** Aprovar via allow_once quando a política pedir prompt. */
  approve?: boolean;
  expect:
    | ({ kind: "ok" } & Partial<OkExpectation>)
    | { kind: "deny"; code: string }
    | { kind: "error"; code?: string; messageIncludes?: string };
};

export const TOOL_TASKS: ToolTaskSpec[] = [
  // ── explorar/ler (10) ────────────────────────────────────────────────
  {
    id: "exp-01",
    category: "explore",
    mode: "automatic",
    files: { "a.md": "# A" },
    tool: "read_file",
    args: { path: "a.md" },
    expect: { kind: "ok" },
  },
  {
    id: "exp-02",
    category: "explore",
    mode: "ask",
    files: { "a.md": "# A" },
    tool: "read_file",
    args: { path: "a.md" },
    approve: true,
    expect: { kind: "ok" },
  },
  {
    id: "exp-03",
    category: "explore",
    mode: "read-only",
    files: { "a.md": "# A" },
    tool: "read_file",
    args: { path: "a.md" },
    expect: { kind: "ok" },
  },
  {
    id: "exp-04",
    category: "explore",
    mode: "automatic",
    files: { "src/i.ts": "x" },
    tool: "list_directory",
    args: { path: "." },
    expect: { kind: "ok", field: "path", value: "." },
  },
  {
    id: "exp-05",
    category: "explore",
    mode: "automatic",
    files: { "s.ts": "needle aqui" },
    tool: "search_text",
    args: { query: "needle" },
    expect: { kind: "ok" },
  },
  {
    id: "exp-06",
    category: "explore",
    mode: "automatic",
    files: {},
    tool: "list_directory",
    args: { path: "." },
    expect: { kind: "ok" },
  },
  {
    id: "exp-07",
    category: "explore",
    mode: "automatic",
    files: { "n/node_modules/x.js": "1" },
    tool: "list_directory",
    args: { path: "." },
    expect: { kind: "ok" },
  },
  {
    id: "exp-08",
    category: "explore",
    mode: "automatic",
    files: { "big.txt": "" },
    tool: "read_file",
    args: { path: "big.txt" },
    expect: { kind: "ok" },
  },
  {
    id: "exp-09",
    category: "explore",
    mode: "automatic",
    files: { "d/e/f.md": "deep" },
    tool: "read_file",
    args: { path: "d/e/f.md" },
    expect: { kind: "ok" },
  },
  {
    id: "exp-10",
    category: "explore",
    mode: "automatic",
    files: { "q.ts": "alvo" },
    tool: "search_text",
    args: { query: "ALVO" },
    expect: { kind: "ok" },
  },

  // ── editar (10) ───────────────────────────────────────────────────────
  {
    id: "edt-01",
    category: "edit",
    mode: "automatic",
    files: {},
    tool: "create_or_update_file",
    args: { content: "novo", path: "n.txt" },
    expect: { kind: "ok" },
  },
  {
    id: "edt-02",
    category: "edit",
    mode: "ask",
    files: {},
    tool: "create_or_update_file",
    args: { content: "card", path: "c.txt" },
    approve: true,
    expect: { kind: "ok" },
  },
  {
    id: "edt-03",
    category: "edit",
    mode: "read-only",
    files: {},
    tool: "create_or_update_file",
    args: { content: "x", path: "r.txt" },
    expect: { kind: "deny", code: "READ_ONLY_MUTATION" },
  },
  {
    id: "edt-04",
    category: "edit",
    mode: "automatic",
    files: { "p.txt": "aa bb" },
    tool: "apply_patch",
    args: { newText: "cc", oldText: "bb", path: "p.txt" },
    expect: { kind: "ok" },
  },
  {
    id: "edt-05",
    category: "edit",
    mode: "automatic",
    files: { "p.txt": "aa" },
    tool: "apply_patch",
    args: { newText: "z", oldText: "nao-existe", path: "p.txt" },
    expect: { kind: "error", messageIncludes: "não foi encontrado" },
  },
  {
    id: "edt-06",
    category: "edit",
    mode: "automatic",
    files: { "p.txt": "dup dup" },
    tool: "apply_patch",
    args: { newText: "y", oldText: "dup", path: "p.txt" },
    expect: { kind: "error", messageIncludes: "mais de uma vez" },
  },
  {
    id: "edt-07",
    category: "edit",
    mode: "automatic",
    files: {},
    tool: "create_or_update_file",
    args: { content: "esc", path: "../fora.txt" },
    expect: { kind: "error", messageIncludes: "fora da pasta" },
  },
  {
    id: "edt-08",
    category: "edit",
    mode: "automatic",
    files: {},
    tool: "create_or_update_file",
    args: { content: "abs", path: "/etc/passwd" },
    expect: { kind: "error", messageIncludes: "fora da pasta" },
  },
  {
    id: "edt-09",
    category: "edit",
    mode: "automatic",
    files: { "sub/a.txt": "x" },
    tool: "create_or_update_file",
    args: { content: "sub", path: "sub/b.txt" },
    expect: { kind: "ok" },
  },
  {
    id: "edt-10",
    category: "edit",
    mode: "automatic",
    files: { "u.txt": "héllo ünicode" },
    tool: "apply_patch",
    args: { newText: "héllo ✅", oldText: "héllo ünicode", path: "u.txt" },
    expect: { kind: "ok" },
  },

  // ── executar/testes (8) ───────────────────────────────────────────────
  {
    id: "exe-01",
    category: "execute",
    mode: "automatic",
    files: {},
    tool: "execute_command",
    args: { args: ["-v"], command: process.execPath, cwd: "." },
    expect: { kind: "ok" },
  },
  {
    id: "exe-02",
    category: "execute",
    mode: "read-only",
    files: {},
    tool: "execute_command",
    args: { args: [], command: process.execPath, cwd: "." },
    expect: { kind: "deny", code: "READ_ONLY_COMMAND" },
  },
  {
    id: "exe-03",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: { args: ["-e", "process.exit(0)"], command: process.execPath, cwd: "." },
    approve: true,
    expect: { kind: "ok" },
  },
  {
    id: "exe-04",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: { args: ["-e", "process.exit(3)"], command: process.execPath, cwd: "." },
    approve: true,
    expect: { kind: "ok", field: "code", value: 3 },
  },
  {
    id: "exe-05",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: {
      args: ["-e", "console.log(process.env.BLACKWALL_EVAL_SECRET ?? '')"],
      command: process.execPath,
      cwd: ".",
    },
    approve: true,
    expect: { kind: "ok" },
  },
  {
    id: "exe-06",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: { args: ["-e", "setTimeout(()=>process.exit(0),5)"], command: process.execPath, cwd: "." },
    approve: true,
    expect: { kind: "ok", field: "code", value: 0 },
  },
  {
    id: "exe-07",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: { args: [], command: "definitivamente-nao-existe-xyz", cwd: "." },
    approve: true,
    // O shell inicia corretamente e reporta comando inexistente como um
    // resultado estruturado, preservando stdout/stderr e o código de saída.
    expect: { kind: "ok", field: "ok", value: false },
  },
  {
    id: "exe-08",
    category: "execute",
    mode: "ask",
    files: {},
    tool: "execute_command",
    args: { args: "-nao-lista", command: process.execPath, cwd: "." },
    approve: true,
    expect: { kind: "error", code: "invalid_tool_arguments" },
  },

  // ── recuperação de args/path (6) ──────────────────────────────────────
  {
    id: "rec-01",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "read_file",
    args: { path: "" },
    expect: { kind: "error", messageIncludes: "caminho" },
  },
  {
    id: "rec-02",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "read_file",
    args: { path: "fantasma.md" },
    expect: { kind: "error", messageIncludes: "não existe" },
  },
  {
    id: "rec-03",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "search_text",
    args: { query: "  " },
    expect: { kind: "error", messageIncludes: "pesquisar" },
  },
  {
    id: "rec-04",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "apply_patch",
    args: { newText: "a", oldText: "", path: "x.txt" },
    expect: { kind: "error", messageIncludes: "não existe" },
  },
  {
    id: "rec-05",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "read_file",
    args: { path: "../../escape.md" },
    expect: { kind: "error", messageIncludes: "fora da pasta" },
  },
  {
    id: "rec-06",
    category: "recovery",
    mode: "automatic",
    files: {},
    tool: "create_or_update_file",
    args: { content: "x" },
    expect: { kind: "error", messageIncludes: "caminho" },
  },
];

/** Metas da camada determinística (#211). */
export const DETERMINISTIC_GOALS = {
  conclusionRate: 1,
  zeroImproperCardsInAutomatic: true,
  zeroReadOnlyMutations: true,
  zeroWorkspaceEscapes: true,
  nonzeroExitClassifiedAsError: true,
} as const;

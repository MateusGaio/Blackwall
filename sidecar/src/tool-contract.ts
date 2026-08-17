// MIT License — Copyright (c) 2026 Mateus Gaio

export type ToolMode = "auto" | "compatibility" | "disabled";

export type ProtocolPreference = "auto" | "openai-chat" | "openai-responses";
export type ResolvedProtocol = "openai-chat" | "openai-responses" | "ollama-chat";
export type ToolSupport = "unknown" | "native" | "unsupported" | "probe-error";
export type ToolSupportSource = "metadata" | "probe" | "manual";

export type ToolDefinition = {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
};

export type ResponsesToolDefinition = {
  type: "function";
  name: ToolName | "blackwall_capability_probe";
  description: string;
  parameters: Record<string, unknown>;
  strict: true;
};

export type ToolName =
  | "apply_patch"
  | "blackwall_capability_probe"
  | "create_or_update_file"
  | "execute_command"
  | "list_directory"
  | "read_file"
  | "search_text";

export type ToolCall = {
  id: string;
  name: ToolName;
  arguments: string;
};

export type ToolResult = {
  callId: string;
  content: string;
  isError?: boolean;
  name: ToolName;
};

export type ToolValidationFailureShape = {
  code: string;
  expectedExample: unknown;
  message: string;
  retryable: boolean;
};

export class ToolValidationFailure extends Error {
  readonly code: string;
  readonly expectedExample: unknown;
  readonly retryable: boolean;

  constructor(failure: ToolValidationFailureShape) {
    super(failure.message);
    this.name = "ToolValidationFailure";
    this.code = failure.code;
    this.expectedExample = failure.expectedExample;
    this.retryable = failure.retryable;
  }

  toJSON(): ToolValidationFailureShape {
    return {
      code: this.code,
      expectedExample: this.expectedExample,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export const MAX_REPEATED_TOOL_ERRORS = 2;
/**
 * The agent loop is budgeted instead of being capped at the old 32-call
 * ceiling. The default is deliberately generous for real repositories while
 * the upper bound keeps a broken provider from running forever.
 */
export const DEFAULT_TOOL_CALL_BUDGET = 128;
export const MAX_TOOL_CALL_BUDGET = 512;
export const MAX_TOOL_RESULT_BYTES_PER_TURN = 512_000;
export const MAX_IDENTICAL_TOOL_CALLS_WITHOUT_PROGRESS = 3;

export function shouldStopAfterRepeatedToolError(failureCount: number): boolean {
  return failureCount >= MAX_REPEATED_TOOL_ERRORS;
}

export function shouldStopAfterNoProgress(repetitionCount: number): boolean {
  return repetitionCount >= MAX_IDENTICAL_TOOL_CALLS_WITHOUT_PROGRESS;
}

export function resolveToolCallBudget(
  value: unknown = process.env.BLACKWALL_TOOL_CALL_BUDGET,
): number {
  const requested = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_TOOL_CALL_BUDGET;
  return Math.min(MAX_TOOL_CALL_BUDGET, Math.max(1, Math.floor(requested)));
}

const objectSchema = (
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> => ({
  additionalProperties: false,
  properties,
  required,
  type: "object",
});

const stringProperty = (description: string) => ({ description, type: "string" });

export const workspaceToolDefinitions: ToolDefinition[] = [
  {
    function: {
      description: "List files and directories below the workspace root.",
      name: "list_directory",
      parameters: objectSchema({ path: stringProperty("Relative directory path.") }, ["path"]),
      strict: true,
    },
    type: "function",
  },
  {
    function: {
      description: "Read one UTF-8 text file from the workspace.",
      name: "read_file",
      parameters: objectSchema({ path: stringProperty("Relative file path.") }, ["path"]),
      strict: true,
    },
    type: "function",
  },
  {
    function: {
      description: "Search text in files below the workspace.",
      name: "search_text",
      parameters: objectSchema(
        {
          path: stringProperty("Relative directory path to search from."),
          query: stringProperty("Text to search for."),
        },
        ["path", "query"],
      ),
      strict: true,
    },
    type: "function",
  },
  {
    function: {
      description: "Create or replace a UTF-8 file in the workspace.",
      name: "create_or_update_file",
      parameters: objectSchema(
        {
          content: stringProperty("Complete UTF-8 file content."),
          path: stringProperty("Relative file path."),
        },
        ["path", "content"],
      ),
      strict: true,
    },
    type: "function",
  },
  {
    function: {
      description: "Replace one unique text range in a workspace file.",
      name: "apply_patch",
      parameters: objectSchema(
        {
          newText: stringProperty("Replacement text."),
          oldText: stringProperty("Unique existing text."),
          path: stringProperty("Relative file path."),
        },
        ["path", "oldText", "newText"],
      ),
      strict: true,
    },
    type: "function",
  },
  {
    function: {
      description:
        "Run one executable with structured arguments inside the workspace; args must be an array of strings, and shell interpretation is disabled.",
      name: "execute_command",
      parameters: objectSchema(
        {
          args: { description: "Executable arguments.", items: { type: "string" }, type: "array" },
          command: stringProperty("Executable name or path."),
          cwd: stringProperty("Relative working directory."),
        },
        ["command", "args", "cwd"],
      ),
      strict: true,
    },
    type: "function",
  },
];

export const capabilityProbeTool: ToolDefinition = {
  function: {
    description: "Internal Blackwall capability probe. Do not use for workspace actions.",
    name: "blackwall_capability_probe" as ToolName,
    parameters: objectSchema({ nonce: stringProperty("Opaque probe nonce.") }, ["nonce"]),
    strict: true,
  },
  type: "function",
};

const toolNames = new Set<ToolName>(workspaceToolDefinitions.map((item) => item.function.name));

export function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && toolNames.has(value as ToolName);
}

export function parseToolArguments(name: ToolName, raw: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`Os argumentos da ferramenta ${name} não são JSON válido.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Os argumentos da ferramenta ${name} devem ser um objeto.`);
  }
  const args = normalizeToolArguments(name, value as Record<string, unknown>);
  const fields: Record<ToolName, { required: string[]; optional: string[] }> = {
    apply_patch: { optional: [], required: ["path", "oldText", "newText"] },
    blackwall_capability_probe: { optional: [], required: ["nonce"] },
    create_or_update_file: { optional: [], required: ["path", "content"] },
    execute_command: { optional: [], required: ["command", "args", "cwd"] },
    list_directory: { optional: [], required: ["path"] },
    read_file: { optional: [], required: ["path"] },
    search_text: { optional: [], required: ["path", "query"] },
  };
  const allowed = new Set([...fields[name].required, ...fields[name].optional]);
  for (const key of Object.keys(args)) {
    if (!allowed.has(key))
      throw new Error(`O argumento ${key} não é aceito pela ferramenta ${name}.`);
  }
  for (const field of fields[name].required) {
    if (!(field in args)) throw new Error(`O argumento ${field} é obrigatório para ${name}.`);
  }
  const stringFields = name === "list_directory" ? ["path"] : [];
  if (name === "read_file") stringFields.push("path");
  if (name === "search_text") stringFields.push("query", "path");
  if (name === "create_or_update_file") stringFields.push("path", "content");
  if (name === "apply_patch") stringFields.push("path", "oldText", "newText");
  if (name === "blackwall_capability_probe") stringFields.push("nonce");
  if (name === "execute_command") stringFields.push("command", "cwd");
  for (const field of stringFields) {
    if (args[field] !== undefined && typeof args[field] !== "string") {
      throw new Error(`O argumento ${field} da ferramenta ${name} deve ser texto.`);
    }
  }
  if (
    name === "execute_command" &&
    (!Array.isArray(args.args) || args.args.some((arg) => typeof arg !== "string"))
  ) {
    throw new Error(
      'Os argumentos do comando devem ser uma lista de textos, por exemplo: {"args":["-la","src"]}.',
    );
  }
  return args;
}

/** Convert the Chat Completions envelope into the Responses API shape. */
export function toOpenAIChatTools(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.map((tool) => ({
    function: {
      ...tool.function,
      parameters: { ...tool.function.parameters, additionalProperties: false },
      strict: true,
    },
    type: "function",
  }));
}

export function toOpenAIResponsesTools(tools: ToolDefinition[]): ResponsesToolDefinition[] {
  return tools.map((tool) => ({
    description: tool.function.description,
    name: tool.function.name,
    parameters: tool.function.parameters,
    strict: true,
    type: "function",
  }));
}

/** Ollama accepts the same function envelope but keeps arguments as JSON values. */
export function toOllamaTools(tools: ToolDefinition[]): ToolDefinition[] {
  return toOpenAIChatTools(tools);
}

export function toCompatibilityPrompt(tools: ToolDefinition[]): string {
  const schema = tools.map((tool) => ({
    name: tool.function.name,
    parameters: tool.function.parameters,
  }));
  return [
    "Blackwall compatibility tools: return only one JSON object when a local tool is needed.",
    'Format: {"tool":"name","args":{...}}. Never return shell syntax or Markdown as a tool call.',
    "Validate the arguments against this schema:",
    JSON.stringify(schema),
  ].join("\n");
}

const unsafeShellSyntax = /(?:\|\||&&|[|;<>`]|\$\(|\$\{|\n|\r)/;
const environmentAssignment = /^[A-Za-z_][A-Za-z\d_]*=/;

/**
 * Repairs only common provider formatting mistakes. This is not a shell
 * parser: operators, substitutions and environment assignments are rejected
 * before tokenization, and the resulting command is still executed with
 * `shell: false`.
 */
export function normalizeToolArguments(
  name: ToolName,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...input };
  if (name === "search_text" && !("path" in result)) result.path = ".";
  if (name !== "execute_command") return result;
  if (!("args" in result)) result.args = [];
  if (!("cwd" in result) || result.cwd === "/workspace" || result.cwd === "workspace")
    result.cwd = ".";
  if (typeof result.command !== "string") return result;
  const rawCommand = result.command.trim();
  if (!rawCommand) return result;
  if (unsafeShellSyntax.test(rawCommand) || environmentAssignment.test(rawCommand)) {
    throw new ToolValidationFailure({
      code: "unsafe_command_syntax",
      expectedExample: { args: ["status", "--short"], command: "git", cwd: "." },
      message:
        "Operadores de shell, redireções e variáveis inline não são permitidos. Se precisar rodar mais de um comando, chame execute_command novamente para cada um, em sequência — nunca encadeie com &&, |, ; ou similares.",
      retryable: false,
    });
  }
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of rawCommand) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (escaped || quote) {
    throw new ToolValidationFailure({
      code: "invalid_command_quoting",
      expectedExample: { args: ["path with spaces"], command: "ls", cwd: "." },
      message: "As aspas ou escapes do comando estão incompletos.",
      retryable: true,
    });
  }
  if (current) tokens.push(current);
  if (tokens.length > 1) {
    const existingArgs = Array.isArray(result.args) ? result.args : [];
    result.command = tokens[0];
    result.args = [...tokens.slice(1), ...existingArgs];
  } else {
    result.command = tokens[0] ?? rawCommand;
  }
  return result;
}

export function parseCompatibilityToolCall(content: string): ToolCall | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value = JSON.parse(trimmed) as { tool?: unknown; args?: unknown; id?: unknown };
    if (
      !isToolName(value.tool) ||
      !value.args ||
      typeof value.args !== "object" ||
      Array.isArray(value.args)
    )
      return null;
    return {
      arguments: JSON.stringify(value.args),
      id: typeof value.id === "string" && value.id ? value.id : crypto.randomUUID(),
      name: value.tool,
    };
  } catch {
    return null;
  }
}

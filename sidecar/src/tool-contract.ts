// MIT License — Copyright (c) 2026 Mateus Gaio

export type ToolMode = "auto" | "compatibility" | "disabled";

export type ToolDefinition = {
  type: "function";
  function: {
    name: ToolName;
    description: string;
    parameters: Record<string, unknown>;
    strict: true;
  };
};

export type ToolName =
  | "apply_patch"
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
        ["query"],
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
        "Run one executable with structured arguments inside the workspace; shell interpretation is disabled.",
      name: "execute_command",
      parameters: objectSchema(
        {
          args: { description: "Executable arguments.", items: { type: "string" }, type: "array" },
          command: stringProperty("Executable name or path."),
          cwd: stringProperty("Relative working directory."),
        },
        ["command", "args"],
      ),
      strict: true,
    },
    type: "function",
  },
];

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
  const args = value as Record<string, unknown>;
  const fields: Record<ToolName, { required: string[]; optional: string[] }> = {
    apply_patch: { optional: [], required: ["path", "oldText", "newText"] },
    create_or_update_file: { optional: [], required: ["path", "content"] },
    execute_command: { optional: ["cwd"], required: ["command", "args"] },
    list_directory: { optional: [], required: ["path"] },
    read_file: { optional: [], required: ["path"] },
    search_text: { optional: ["path"], required: ["query"] },
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
    throw new Error("Os argumentos do comando devem ser uma lista de textos.");
  }
  return args;
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

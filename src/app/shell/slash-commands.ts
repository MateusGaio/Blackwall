// MIT License — Copyright (c) 2026 Mateus Gaio

export type SlashCommandName = "help" | "mode" | "model" | "note" | "plan";

export type SlashCommandDefinition = {
  description: string;
  name: SlashCommandName;
  usage: string;
};

export type SlashCommandInvocation = {
  args: string;
  command: SlashCommandName;
  raw: string;
};

const slashCommandDefinitions: readonly SlashCommandDefinition[] = [
  { description: "Save the current context to the Vault.", name: "note", usage: "/note [request]" },
  { description: "Choose or switch the active model.", name: "model", usage: "/model [model-id]" },
  {
    description: "Toggle read-only planning mode for this session.",
    name: "plan",
    usage: "/plan [on|off|status]",
  },
  {
    description: "Change workspace permission mode.",
    name: "mode",
    usage: "/mode <ask|automatic|read-only>",
  },
  { description: "Show available slash commands.", name: "help", usage: "/help" },
];

const commandNames = new Set(slashCommandDefinitions.map((command) => command.name));

function commandFromToken(token: string): SlashCommandName | null {
  const normalized = token.toLocaleLowerCase();
  if (normalized === "nota") return "note";
  return commandNames.has(normalized as SlashCommandName) ? (normalized as SlashCommandName) : null;
}

/**
 * Slash commands are only recognized at the beginning of the draft. A
 * leading `//` remains an ordinary chat message and lets users escape the
 * command grammar.
 */
export function parseSlashCommand(input: string): SlashCommandInvocation | null {
  const raw = input.trim();
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  const match = raw.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  const command = commandFromToken(match[1] ?? "");
  if (!command) return null;
  return { args: match[2]?.trim() ?? "", command, raw };
}

export function isUnknownSlashCommand(input: string): boolean {
  const raw = input.trimStart();
  if (!raw.startsWith("/") || raw.startsWith("//")) return false;
  const token = raw.slice(1).split(/\s/, 1)[0] ?? "";
  return token.length > 0 && commandFromToken(token) === null;
}

export function slashCommandSuggestions(input: string): readonly SlashCommandDefinition[] {
  const raw = input.trimStart();
  if (!raw.startsWith("/") || raw.startsWith("//") || /\s/.test(raw)) return [];
  const query = raw.slice(1).toLocaleLowerCase();
  return slashCommandDefinitions.filter((command) => command.name.startsWith(query));
}

// MIT License — Copyright (c) 2026 Mateus Gaio
export type GraphPreferences = {
  centerStrength: number;
  chargeStrength: number;
  colors: Record<string, string>;
  groupBy: "folder" | "tag";
  linkDistance: number;
};

export const defaultGraphPreferences: GraphPreferences = {
  centerStrength: 0.08,
  chargeStrength: -240,
  colors: {},
  groupBy: "folder",
  linkDistance: 58,
};

function storageKey(workspaceId: string) {
  return `blackwall:graph-preferences:${workspaceId}`;
}

export function readGraphPreferences(workspaceId: string): GraphPreferences {
  if (typeof localStorage === "undefined") return defaultGraphPreferences;
  try {
    const stored = localStorage.getItem(storageKey(workspaceId));
    if (!stored) return defaultGraphPreferences;
    const value = JSON.parse(stored) as Partial<GraphPreferences>;
    if (
      typeof value.chargeStrength !== "number" ||
      typeof value.linkDistance !== "number" ||
      typeof value.centerStrength !== "number" ||
      (value.groupBy !== "folder" && value.groupBy !== "tag") ||
      typeof value.colors !== "object" ||
      value.colors === null
    ) {
      return defaultGraphPreferences;
    }
    return {
      ...defaultGraphPreferences,
      ...value,
      colors: migrateLegacyGroups(value.colors),
    };
  } catch {
    return defaultGraphPreferences;
  }
}

export function writeGraphPreferences(workspaceId: string, preferences: GraphPreferences) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(workspaceId), JSON.stringify(preferences));
  } catch {
    // Graph controls continue working for the active session without storage.
  }
}

// Identificadores estáveis (persistidos no mapa de cores); o rótulo visível
// é resolvido na camada de UI via groupLabel.
const GROUP_UNGROUPED = "@ungrouped";
const GROUP_ROOT = "@root";
const GROUP_UNTAGGED = "@untagged";

const LEGACY_GROUP_NAMES: Record<string, string> = {
  "Sem grupo": GROUP_UNGROUPED,
  Raiz: GROUP_ROOT,
  "Sem tag": GROUP_UNTAGGED,
};

function migrateLegacyGroups(colors: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(colors).map(([group, color]) => [LEGACY_GROUP_NAMES[group] ?? group, color]),
  );
}

export function graphGroupForFile(
  file: { content: string; path: string } | undefined,
  groupBy: GraphPreferences["groupBy"],
) {
  if (!file) return GROUP_UNGROUPED;
  if (groupBy === "folder") return file.path.split("/").at(0) || GROUP_ROOT;
  const frontmatterTags = file.content.match(/^tags:\s*\[?([^\]\n]+)\]?/im)?.[1];
  const inlineTag = file.content.match(/(^|\s)#([\p{L}\p{N}_-]+)/u)?.[2];
  return (
    frontmatterTags
      ?.split(",")
      .at(0)
      ?.trim()
      .replace(/^['"]|['"]$/g, "") ||
    inlineTag ||
    GROUP_UNTAGGED
  );
}

export function defaultColorForGroup(group: string) {
  const palette = ["#9fb7d3", "#b8a4cf", "#9cc4b1", "#d0b38d", "#c99da8", "#a5b8bc"];
  const hash = Array.from(group).reduce((total, character) => total + character.charCodeAt(0), 0);
  return palette[hash % palette.length];
}

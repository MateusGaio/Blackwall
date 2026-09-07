// MIT License — Copyright (c) 2026 Mateus Gaio

export const settingsSections = [
  "usage",
  "profile",
  "memory",
  "workspaces",
  "providers",
  "mcp",
] as const;

export type SettingsSection = (typeof settingsSections)[number] | "qa";

export function normalizeSettingsSection(section: string | undefined): SettingsSection {
  return settingsSections.includes(section as (typeof settingsSections)[number])
    ? (section as SettingsSection)
    : "usage";
}

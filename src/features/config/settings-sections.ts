// MIT License — Copyright (c) 2026 Mateus Gaio

export const settingsSections = ["usage", "profile", "workspaces", "providers"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export function normalizeSettingsSection(section: string | undefined): SettingsSection {
  return settingsSections.includes(section as SettingsSection)
    ? (section as SettingsSection)
    : "usage";
}

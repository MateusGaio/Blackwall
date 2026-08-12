// MIT License — Copyright (c) 2026 Mateus Gaio
type SoulSource = { soul: string } | null | undefined;

export function activeSoulMeta(profile: SoulSource, workspace: SoulSource) {
  if (workspace) return { label: "Soul do workspace", soul: workspace.soul };
  return { label: "Soul do perfil", soul: profile?.soul ?? "" };
}

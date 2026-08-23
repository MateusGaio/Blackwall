// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../../shared/api/sidecar";

/** Marcador de papel em mono: › você · ● agente. */
export function RoleMarker({ role }: { role: ChatMessage["role"] }) {
  const { t } = useTranslation();
  if (role !== "user" && role !== "assistant") return null;
  return (
    <p
      aria-hidden="true"
      className={`font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase ${
        role === "user" ? "text-right" : ""
      }`}
    >
      {role === "user" ? `› ${t("chat.you")}` : `● ${t("chat.assistantLabel")}`}
    </p>
  );
}

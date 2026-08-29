// MIT License — Copyright (c) 2026 Mateus Gaio

import { useTranslation } from "react-i18next";
import type { ChatMessage } from "../../../../shared/api/sidecar";

/** O transcript identifica somente mensagens do usuário; o assistente é um bloco sem marcador. */
export function RoleMarker({ role }: { role: ChatMessage["role"] }) {
  const { t } = useTranslation();
  if (role !== "user") return null;
  return (
    <p
      aria-hidden="true"
      className="font-mono text-[0.68rem] tracking-[0.08em] text-muted-foreground uppercase text-right"
    >
      › {t("chat.you")}
    </p>
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import { CompactIcon } from "./CompactIcon";
import { WindowControls } from "./WindowControls";

type ChatHeaderProps = {
  onToggleSidebar: () => void;
  onToggleVault: () => void;
  sessionTitle: string | undefined;
  sidebarCollapsed: boolean;
  /** "expanded" = painel completo; "rail" = trilho recolhido com atalhos. */
  vaultMode: "expanded" | "rail";
  vaultBlocked: boolean;
};

/**
 * Barra de título da janela frameless: zona de arrasto nativa do Tauri v2,
 * toggles espelhados de sidebar/Vault (ícones de painel), título da sessão e
 * controles de janela. Nada aqui duplica o que a sidebar já exibe.
 */
export function ChatHeader({
  onToggleSidebar,
  onToggleVault,
  sessionTitle,
  sidebarCollapsed,
  vaultBlocked,
  vaultMode,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  const vaultExpanded = vaultMode === "expanded";
  return (
    <header className="flex h-11 w-full shrink-0 items-center gap-2 px-3" data-tauri-drag-region="">
      <button
        aria-expanded={!sidebarCollapsed}
        aria-label={sidebarCollapsed ? t("chat.showSidebar") : t("chat.hideSidebar")}
        className="workspace-header-trigger"
        onClick={onToggleSidebar}
        title={sidebarCollapsed ? t("chat.showSidebar") : t("chat.hideSidebar")}
        type="button"
      >
        <CompactIcon kind="panel" />
      </button>
      <h1
        className="min-w-0 flex-1 truncate text-center text-xs font-medium text-muted-foreground"
        data-tauri-drag-region=""
        title={sessionTitle}
      >
        {sessionTitle ?? t("chat.newConversation")}
      </h1>
      <div className="flex shrink-0 items-center gap-1">
        {/* Controle ÚNICO do Vault (comentários 4–5): alterna painel completo
        ↔ trilho; o painel não tem mais botão de recolher próprio. */}
        <button
          aria-controls="bw-vault-panel"
          aria-expanded={vaultExpanded}
          aria-label={vaultExpanded ? t("chat.hideVault") : t("chat.showVault")}
          className={`header-toggle ${vaultExpanded ? "is-active" : ""} ${
            vaultBlocked ? "opacity-50" : ""
          }`}
          onClick={onToggleVault}
          title={vaultExpanded ? t("chat.hideVault") : t("chat.showVault")}
          type="button"
        >
          <CompactIcon kind="panel-right" />
        </button>
        <WindowControls />
      </div>
    </header>
  );
}

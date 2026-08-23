// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import { CompactIcon } from "./CompactIcon";
import { WindowControls } from "./WindowControls";

type ChatHeaderProps = {
  onToggleSidebar: () => void;
  onVaultClick: () => void;
  sessionTitle: string | undefined;
  sidebarCollapsed: boolean;
  vaultActive: boolean;
};

/**
 * Barra de título da janela frameless: zona de arrasto nativa do Tauri v2,
 * toggle de sidebar, título da sessão, Vault e controles de janela.
 * Nada aqui duplica o que a sidebar já exibe (perfil, workspaces, caminhos).
 */
export function ChatHeader({
  onToggleSidebar,
  onVaultClick,
  sessionTitle,
  sidebarCollapsed,
  vaultActive,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="workspace-header" data-tauri-drag-region="">
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
      <h1 className="thread-title" data-tauri-drag-region="" title={sessionTitle}>
        {sessionTitle ?? t("chat.newConversation")}
      </h1>
      <div className="chat-controls">
        <button
          aria-pressed={vaultActive}
          className={`header-toggle ${vaultActive ? "is-active" : ""}`}
          onClick={onVaultClick}
          type="button"
        >
          Vault
        </button>
        <WindowControls />
      </div>
    </header>
  );
}

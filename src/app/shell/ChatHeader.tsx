// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import type { Workspace } from "../../shared/api/sidecar";
import { CompactIcon } from "./CompactIcon";

type ChatHeaderProps = {
  onToggleSidebar: () => void;
  onVaultClick: () => void;
  sessionTitle: string | undefined;
  sidebarCollapsed: boolean;
  vaultActive: boolean;
  workspace: Workspace | undefined;
};

/** Cabeçalho enxuto da U5: provedor/modelo/uso vivem no rodapé do composer. */
export function ChatHeader({
  onToggleSidebar,
  onVaultClick,
  sessionTitle,
  sidebarCollapsed,
  vaultActive,
  workspace,
}: ChatHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="workspace-header">
      <div className="workspace-header-primary">
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
        <nav aria-label={t("chat.breadcrumb")} className="breadcrumb">
          <ol className="breadcrumb-list">
            <li className="breadcrumb-item">
              <span className="breadcrumb-link">{workspace?.name ?? t("chat.noWorkspace")}</span>
            </li>
            {workspace?.rootPath && (
              <>
                <li aria-hidden="true" className="breadcrumb-separator">
                  /
                </li>
                <li className="breadcrumb-item">
                  <span className="breadcrumb-page breadcrumb-path" title={workspace.rootPath}>
                    {workspace.rootPath}
                  </span>
                </li>
              </>
            )}
          </ol>
        </nav>
        <h1 className="thread-title">{sessionTitle ?? t("chat.newConversation")}</h1>
      </div>
      <div className="chat-controls">
        <button
          aria-pressed={vaultActive}
          className={`header-toggle ${vaultActive ? "is-active" : ""}`}
          onClick={onVaultClick}
          type="button"
        >
          Vault
        </button>
      </div>
    </header>
  );
}

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
 * toggle da sidebar, título da sessão e controles de janela.
 *
 * Vault tem EXATAMENTE UM controle global (#218, decisão do owner): o
 * desenho é o do antigo botão interno — painel dividido com chevron que
 * aponta para recolher o painel direito quando expandido e espelha para
 * indicar reabertura no rail. Nada dentro de VaultPanel o duplica.
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
        <button
          aria-label={vaultExpanded ? t("chat.hideVault") : t("chat.showVault")}
          className={`group relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/50 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none ${
            vaultBlocked ? "opacity-50" : ""
          }`}
          data-testid="vault-toggle"
          onClick={onToggleVault}
          title={vaultExpanded ? t("chat.hideVault") : t("chat.showVault")}
          type="button"
          {...(vaultBlocked
            ? {
                // Sem workspace NÃO há alvo nem estado: omitir aria-controls/
                // aria-expanded evita referência quebrada para leitores de
                // tela; o rótulo acessível continua explicando a ação.
              }
            : { "aria-controls": "bw-vault-panel", "aria-expanded": vaultExpanded })}
        >
          {/* Ícone herdado do antigo controle interno: chevron à esquerda
          aponta para recolher o painel direito; espelhado quando rail. */}
          <span
            aria-hidden="true"
            className={`inline-block transition-transform duration-[120ms] motion-reduce:transition-none ${
              vaultExpanded ? "" : "-scale-x-100"
            }`}
          >
            <svg
              aria-hidden="true"
              className="size-4 shrink-0"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path d="M4 5h16v14H4V5Zm5 0v14M15 9l-3 3 3 3" />
            </svg>
          </span>
        </button>
        <WindowControls />
      </div>
    </header>
  );
}

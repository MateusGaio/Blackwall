// MIT License — Copyright (c) 2026 Mateus Gaio
import type { Dispatch, SetStateAction } from "react";
import type { ConnectedProvider, UsageSummary, Workspace } from "../../shared/api/sidecar";
import { CompactIcon } from "./CompactIcon";

/**
 * Headline figure is the context the conversation currently occupies (the most
 * recent request), never the cumulative sum — the same measure other harnesses
 * report, and the only one that answers "how full is this conversation?".
 */
function usageBadgeLabel(summary: UsageSummary | null, isEnglish: boolean) {
  const last = summary?.lastRequest;
  if (last && last.totalTokens > 0) {
    const tokens = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(last.totalTokens);
    return last.contextLimit && last.contextLimit > 0
      ? `${tokens} · ${Math.round((last.totalTokens / last.contextLimit) * 100)}%`
      : `${tokens} ${isEnglish ? "in context" : "no contexto"}`;
  }
  const restrictive = summary?.windows
    .filter((window) => window.remainingPercent !== undefined)
    .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0];
  if (restrictive?.remainingPercent !== undefined)
    return `${Math.round(restrictive.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`;
  return isEnglish ? "Usage unavailable" : "Uso indisponível";
}

type ChatHeaderProps = {
  activeProvider: ConnectedProvider | null;
  isEnglish: boolean;
  onOpenUsageDetails: () => void;
  onSelectProvider: (provider: ConnectedProvider) => void;
  onToggleSidebar: () => void;
  onVaultClick: () => void;
  providers: ConnectedProvider[];
  sessionTitle: string | undefined;
  setUsageOpen: Dispatch<SetStateAction<boolean>>;
  sidebarCollapsed: boolean;
  usageOpen: boolean;
  usageSummary: UsageSummary | null;
  vaultActive: boolean;
  workspace: Workspace | undefined;
};

export function ChatHeader({
  activeProvider,
  isEnglish,
  onOpenUsageDetails,
  onSelectProvider,
  onToggleSidebar,
  onVaultClick,
  providers,
  sessionTitle,
  setUsageOpen,
  sidebarCollapsed,
  usageOpen,
  usageSummary,
  vaultActive,
  workspace,
}: ChatHeaderProps) {
  return (
    <header className="workspace-header">
      <div className="workspace-header-primary">
        <button
          aria-expanded={!sidebarCollapsed}
          aria-label={
            sidebarCollapsed
              ? isEnglish
                ? "Show sidebar"
                : "Mostrar sidebar"
              : isEnglish
                ? "Hide sidebar"
                : "Esconder sidebar"
          }
          className="workspace-header-trigger"
          onClick={onToggleSidebar}
          title={
            sidebarCollapsed
              ? isEnglish
                ? "Show sidebar"
                : "Mostrar sidebar"
              : isEnglish
                ? "Hide sidebar"
                : "Esconder sidebar"
          }
          type="button"
        >
          <CompactIcon kind="panel" />
        </button>
        <nav aria-label={isEnglish ? "Breadcrumb" : "Trilha de navegação"} className="breadcrumb">
          <ol className="breadcrumb-list">
            <li className="breadcrumb-item">
              <span className="breadcrumb-link">
                {workspace?.name ?? (isEnglish ? "No workspace" : "Sem workspace")}
              </span>
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
        <h1 className="thread-title">
          {sessionTitle ?? (isEnglish ? "New conversation" : "Nova conversa")}
        </h1>
      </div>
      <div className="chat-controls">
        {providers.length > 0 ? (
          <label className="provider-selector">
            <span className="sr-only">{isEnglish ? "Provider" : "Provedor"}</span>
            <select
              aria-label={isEnglish ? "Select provider" : "Selecionar provedor"}
              onChange={(event) => {
                const nextProvider = providers.find((item) => item.id === event.target.value);
                if (nextProvider) onSelectProvider(nextProvider);
              }}
              title={isEnglish ? "Select provider" : "Selecionar provedor"}
              value={activeProvider?.id ?? ""}
            >
              {providers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="eyebrow">{isEnglish ? "no provider" : "sem provedor"}</p>
        )}
        {activeProvider && (
          <div className="usage-indicator-wrap">
            <button
              aria-expanded={usageOpen}
              className="usage-indicator"
              onClick={() => setUsageOpen((current) => !current)}
              title={isEnglish ? "Provider usage" : "Uso do provedor"}
              type="button"
            >
              {usageBadgeLabel(usageSummary, isEnglish)}
            </button>
            {usageOpen && (
              <div className="usage-popover" role="dialog">
                <strong>{isEnglish ? "Current context" : "Contexto atual"}</strong>
                <span>
                  {isEnglish ? "Tokens" : "Tokens"}:{" "}
                  {(usageSummary?.lastRequest?.totalTokens ?? 0).toLocaleString()}
                  {usageSummary?.lastRequest?.contextLimit
                    ? ` / ${usageSummary.lastRequest.contextLimit.toLocaleString()}`
                    : ""}
                </span>
                <span>
                  {isEnglish ? "Cached" : "Em cache"}:{" "}
                  {(usageSummary?.lastRequest?.cachedInputTokens ?? 0).toLocaleString()}
                </span>
                <span>
                  {isEnglish ? "Requests (cumulative)" : "Requisições (acumulado)"}:{" "}
                  {usageSummary?.totals.requests ?? 0}
                </span>
                {usageSummary?.windows.map((window) => (
                  <span key={`${window.metric}-${window.label}`}>
                    {window.label}:{" "}
                    {window.remainingPercent === undefined
                      ? isEnglish
                        ? "limit unavailable"
                        : "limite indisponível"
                      : `${Math.round(window.remainingPercent)}% ${isEnglish ? "remaining" : "restante"}`}
                  </span>
                ))}
                <button className="text-button" onClick={onOpenUsageDetails} type="button">
                  {isEnglish ? "View full usage" : "Ver uso completo"}
                </button>
              </div>
            )}
          </div>
        )}
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

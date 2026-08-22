// MIT License — Copyright (c) 2026 Mateus Gaio
import type { TFunction } from "i18next";
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectedProvider, UsageSummary, Workspace } from "../../shared/api/sidecar";
import { CompactIcon } from "./CompactIcon";

/**
 * Headline figure is the context the conversation currently occupies (the most
 * recent request), never the cumulative sum — the same measure other harnesses
 * report, and the only one that answers "how full is this conversation?".
 */
function usageBadgeLabel(summary: UsageSummary | null, t: TFunction) {
  const last = summary?.lastRequest;
  if (last && last.totalTokens > 0) {
    const tokens = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: "compact",
    }).format(last.totalTokens);
    return last.contextLimit && last.contextLimit > 0
      ? `${tokens} · ${Math.round((last.totalTokens / last.contextLimit) * 100)}%`
      : `${tokens} ${t("chat.inContext")}`;
  }
  const restrictive = summary?.windows
    .filter((window) => window.remainingPercent !== undefined)
    .sort((left, right) => (left.remainingPercent ?? 101) - (right.remainingPercent ?? 101))[0];
  if (restrictive?.remainingPercent !== undefined)
    return `${Math.round(restrictive.remainingPercent)}% ${t("chat.remaining")}`;
  return t("chat.usageUnavailable");
}

type ChatHeaderProps = {
  activeProvider: ConnectedProvider | null;
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
        {providers.length > 0 ? (
          <label className="provider-selector">
            <span className="sr-only">{t("chat.provider")}</span>
            <select
              aria-label={t("chat.selectProvider")}
              onChange={(event) => {
                const nextProvider = providers.find((item) => item.id === event.target.value);
                if (nextProvider) onSelectProvider(nextProvider);
              }}
              title={t("chat.selectProvider")}
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
          <p className="eyebrow">{t("chat.noProvider")}</p>
        )}
        {activeProvider && (
          <div className="usage-indicator-wrap">
            <button
              aria-expanded={usageOpen}
              className="usage-indicator"
              onClick={() => setUsageOpen((current) => !current)}
              title={t("chat.providerUsage")}
              type="button"
            >
              {usageBadgeLabel(usageSummary, t)}
            </button>
            {usageOpen && (
              <div className="usage-popover" role="dialog">
                <strong>{t("chat.currentContext")}</strong>
                <span>
                  {t("chat.tokens")}:{" "}
                  {(usageSummary?.lastRequest?.totalTokens ?? 0).toLocaleString()}
                  {usageSummary?.lastRequest?.contextLimit
                    ? ` / ${usageSummary.lastRequest.contextLimit.toLocaleString()}`
                    : ""}
                </span>
                <span>
                  {t("chat.cached")}:{" "}
                  {(usageSummary?.lastRequest?.cachedInputTokens ?? 0).toLocaleString()}
                </span>
                <span>
                  {t("chat.requestsCumulative")}: {usageSummary?.totals.requests ?? 0}
                </span>
                {usageSummary?.windows.map((window) => (
                  <span key={`${window.metric}-${window.label}`}>
                    {window.label}:{" "}
                    {window.remainingPercent === undefined
                      ? t("chat.limitUnavailable")
                      : `${Math.round(window.remainingPercent)}% ${t("chat.remaining")}`}
                  </span>
                ))}
                <button className="text-button" onClick={onOpenUsageDetails} type="button">
                  {t("chat.viewFullUsage")}
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

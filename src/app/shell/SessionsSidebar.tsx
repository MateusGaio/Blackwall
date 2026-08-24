// MIT License — Copyright (c) 2026 Mateus Gaio
import { type RefObject, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, SessionSummary, Workspace } from "../../shared/api/sidecar";
import { CompactIcon } from "./CompactIcon";
import { groupSessionsByWorkspace, type SessionGroup } from "./sessions-grouping";

type SessionsSidebarProps = {
  activeProfile: Profile | undefined;
  activeSessionId: string | undefined;
  collapsed: boolean;
  hasActiveProfile: boolean;
  isCreatingSession: boolean;
  name: string;
  newSession: () => void;
  newWorkspace: () => void;
  onDeleteRequest: (session: SessionSummary) => void;
  onRenameRequest: (session: SessionSummary) => void;
  onRequestCloseMenu: () => void;
  onToggleSessionMenu: (
    sessionId: string | null,
    position: { left: number; top: number } | null,
  ) => void;
  onTogglePalette: () => void;
  openSession: (sessionId: string) => void;
  openSessionMenuId: string | null;
  openWorkspace: (workspaceId: string) => void;
  recentSessions: SessionSummary[];
  recentSessionsRef: RefObject<HTMLElement | null>;
  sessionMenuPosition: { left: number; top: number } | null;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  setShowSettings: (show: boolean) => void;
  workspace: Workspace | undefined;
  workspaces: Workspace[];
};

const groupRow =
  "flex min-h-[28px] w-full items-center gap-1 rounded-md text-left transition-colors duration-[120ms] hover:bg-neutral-800/40 focus-visible:bg-neutral-800/40 focus-visible:outline-none";
const sessionRow =
  "group flex w-full items-center gap-2 rounded-md py-1.5 pl-2 pr-1.5 text-left transition-colors duration-[120ms] hover:bg-neutral-800/40 focus-visible:bg-neutral-800/40 focus-visible:outline-none";
const sectionLabel =
  "px-1 text-[0.66rem] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** Chave estável do grupo na árvore ("none" para sessões sem workspace). */
function groupKey(group: SessionGroup): string {
  return group.workspace?.id ?? "none";
}

export function SessionsSidebar({
  activeProfile,
  activeSessionId,
  collapsed,
  hasActiveProfile,
  isCreatingSession,
  name,
  newSession,
  newWorkspace,
  onDeleteRequest,
  onRenameRequest,
  onRequestCloseMenu,
  onToggleSessionMenu,
  onTogglePalette,
  openSession,
  openSessionMenuId,
  openWorkspace,
  recentSessions,
  recentSessionsRef,
  sessionMenuPosition,
  settingsButtonRef,
  setShowSettings,
  workspace,
  workspaces,
}: SessionsSidebarProps) {
  const { t } = useTranslation();
  const groups = useMemo(
    () => groupSessionsByWorkspace(recentSessions, workspaces, workspace?.id ?? null),
    [recentSessions, workspaces, workspace?.id],
  );
  // Expansão: o grupo ativo nasce aberto e segue trocas de workspace; um
  // clique do usuário tem prioridade e sobrevive a re-renders da montagem.
  const [manualExpansion, setManualExpansion] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  );

  function isGroupExpanded(group: SessionGroup): boolean {
    const manual = manualExpansion.get(groupKey(group));
    return manual ?? group.isExpandedByDefault;
  }

  function toggleGroup(key: string, nextExpanded: boolean) {
    setManualExpansion((current) => new Map(current).set(key, nextExpanded));
  }

  function openProject(groupId: string, workspaceId?: string) {
    // Abrir o projeto também expande o grupo para revelar as sessões.
    setManualExpansion((current) => new Map(current).set(groupId, true));
    if (workspaceId) openWorkspace(workspaceId);
  }

  if (collapsed) {
    // Recolhida: nenhum controle flutuante; o toggle vive no header.
    return <aside aria-label={t("sessions.workspaceNavigation")} className="w-0 shrink-0" />;
  }

  return (
    <aside
      aria-label={t("sessions.workspaceNavigation")}
      className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-neutral-800/60 bg-background"
    >
      {/* Ações primárias do topo: apenas Novo e Projetos (+ criação). */}
      <div className="px-2.5 pt-2.5 pb-1">
        <button
          aria-busy={isCreatingSession}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-sm font-medium text-foreground transition-colors duration-[120ms] hover:bg-neutral-800/50 focus-visible:bg-neutral-800/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isCreatingSession || !hasActiveProfile}
          onClick={() => void newSession()}
          type="button"
        >
          <CompactIcon kind="new-thread" />
          <span>{isCreatingSession ? t("chat.creating") : t("sessions.new")}</span>
        </button>
        <div className="mt-1 flex items-center justify-between px-1">
          <span className={sectionLabel}>{t("sessions.projects")}</span>
          <button
            aria-label={t("sessions.createWorkspace")}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/50 hover:text-foreground focus-visible:bg-neutral-800/50 focus-visible:text-foreground focus-visible:outline-none"
            onClick={() => void newWorkspace()}
            type="button"
          >
            <CompactIcon kind="new-thread" />
          </button>
        </div>
      </div>

      {/* Área integralmente reservada a projetos e sessões. */}
      <nav
        aria-label={t("sessions.threadList")}
        className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        ref={recentSessionsRef}
        tabIndex={-1}
      >
        {groups.length === 0 && (
          <p className="px-2 py-1.5 text-[0.72rem] leading-snug text-muted-foreground">
            {t("sessions.nothingFoundInPalette")}
          </p>
        )}
        {groups.map((group) => {
          const key = groupKey(group);
          const expanded = isGroupExpanded(group);
          const isActiveGroup = Boolean(group.workspace && group.workspace.id === workspace?.id);
          return (
            <div key={key} data-session-group={key}>
              <div className={`${groupRow} ${isActiveGroup ? "bg-neutral-800/30" : ""}`}>
                <button
                  aria-expanded={expanded}
                  aria-label={`${expanded ? t("sessions.collapse") : t("sessions.expand")}: ${
                    group.workspace?.name ?? t("sessions.noWorkspace")
                  }`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
                  onClick={() => toggleGroup(key, !expanded)}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`transition-transform duration-[120ms] motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
                  >
                    <CompactIcon kind="chevron" />
                  </span>
                </button>
                {group.workspace ? (
                  <button
                    className={`min-w-0 flex-1 truncate py-1 text-left text-[0.82rem] focus-visible:outline-none ${
                      isActiveGroup
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => openProject(key, group.workspace?.id)}
                    title={group.workspace.rootPath}
                    type="button"
                  >
                    {group.workspace.name}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate py-1 text-[0.82rem] text-muted-foreground">
                    {t("sessions.noWorkspace")}
                  </span>
                )}
              </div>
              {expanded &&
                group.sessions.map((session) => (
                  <div className="group relative ml-4" data-session-menu key={session.id}>
                    <button
                      aria-label={`${t("sessions.openSession")} ${session.title}`}
                      className={`${sessionRow} ${
                        session.id === activeSessionId
                          ? "bg-neutral-800/60 text-foreground"
                          : "text-muted-foreground"
                      }`}
                      onClick={() => void openSession(session.id)}
                      type="button"
                    >
                      <span aria-hidden="true" className="text-[0.6rem] opacity-60">
                        ○
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[0.8rem]" title={session.title}>
                        {session.title}
                      </span>
                    </button>
                    <button
                      aria-expanded={openSessionMenuId === session.id}
                      aria-haspopup="menu"
                      aria-label={`${t("sessions.actionsFor")} ${session.title}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-muted-foreground opacity-0 transition-opacity duration-[120ms] hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none group-hover:opacity-100"
                      onClick={(event) => {
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        const nextId = openSessionMenuId === session.id ? null : session.id;
                        onToggleSessionMenu(
                          nextId,
                          nextId
                            ? {
                                left: Math.max(8, rect.right - 142),
                                top: Math.min(window.innerHeight - 92, rect.bottom + 4),
                              }
                            : null,
                        );
                      }}
                      type="button"
                    >
                      …
                    </button>
                  </div>
                ))}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-neutral-800/60 p-2">
        <button
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/40 hover:text-foreground focus-visible:bg-neutral-800/40 focus-visible:outline-none"
          onClick={onTogglePalette}
          type="button"
        >
          <CompactIcon kind="search" />
          <span className="flex-1 truncate">{t("sessions.searchCommands")}</span>
          <kbd className="rounded border border-neutral-800 bg-[#121215] px-1.5 py-0.5 font-mono text-[0.62rem]">
            ⌘K
          </kbd>
        </button>
        <div className="mt-0.5 flex h-9 w-full items-center gap-2 rounded-md px-1.5 transition-colors duration-[120ms] hover:bg-neutral-800/40">
          {activeProfile?.avatarData ? (
            <img
              alt=""
              className="size-5 shrink-0 rounded-full object-cover"
              src={activeProfile.avatarData}
            />
          ) : (
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-800 font-mono text-[0.56rem] font-bold text-foreground"
            >
              {name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-foreground" title={name}>
            {name}
          </span>
          <button
            aria-label={t("sessions.openSettings")}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/60 hover:text-foreground focus-visible:bg-neutral-800/60 focus-visible:text-foreground focus-visible:outline-none"
            onClick={() => setShowSettings(true)}
            ref={settingsButtonRef}
            title={t("sessions.settings")}
            type="button"
          >
            <CompactIcon kind="settings" />
          </button>
        </div>
      </div>

      {openSessionMenuId && sessionMenuPosition && (
        <div
          className="session-menu session-menu-floating"
          role="menu"
          style={{ left: sessionMenuPosition.left, top: sessionMenuPosition.top }}
        >
          <button
            onClick={() => {
              const session = recentSessions.find((item) => item.id === openSessionMenuId);
              if (!session) return;
              onRequestCloseMenu();
              onRenameRequest(session);
            }}
            role="menuitem"
            type="button"
          >
            {t("sessions.rename")}
          </button>
          <button
            className="session-menu-danger"
            onClick={() => {
              const session = recentSessions.find((item) => item.id === openSessionMenuId);
              if (!session) return;
              onRequestCloseMenu();
              onDeleteRequest(session);
            }}
            role="menuitem"
            type="button"
          >
            {t("sessions.delete")}
          </button>
        </div>
      )}
    </aside>
  );
}

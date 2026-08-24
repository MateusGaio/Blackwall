// MIT License — Copyright (c) 2026 Mateus Gaio

import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, SessionSummary, Workspace } from "../../shared/api/sidecar";
import { CompactIcon } from "./CompactIcon";

export type SidebarFocusTarget = "recent" | "settings" | "workspace";

type SessionsSidebarProps = {
  activeProfile: Profile | undefined;
  activeSessionId: string | undefined;
  collapsed: boolean;
  expandSidebar: (target?: SidebarFocusTarget) => void;
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
  workspacePickerRef: RefObject<HTMLSelectElement | null>;
  workspaces: Workspace[];
};

const sessionRow =
  "group flex w-full items-center gap-2 rounded-md py-1.5 px-2 text-left transition-colors duration-[120ms] hover:bg-neutral-800/40 focus-visible:bg-neutral-800/40 focus-visible:outline-none";
const sectionLabel =
  "px-1 text-[0.66rem] font-medium uppercase tracking-[0.08em] text-muted-foreground";

export function SessionsSidebar({
  activeProfile,
  activeSessionId,
  collapsed,
  expandSidebar,
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
  workspacePickerRef,
  workspaces,
}: SessionsSidebarProps) {
  const { t } = useTranslation();

  if (collapsed) {
    return (
      <aside
        aria-label={t("sessions.workspaceNavigation")}
        className="relative w-0 shrink-0 overflow-visible"
      >
        <nav aria-label={t("sessions.sidebarShortcuts")} className="absolute bottom-3 left-2">
          <button
            aria-label={t("sessions.openSettings")}
            className="flex size-9 items-center justify-center rounded-lg border border-neutral-800 bg-[#121215] text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/60 hover:text-foreground focus-visible:outline-none"
            onClick={() => expandSidebar("settings")}
            title={t("sessions.settings")}
            type="button"
          >
            <CompactIcon kind="settings" />
          </button>
        </nav>
      </aside>
    );
  }

  return (
    <aside
      aria-label={t("sessions.workspaceNavigation")}
      className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-neutral-800/60 bg-background"
    >
      <div className="p-2.5">
        <button
          aria-busy={isCreatingSession}
          className="flex w-full items-center gap-2 rounded-lg bg-neutral-800/40 px-3 py-2 text-sm font-medium text-foreground transition-colors duration-[120ms] hover:bg-neutral-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isCreatingSession || !hasActiveProfile}
          onClick={() => void newSession()}
          type="button"
        >
          <CompactIcon kind="new-thread" />
          <span>{t("sessions.newThread")}</span>
        </button>
      </div>

      <div className="px-2.5 pb-1">
        <div className="flex items-center justify-between px-1 pb-1">
          <span className={sectionLabel}>{t("sessions.workspaces")}</span>
          <button
            aria-label={t("sessions.createWorkspace")}
            className="rounded p-0.5 text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
            onClick={() => void newWorkspace()}
            type="button"
          >
            <CompactIcon kind="new-thread" />
          </button>
        </div>
        {workspace ? (
          <div className="grid gap-1 px-1">
            <span className="relative">
              <select
                aria-label={t("sessions.currentWorkspace")}
                className="w-full cursor-pointer appearance-none truncate rounded-md border border-neutral-800 bg-[#121215] py-1.5 pl-2.5 pr-7 text-xs text-foreground transition-colors duration-[120ms] hover:border-neutral-700 focus-visible:outline-none"
                onChange={(event) => void openWorkspace(event.target.value)}
                ref={workspacePickerRef}
                value={workspace.id}
              >
                {workspaces.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                <CompactIcon kind="chevron" />
              </span>
            </span>
            <span className="truncate px-1 font-mono text-[0.66rem] text-muted-foreground">
              {workspace.rootPath}
            </span>
          </div>
        ) : (
          <div className="grid gap-1 rounded-md px-1 py-1.5">
            <strong className="text-xs text-foreground">{t("sessions.noWorkspace")}</strong>
            <span className="text-[0.68rem] leading-snug text-muted-foreground">
              {t("sessions.conversationWithoutFileContext")}
            </span>
            <button
              className="w-fit rounded px-0 py-0.5 text-left text-[0.68rem] text-muted-foreground underline-offset-2 transition-colors duration-[120ms] hover:text-foreground hover:underline focus-visible:outline-none"
              onClick={() => void newWorkspace()}
              type="button"
            >
              {t("sessions.addWorkspace")}
            </button>
          </div>
        )}
      </div>

      <div className="mx-2.5 my-2 border-t border-neutral-800/60" />

      <nav
        aria-label={t("sessions.threadList")}
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-2"
        ref={recentSessionsRef}
        tabIndex={-1}
      >
        <span className={`${sectionLabel} pb-1`}>{t("sessions.threads")}</span>
        {recentSessions.map((session) => (
          <div className="group relative" data-session-menu key={session.id}>
            <button
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
              <span className="min-w-0 flex-1 truncate text-[0.8rem]">{session.title}</span>
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
      </nav>

      <div className="border-t border-neutral-800/60 p-2">
        <button
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/40 hover:text-foreground focus-visible:outline-none"
          onClick={onTogglePalette}
          type="button"
        >
          <CompactIcon kind="search" />
          <span className="flex-1 truncate">{t("sessions.searchCommands")}</span>
          <kbd className="rounded border border-neutral-800 bg-[#121215] px-1.5 py-0.5 font-mono text-[0.62rem]">
            ⌘K
          </kbd>
        </button>
        <button
          className="mt-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors duration-[120ms] hover:bg-neutral-800/40 hover:text-foreground focus-visible:outline-none"
          onClick={() => setShowSettings(true)}
          ref={settingsButtonRef}
          type="button"
        >
          <CompactIcon kind="settings" />
          <span className="flex-1 truncate">{t("sessions.settings")}</span>
        </button>
        <div className="mt-1 flex items-center gap-2 px-2 py-1">
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
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">{name}</span>
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

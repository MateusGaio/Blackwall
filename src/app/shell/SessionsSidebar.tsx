// MIT License — Copyright (c) 2026 Mateus Gaio
import type { RefObject } from "react";
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
  isEnglish: boolean;
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

export function SessionsSidebar({
  activeProfile,
  activeSessionId,
  collapsed,
  expandSidebar,
  hasActiveProfile,
  isCreatingSession,
  isEnglish,
  name,
  newSession,
  newWorkspace,
  onDeleteRequest,
  onRenameRequest,
  onRequestCloseMenu,
  onToggleSessionMenu,
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
  return (
    <aside
      className="workspace-sidebar"
      aria-label={isEnglish ? "Workspace navigation" : "Navegação do workspace"}
    >
      <div className="sidebar-heading">
        <span aria-label="Blackwall" className="sidebar-brand-mark" role="img">
          BW
        </span>
        <div className="sidebar-profile-summary">
          {activeProfile?.avatarData ? (
            <img alt="" className="brand-mark profile-avatar" src={activeProfile.avatarData} />
          ) : null}
          <strong>{name}</strong>
        </div>
      </div>
      {collapsed && (
        <nav
          aria-label={isEnglish ? "Sidebar shortcuts" : "Atalhos da sidebar"}
          className="sidebar-rail"
        >
          <button
            aria-label={isEnglish ? "Open settings" : "Abrir configurações"}
            className="sidebar-rail-settings"
            onClick={() => expandSidebar("settings")}
            title={isEnglish ? "Settings" : "Configurações"}
            type="button"
          >
            <CompactIcon kind="settings" />
          </button>
        </nav>
      )}
      {!collapsed && (
        <div className="sidebar-actions">
          <button
            aria-busy={isCreatingSession}
            className="new-thread-button"
            disabled={isCreatingSession || !hasActiveProfile}
            onClick={() => void newSession()}
            type="button"
          >
            <CompactIcon kind="new-thread" />
            <span>{isEnglish ? "New thread" : "Nova thread"}</span>
          </button>
        </div>
      )}
      <div className="sidebar-section">
        <div className="sidebar-section-heading">
          <p className="eyebrow">Workspaces</p>
          <button
            aria-label={isEnglish ? "Create workspace" : "Criar workspace"}
            className="icon-button"
            onClick={() => void newWorkspace()}
            type="button"
          >
            +
          </button>
        </div>
        {workspace && (
          <label className="workspace-picker">
            <span className="workspace-picker-label">
              {isEnglish ? "Current workspace" : "Workspace atual"}
            </span>
            <span className="workspace-picker-control">
              <select
                aria-label={isEnglish ? "Current workspace" : "Workspace atual"}
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
              <span aria-hidden="true" className="workspace-picker-chevron">
                ⌄
              </span>
            </span>
            <span>{workspace.rootPath}</span>
          </label>
        )}
        {!workspace && (
          <div className="workspace-empty">
            <strong>{isEnglish ? "No workspace" : "Sem workspace"}</strong>
            <span>
              {isEnglish
                ? "Conversation without file context."
                : "Conversa sem contexto de arquivos."}
            </span>
            <button className="sidebar-config" onClick={() => void newWorkspace()} type="button">
              {isEnglish ? "Add workspace" : "Adicionar workspace"}
            </button>
          </div>
        )}
      </div>
      <div className="sidebar-section sidebar-sessions">
        <div className="sidebar-section-heading">
          <p className="eyebrow">{isEnglish ? "Threads" : "Conversas"}</p>
        </div>
        <nav
          aria-label={isEnglish ? "Thread list" : "Lista de conversas"}
          ref={recentSessionsRef}
          tabIndex={-1}
        >
          {recentSessions.map((session) => (
            <div className="session-row" data-session-menu key={session.id}>
              <button
                className={`session-item ${session.id === activeSessionId ? "is-active" : ""}`}
                onClick={() => void openSession(session.id)}
                type="button"
              >
                <span aria-hidden="true" className="session-icon" />
                <span className="session-copy">
                  <strong>{session.title}</strong>
                  <small>
                    {session.workspaceName ?? (isEnglish ? "No workspace" : "Sem workspace")}
                  </small>
                </span>
              </button>
              <button
                aria-expanded={openSessionMenuId === session.id}
                aria-haspopup="menu"
                aria-label={`${isEnglish ? "Actions for" : "Ações de"} ${session.title}`}
                className="session-more"
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
      </div>
      <div className="sidebar-settings">
        <button
          className="sidebar-config"
          onClick={() => setShowSettings(true)}
          ref={settingsButtonRef}
          type="button"
        >
          {isEnglish ? "Settings" : "Configurações"}
        </button>
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
            {isEnglish ? "Rename" : "Renomear"}
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
            {isEnglish ? "Delete" : "Excluir"}
          </button>
        </div>
      )}
    </aside>
  );
}

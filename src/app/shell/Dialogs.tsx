// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import type { SessionSummary } from "../../shared/api/sidecar";

type RenameSessionDialogProps = {
  onCancel: () => void;
  onRenameDraftChange: (draft: string) => void;
  onSubmit: (sessionId: string, currentTitle: string) => void;
  renameDraft: string;
  sessionToRename: { id: string; title: string } | null;
};

export function RenameSessionDialog({
  onCancel,
  onRenameDraftChange,
  onSubmit,
  renameDraft,
  sessionToRename,
}: RenameSessionDialogProps) {
  const { t } = useTranslation();
  if (!sessionToRename) return null;
  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        aria-labelledby="rename-session-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <p className="eyebrow">{t("sessions.session")}</p>
        <h2 id="rename-session-title">{t("sessions.renameConversation")}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(sessionToRename.id, sessionToRename.title);
          }}
        >
          <label className="settings-field">
            <span>{t("sessions.newName")}</span>
            <input
              onChange={(event) => onRenameDraftChange(event.target.value)}
              value={renameDraft}
            />
          </label>
          <footer className="confirm-dialog-actions">
            <button className="button button-secondary" onClick={onCancel} type="button">
              {t("sessions.cancel")}
            </button>
            <button className="button button-primary" disabled={!renameDraft.trim()} type="submit">
              {t("sessions.save")}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

type CommandPaletteProps = {
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  paletteQuery: string;
  recentSessions: SessionSummary[];
  setPaletteQuery: (query: string) => void;
};

export function CommandPalette({
  onClose,
  onOpenSession,
  onOpenSettings,
  paletteQuery,
  recentSessions,
  setPaletteQuery,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  return (
    <div className="command-backdrop" role="presentation">
      <section aria-label={t("sessions.commandPalette")} className="command-palette">
        <input
          aria-label={t("sessions.searchCommands")}
          onChange={(event) => setPaletteQuery(event.target.value)}
          placeholder={t("sessions.searchSessionsAndActions")}
          value={paletteQuery}
        />
        <div className="command-list">
          <button onClick={onOpenSettings} type="button">
            {t("sessions.openSettings")}
          </button>
          {recentSessions
            .filter((session) =>
              session.title.toLocaleLowerCase().includes(paletteQuery.toLocaleLowerCase()),
            )
            .map((session) => (
              <button
                key={session.id}
                onClick={() => {
                  onClose();
                  onOpenSession(session.id);
                }}
                type="button"
              >
                {t("sessions.openSession")}
                {session.title}
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}

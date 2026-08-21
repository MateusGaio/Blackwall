// MIT License — Copyright (c) 2026 Mateus Gaio
import type { SessionSummary } from "../../shared/api/sidecar";

type RenameSessionDialogProps = {
  isEnglish: boolean;
  onCancel: () => void;
  onRenameDraftChange: (draft: string) => void;
  onSubmit: (sessionId: string, currentTitle: string) => void;
  renameDraft: string;
  sessionToRename: { id: string; title: string } | null;
};

export function RenameSessionDialog({
  isEnglish,
  onCancel,
  onRenameDraftChange,
  onSubmit,
  renameDraft,
  sessionToRename,
}: RenameSessionDialogProps) {
  if (!sessionToRename) return null;
  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        aria-labelledby="rename-session-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <p className="eyebrow">{isEnglish ? "Session" : "Sessão"}</p>
        <h2 id="rename-session-title">{isEnglish ? "Rename conversation" : "Renomear conversa"}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(sessionToRename.id, sessionToRename.title);
          }}
        >
          <label className="settings-field">
            <span>{isEnglish ? "New name" : "Novo nome"}</span>
            <input
              onChange={(event) => onRenameDraftChange(event.target.value)}
              value={renameDraft}
            />
          </label>
          <footer className="confirm-dialog-actions">
            <button className="button button-secondary" onClick={onCancel} type="button">
              {isEnglish ? "Cancel" : "Cancelar"}
            </button>
            <button className="button button-primary" disabled={!renameDraft.trim()} type="submit">
              {isEnglish ? "Save" : "Salvar"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

type CommandPaletteProps = {
  isEnglish: boolean;
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  paletteQuery: string;
  recentSessions: SessionSummary[];
  setPaletteQuery: (query: string) => void;
};

export function CommandPalette({
  isEnglish,
  onClose,
  onOpenSession,
  onOpenSettings,
  paletteQuery,
  recentSessions,
  setPaletteQuery,
}: CommandPaletteProps) {
  return (
    <div className="command-backdrop" role="presentation">
      <section
        aria-label={isEnglish ? "Command palette" : "Paleta de comandos"}
        className="command-palette"
      >
        <input
          aria-label={isEnglish ? "Search commands" : "Pesquisar comandos"}
          onChange={(event) => setPaletteQuery(event.target.value)}
          placeholder={isEnglish ? "Search sessions and actions…" : "Pesquisar sessões e ações…"}
          value={paletteQuery}
        />
        <div className="command-list">
          <button onClick={onOpenSettings} type="button">
            {isEnglish ? "Open settings" : "Abrir configurações"}
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
                {isEnglish ? "Open session: " : "Abrir sessão: "}
                {session.title}
              </button>
            ))}
        </div>
      </section>
    </div>
  );
}

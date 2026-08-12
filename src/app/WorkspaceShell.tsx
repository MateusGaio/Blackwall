// MIT License — Copyright (c) 2026 Mateus Gaio
type WorkspaceShellProps = {
  profileName: string;
};

export default function WorkspaceShell({ profileName }: WorkspaceShellProps) {
  const name = profileName.trim() || "você";

  return (
    <main className="workspace-shell">
      <header>
        <span className="brand-mark" aria-hidden="true">
          BW
        </span>
        <p className="eyebrow">Workspace padrão</p>
      </header>
      <section className="empty-state">
        <p className="eyebrow">Pronto, {name}</p>
        <h1>Nenhuma conversa por ora — envie uma mensagem para começar.</h1>
        <p>
          A persistência local, o composer e os provedores serão conectados nas próximas etapas do
          MVP.
        </p>
      </section>
    </main>
  );
}

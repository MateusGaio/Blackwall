// MIT License — Copyright (c) 2026 Mateus Gaio
import type { ChangeEvent, FormEvent } from "react";
import type { FolderSelection } from "../../../../platform/runtime";
import type { Workspace } from "../../../../shared/api/sidecar";

type WorkspacesSectionProps = {
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  chooseBrowserFolder: (event: ChangeEvent<HTMLInputElement>) => void;
  chooseFolder: () => Promise<void>;
  isEnglish: boolean;
  isSaving: boolean;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
  profileLocale: "en" | "pt-BR";
  runtime: string;
  saveSoulDraft: (event: FormEvent<HTMLFormElement>) => void;
  setWorkspaceName: (name: string) => void;
  setWorkspaceSoulDraft: (soul: string) => void;
  submitWorkspace: (event: FormEvent<HTMLFormElement>) => void;
  workspaces: Workspace[];
  workspaceFolder: FolderSelection | null;
  workspaceName: string;
  workspaceSoul: string;
  workspaceStatus: string;
};

export function WorkspacesSection({
  activeWorkspace,
  activeWorkspaceId,
  chooseBrowserFolder,
  chooseFolder,
  isEnglish,
  isSaving,
  onWorkspaceSelected,
  profileLocale,
  runtime,
  saveSoulDraft,
  setWorkspaceName,
  setWorkspaceSoulDraft,
  submitWorkspace,
  workspaces,
  workspaceFolder,
  workspaceName,
  workspaceSoul,
  workspaceStatus,
}: WorkspacesSectionProps) {
  return (
    <section aria-labelledby="workspace-settings-title" className="settings-section">
      <p className="eyebrow" id="workspace-settings-title">
        {isEnglish ? "Workspaces" : "Workspaces"}
      </p>
      <div className="settings-workspace-list">
        {workspaces.map((workspace) => (
          <button
            className={`settings-workspace-row ${workspace.id === activeWorkspaceId ? "is-active" : ""}`}
            key={workspace.id}
            onClick={() => {
              setWorkspaceSoulDraft(workspace.soul);
              void onWorkspaceSelected(workspace);
            }}
            type="button"
          >
            <strong>{workspace.name}</strong>
            <span>{workspace.rootPath}</span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <p className="settings-empty">
            {isEnglish
              ? "No workspace folder selected."
              : "Nenhum workspace com pasta selecionada."}
          </p>
        )}
      </div>
      <form className="workspace-create-form" onSubmit={submitWorkspace}>
        <label className="field-label" htmlFor="settings-workspace-name">
          {isEnglish ? "Workspace name" : "Nome do workspace"}
          <input
            id="settings-workspace-name"
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder={isEnglish ? "My project" : "Meu projeto"}
            value={workspaceName}
          />
        </label>
        {runtime === "web" ? (
          <label className="folder-select-button settings-folder-button">
            <input
              aria-label={isEnglish ? "Choose workspace folder" : "Escolher pasta do workspace"}
              onChange={chooseBrowserFolder}
              ref={(input) => {
                input?.setAttribute("webkitdirectory", "");
                input?.setAttribute("directory", "");
              }}
              type="file"
            />
            <strong>
              {workspaceFolder?.name ?? (isEnglish ? "Choose folder" : "Escolher pasta")}
            </strong>
            <small>
              {isEnglish
                ? "Choose a folder to enable the Vault, graph and tools."
                : "Selecione uma pasta para habilitar Vault, grafo e ferramentas."}
            </small>
          </label>
        ) : (
          <button
            className="folder-select-button settings-folder-button"
            onClick={() => void chooseFolder()}
            type="button"
          >
            <strong>
              {workspaceFolder?.name ?? (isEnglish ? "Choose folder" : "Escolher pasta")}
            </strong>
            <small>
              {isEnglish
                ? "Choose a folder to enable the Vault, graph and tools."
                : "Selecione uma pasta para habilitar Vault, grafo e ferramentas."}
            </small>
          </button>
        )}
        <button
          className="button button-primary"
          disabled={isSaving || !workspaceName.trim() || !workspaceFolder}
          type="submit"
        >
          {isSaving
            ? isEnglish
              ? "Saving…"
              : "Salvando…"
            : isEnglish
              ? "Add workspace"
              : "Adicionar workspace"}
        </button>
      </form>
      {activeWorkspace && (
        <form className="workspace-soul-form" onSubmit={saveSoulDraft}>
          <label className="field-label" htmlFor="settings-workspace-soul">
            {profileLocale === "en" ? "Workspace context" : "Contexto do workspace"}
            <textarea
              id="settings-workspace-soul"
              onChange={(event) => setWorkspaceSoulDraft(event.target.value)}
              placeholder={
                profileLocale === "en"
                  ? "Describe the project, conventions and goals…"
                  : "Descreva o projeto, as convenções e os objetivos…"
              }
              rows={6}
              value={workspaceSoul}
            />
            <span className="field-hint">
              {profileLocale === "en"
                ? "Add context that should guide conversations in this workspace."
                : "Adicione o contexto que deve orientar as conversas neste workspace."}
            </span>
          </label>
          <button className="button button-secondary" disabled={isSaving} type="submit">
            {profileLocale === "en" ? "Save context" : "Salvar contexto"}
          </button>
        </form>
      )}
      {workspaceStatus && <p className="settings-status">{workspaceStatus}</p>}
    </section>
  );
}

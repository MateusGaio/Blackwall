// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FolderSelection } from "../../../../platform/runtime";
import type { Workspace } from "../../../../shared/api/sidecar";

type WorkspacesSectionProps = {
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  chooseBrowserFolder: (event: ChangeEvent<HTMLInputElement>) => void;
  chooseFolder: () => Promise<void>;
  isSaving: boolean;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
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
  isSaving,
  onWorkspaceSelected,
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
  const { t } = useTranslation();
  return (
    <section aria-labelledby="workspace-settings-title" className="settings-section">
      <p className="eyebrow" id="workspace-settings-title">
        {t("settings.workspaces")}
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
          <p className="settings-empty">{t("settings.noWorkspaceFolderSelected")}</p>
        )}
      </div>
      <form className="workspace-create-form" onSubmit={submitWorkspace}>
        <label className="field-label" htmlFor="settings-workspace-name">
          {t("settings.workspaceName")}
          <input
            id="settings-workspace-name"
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder={t("settings.myProject")}
            value={workspaceName}
          />
        </label>
        {runtime === "web" ? (
          <label className="folder-select-button settings-folder-button">
            <input
              aria-label={t("settings.chooseWorkspaceFolder")}
              onChange={chooseBrowserFolder}
              ref={(input) => {
                input?.setAttribute("webkitdirectory", "");
                input?.setAttribute("directory", "");
              }}
              type="file"
            />
            <strong>{workspaceFolder?.name ?? t("settings.chooseFolder")}</strong>
            <small>{t("settings.chooseAFolderToEnable")}</small>
          </label>
        ) : (
          <button
            className="folder-select-button settings-folder-button"
            onClick={() => void chooseFolder()}
            type="button"
          >
            <strong>{workspaceFolder?.name ?? t("settings.chooseFolder")}</strong>
            <small>{t("settings.chooseAFolderToEnable")}</small>
          </button>
        )}
        <button
          className="button button-primary"
          disabled={isSaving || !workspaceName.trim() || !workspaceFolder}
          type="submit"
        >
          {isSaving ? t("settings.saving") : t("settings.addWorkspace")}
        </button>
      </form>
      {activeWorkspace && (
        <form className="workspace-soul-form" onSubmit={saveSoulDraft}>
          <label className="field-label" htmlFor="settings-workspace-soul">
            {t("settings.workspaceContext")}
            <textarea
              id="settings-workspace-soul"
              onChange={(event) => setWorkspaceSoulDraft(event.target.value)}
              placeholder={t("settings.describeTheProjectConventionsAnd")}
              rows={6}
              value={workspaceSoul}
            />
            <span className="field-hint">{t("settings.addContextThatShouldGuide")}</span>
          </label>
          <button className="button button-secondary" disabled={isSaving} type="submit">
            {t("settings.saveContext")}
          </button>
        </form>
      )}
      {workspaceStatus && <p className="settings-status">{workspaceStatus}</p>}
    </section>
  );
}

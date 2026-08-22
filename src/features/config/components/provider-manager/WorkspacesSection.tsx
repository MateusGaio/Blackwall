// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
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

const fieldLabelClass = "grid gap-2 font-mono text-[0.72rem] text-muted-foreground";

const folderButtonClass =
  "flex items-center gap-3.5 rounded-lg border border-border bg-input/30 px-4 py-4 text-left transition-colors duration-150 hover:bg-muted focus-visible:border-ring focus-visible:outline-none";

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
    <section aria-labelledby="workspace-settings-title" className="grid gap-4">
      <p
        className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground"
        id="workspace-settings-title"
      >
        {t("settings.workspaces")}
      </p>
      <div className="grid gap-1.5">
        {workspaces.map((workspace) => (
          <button
            className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ${
              workspace.id === activeWorkspaceId
                ? "border-ring bg-accent"
                : "border-transparent hover:border-border hover:bg-muted"
            }`}
            key={workspace.id}
            onClick={() => {
              setWorkspaceSoulDraft(workspace.soul);
              void onWorkspaceSelected(workspace);
            }}
            type="button"
          >
            <strong className="block text-[0.86rem] font-medium">{workspace.name}</strong>
            <span className="font-mono text-[0.68rem] text-muted-foreground">
              {workspace.rootPath}
            </span>
          </button>
        ))}
        {workspaces.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("settings.noWorkspaceFolderSelected")}</p>
        )}
      </div>
      <form className="grid gap-3" onSubmit={submitWorkspace}>
        <label className={fieldLabelClass} htmlFor="settings-workspace-name">
          {t("settings.workspaceName")}
          <Input
            id="settings-workspace-name"
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder={t("settings.myProject")}
            value={workspaceName}
          />
        </label>
        {runtime === "web" ? (
          <label className={`${folderButtonClass} cursor-pointer`}>
            <input
              aria-label={t("settings.chooseWorkspaceFolder")}
              className="sr-only"
              onChange={chooseBrowserFolder}
              ref={(input) => {
                input?.setAttribute("webkitdirectory", "");
                input?.setAttribute("directory", "");
              }}
              type="file"
            />
            <strong>{workspaceFolder?.name ?? t("settings.chooseFolder")}</strong>
            <small className="font-mono text-[0.68rem] text-muted-foreground">
              {t("settings.chooseAFolderToEnable")}
            </small>
          </label>
        ) : (
          <button className={folderButtonClass} onClick={() => void chooseFolder()} type="button">
            <strong>{workspaceFolder?.name ?? t("settings.chooseFolder")}</strong>
            <small className="font-mono text-[0.68rem] text-muted-foreground">
              {t("settings.chooseAFolderToEnable")}
            </small>
          </button>
        )}
        <Button
          className="w-fit justify-self-end"
          disabled={isSaving || !workspaceName.trim() || !workspaceFolder}
          type="submit"
        >
          {isSaving ? t("settings.saving") : t("settings.addWorkspace")}
        </Button>
      </form>
      {activeWorkspace && (
        <form className="grid gap-3" onSubmit={saveSoulDraft}>
          <label className={fieldLabelClass} htmlFor="settings-workspace-soul">
            {t("settings.workspaceContext")}
            <Textarea
              id="settings-workspace-soul"
              onChange={(event) => setWorkspaceSoulDraft(event.target.value)}
              placeholder={t("settings.describeTheProjectConventionsAnd")}
              rows={6}
              value={workspaceSoul}
            />
            <span className="font-sans text-[0.76rem] leading-snug tracking-normal text-muted-foreground">
              {t("settings.addContextThatShouldGuide")}
            </span>
          </label>
          <Button
            className="w-fit justify-self-end"
            disabled={isSaving}
            type="submit"
            variant="secondary"
          >
            {t("settings.saveContext")}
          </Button>
        </form>
      )}
      {workspaceStatus && <p className="text-xs text-muted-foreground">{workspaceStatus}</p>}
    </section>
  );
}

// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  browserFilesToFolderSelection,
  currentRuntime,
  type FolderSelection,
  pickBrowserDirectory,
  pickDirectory,
} from "../../../../platform/runtime";
import { createWorkspace, setWorkspaceSoul, type Workspace } from "../../../../shared/api/sidecar";

type UseWorkspaceSettingsFormArgs = {
  activeWorkspace: Workspace | null;
  isEnglish: boolean;
  onWorkspaceChange: (workspace: Workspace) => void;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
  profileId: string | null;
  profileLocale: "en" | "pt-BR";
  setError: (error: string) => void;
  setIsSaving: (isSaving: boolean) => void;
};

export function useWorkspaceSettingsForm({
  activeWorkspace,
  isEnglish,
  onWorkspaceChange,
  onWorkspaceSelected,
  profileId,
  profileLocale,
  setError,
  setIsSaving,
}: UseWorkspaceSettingsFormArgs) {
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceFolder, setWorkspaceFolder] = useState<FolderSelection | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [workspaceSoul, setWorkspaceSoulDraft] = useState("");

  useEffect(() => {
    setWorkspaceSoulDraft(activeWorkspace?.soul ?? "");
  }, [activeWorkspace]);

  async function saveWorkspaceSoulDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) return;
    setIsSaving(true);
    setError("");
    setWorkspaceStatus("");
    try {
      const saved = await setWorkspaceSoul(activeWorkspace.id, workspaceSoul);
      onWorkspaceChange(saved);
      setWorkspaceStatus(
        profileLocale === "en"
          ? "Workspace context saved on this device."
          : "Contexto do workspace salvo neste dispositivo.",
      );
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error
          ? reason.message
          : profileLocale === "en"
            ? "Could not save workspace context."
            : "Não foi possível salvar o contexto do workspace.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function chooseWorkspaceFolder() {
    setWorkspaceStatus("");
    try {
      const selected =
        currentRuntime() === "web"
          ? await pickBrowserDirectory(profileLocale)
          : await pickDirectory(profileLocale);
      if (!selected) return;
      setWorkspaceFolder(selected);
      setWorkspaceName((current) => current || selected.name);
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not choose the folder."
            : "Não foi possível escolher a pasta.",
      );
    }
  }

  function chooseBrowserWorkspaceFolder(event: ChangeEvent<HTMLInputElement>) {
    void browserFilesToFolderSelection(event.target.files ?? []).then((selected) => {
      event.target.value = "";
      if (!selected) return;
      setWorkspaceFolder(selected);
      setWorkspaceName((current) => current || selected.name);
      setWorkspaceStatus("");
    });
  }

  async function submitWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profileId || !workspaceName.trim() || !workspaceFolder) return;
    setIsSaving(true);
    setWorkspaceStatus("");
    setError("");
    try {
      const created = await createWorkspace({
        name: workspaceName.trim(),
        profileId,
        rootPath: workspaceFolder.path ?? "",
        soul: "",
        workspaceFiles: workspaceFolder.files,
      });
      await onWorkspaceSelected(created);
      setWorkspaceName("");
      setWorkspaceFolder(null);
      setWorkspaceStatus(
        isEnglish ? `Workspace ${created.name} added.` : `Workspace ${created.name} adicionado.`,
      );
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not create the workspace."
            : "Não foi possível criar o workspace.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return {
    chooseBrowserWorkspaceFolder,
    chooseWorkspaceFolder,
    saveWorkspaceSoulDraft,
    setWorkspaceName,
    setWorkspaceSoulDraft,
    submitWorkspace,
    workspaceFolder,
    workspaceName,
    workspaceSoul,
    workspaceStatus,
  };
}

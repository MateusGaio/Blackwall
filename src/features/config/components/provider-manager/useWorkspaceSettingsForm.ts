// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  onWorkspaceChange: (workspace: Workspace) => void;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
  profileId: string | null;
  profileLocale: "en" | "pt-BR";
  setError: (error: string) => void;
  setIsSaving: (isSaving: boolean) => void;
};

export function useWorkspaceSettingsForm({
  activeWorkspace,
  onWorkspaceChange,
  onWorkspaceSelected,
  profileId,
  profileLocale,
  setError,
  setIsSaving,
}: UseWorkspaceSettingsFormArgs) {
  const { t } = useTranslation();
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
      setWorkspaceStatus(t("settings.workspaceContextSavedOnThis"));
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error ? reason.message : t("settings.couldNotSaveWorkspaceContext"),
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
        reason instanceof Error ? reason.message : t("settings.couldNotChooseTheFolder"),
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
      setWorkspaceStatus(t("settings.workspaceAdded", { name: created.name }));
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error ? reason.message : t("settings.couldNotCreateTheWorkspace"),
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

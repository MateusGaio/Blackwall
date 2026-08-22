// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentRuntime } from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  deleteProvider,
  type Profile,
  testProvider,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ProfileSettings } from "./provider-manager/ProfileSettings";
import { ProviderFormSection } from "./provider-manager/ProviderFormSection";
import { ProviderList } from "./provider-manager/ProviderList";
import { emptyForm, type ProviderForm } from "./provider-manager/providerForm";
import { useModelOptions } from "./provider-manager/useModelOptions";
import { useProfileSettingsForm } from "./provider-manager/useProfileSettingsForm";
import { useWorkspaceSettingsForm } from "./provider-manager/useWorkspaceSettingsForm";
import { WorkspacesSection } from "./provider-manager/WorkspacesSection";
import { UsageDashboard } from "./UsageDashboard";

type ProviderManagerProps = {
  activeSessionId?: string | null;
  activeWorkspaceId: string | null;
  activeProviderId?: string | null;
  onClose: () => void;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onProvidersChange: (providers: ConnectedProvider[]) => void;
  onProfileChange: (profile: Profile) => void;
  onSignOut: () => Promise<void>;
  onSelect: (provider: ConnectedProvider) => void;
  onWorkspaceChange: (workspace: Workspace) => void;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
  profile: Profile | null;
  profileId: string | null;
  providers: ConnectedProvider[];
  workspaces: Workspace[];
};

export function ProviderManager({
  activeSessionId,
  activeWorkspaceId,
  activeProviderId,
  onClose,
  onDeleteProfile,
  onProvidersChange,
  onProfileChange,
  onSignOut,
  onSelect,
  onWorkspaceChange,
  onWorkspaceSelected,
  profile,
  profileId,
  providers,
  workspaces,
}: ProviderManagerProps) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [providerToRemove, setProviderToRemove] = useState<ConnectedProvider | null>(null);
  const runtime = currentRuntime();

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const profileLocale = profile?.locale === "en" ? "en" : "pt-BR";

  function updateForm(field: keyof ProviderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const modelOptions = useModelOptions({
    editingId,
    form,
    onFieldChange: updateForm,
    setError,
    setStatus,
  });

  const profileSettings = useProfileSettingsForm({
    onDeleteProfile,
    onProfileChange,
    profile,
  });

  const workspaceSettings = useWorkspaceSettingsForm({
    activeWorkspace,
    onWorkspaceChange,
    onWorkspaceSelected,
    profileId,
    profileLocale,
    setError,
    setIsSaving,
  });

  function edit(provider: ConnectedProvider) {
    setEditingId(provider.id);
    setForm({
      apiKey: "",
      baseUrl: provider.baseUrl,
      model: provider.model,
      name: provider.name,
      type: provider.type,
    });
    setError("");
    setStatus("");
    modelOptions.clearModels();
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setStatus("");
    modelOptions.clearModels();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const input = {
        apiKey: form.apiKey || undefined,
        baseUrl: form.baseUrl,
        model: form.model,
        name: form.name,
        type: form.type,
      };
      const saved = editingId
        ? await updateProvider(editingId, input)
        : await connectProvider(input);
      const next = editingId
        ? providers.map((provider) => (provider.id === saved.id ? saved : provider))
        : [...providers, saved];
      onProvidersChange(next);
      onSelect(saved);
      setStatus(t("settings.providerSavedAndValidatedOn"));
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotSaveTheProvider"));
    } finally {
      setIsSaving(false);
    }
  }

  async function testCurrent() {
    setError("");
    setStatus("");
    try {
      await testProvider({ ...form, apiKey: form.apiKey || undefined });
      setStatus(t("settings.connectionValidated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotTestTheProvider"));
    }
  }

  async function remove(provider: ConnectedProvider) {
    try {
      await deleteProvider(provider.id);
      const next = providers.filter((item) => item.id !== provider.id);
      onProvidersChange(next);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotRemoveTheProvider"));
    }
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <button
        aria-label={t("settings.closeSettings")}
        className="settings-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={isSaving || profileSettings.isSavingProfile}
        aria-label={t("settings.providerSettings")}
        className="settings-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        tabIndex={-1}
      >
        <header className="settings-panel-header">
          <div>
            <p className="eyebrow">{t("settings.settings")}</p>
            <h2>{t("settings.profileWorkspacesAndProviders")}</h2>
          </div>
          <button
            aria-label={t("settings.closeSettings")}
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <UsageDashboard
          activeProviderId={activeProviderId}
          activeSessionId={activeSessionId}
          profileId={profileId}
          providers={providers}
        />
        <ProfileSettings
          isSavingProfile={profileSettings.isSavingProfile}
          onAvatarChange={profileSettings.chooseProfileAvatar}
          onSave={profileSettings.saveProfile}
          profileAvatar={profileSettings.profileAvatar}
          profileError={profileSettings.profileError}
          profileName={profileSettings.profileName}
          profileSoul={profileSettings.profileSoul}
          profileStatus={profileSettings.profileStatus}
          setProfileAvatar={profileSettings.setProfileAvatar}
          setProfileName={profileSettings.setProfileName}
          setProfileSoul={profileSettings.setProfileSoul}
        />
        <WorkspacesSection
          activeWorkspace={activeWorkspace}
          activeWorkspaceId={activeWorkspaceId}
          chooseBrowserFolder={workspaceSettings.chooseBrowserWorkspaceFolder}
          chooseFolder={workspaceSettings.chooseWorkspaceFolder}
          isSaving={isSaving}
          onWorkspaceSelected={onWorkspaceSelected}
          runtime={runtime}
          saveSoulDraft={workspaceSettings.saveWorkspaceSoulDraft}
          setWorkspaceName={workspaceSettings.setWorkspaceName}
          setWorkspaceSoulDraft={workspaceSettings.setWorkspaceSoulDraft}
          submitWorkspace={workspaceSettings.submitWorkspace}
          workspaces={workspaces}
          workspaceFolder={workspaceSettings.workspaceFolder}
          workspaceName={workspaceSettings.workspaceName}
          workspaceSoul={workspaceSettings.workspaceSoul}
          workspaceStatus={workspaceSettings.workspaceStatus}
        />
        <ProviderList
          onEdit={edit}
          onRemoveRequest={setProviderToRemove}
          onSelect={onSelect}
          providers={providers}
        />
        <ProviderFormSection
          editingId={editingId}
          error={error}
          form={form}
          isDeletingProfile={profileSettings.isDeletingProfile}
          isSaving={isSaving}
          modelOptions={modelOptions}
          onSignOut={onSignOut}
          onSubmit={submit}
          onTest={testCurrent}
          profile={profile}
          requestDeleteProfile={() => profileSettings.setProfileToDelete(profile)}
          reset={reset}
          setFormField={updateForm}
          status={status}
        />
      </section>
      {providerToRemove && (
        <ConfirmDialog
          confirmLabel={t("settings.removeProvider")}
          description={t("settings.removeProviderDescription", {
            name: providerToRemove.name,
          })}
          onCancel={() => setProviderToRemove(null)}
          onConfirm={() => {
            const provider = providerToRemove;
            setProviderToRemove(null);
            void remove(provider);
          }}
          headingLabel={t("settings.confirmation")}
          title={`${t("settings.remove")} ${providerToRemove.name}?`}
        />
      )}
      {profileSettings.profileToDelete && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.deleteProfile")}
          description={t("settings.allSessionsWorkspacesMessagesAnd")}
          onCancel={() => profileSettings.setProfileToDelete(null)}
          onConfirm={() => {
            profileSettings.setProfileToDelete(null);
            void profileSettings.removeProfile();
          }}
          headingLabel={t("settings.confirmation")}
          title={`${t("settings.delete")} ${profileSettings.profileToDelete.name}?`}
        />
      )}
    </div>
  );
}

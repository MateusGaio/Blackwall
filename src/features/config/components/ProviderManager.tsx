// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
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
  const isEnglish = profileLocale === "en";

  function updateForm(field: keyof ProviderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const modelOptions = useModelOptions({
    editingId,
    form,
    isEnglish,
    onFieldChange: updateForm,
    setError,
    setStatus,
  });

  const profileSettings = useProfileSettingsForm({
    isEnglish,
    onDeleteProfile,
    onProfileChange,
    profile,
  });

  const workspaceSettings = useWorkspaceSettingsForm({
    activeWorkspace,
    isEnglish,
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
      setStatus(
        isEnglish
          ? "Provider saved and validated on this device."
          : "Provedor salvo e validado neste dispositivo.",
      );
      reset();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save the provider."
            : "Não foi possível salvar o provedor.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function testCurrent() {
    setError("");
    setStatus("");
    try {
      await testProvider({ ...form, apiKey: form.apiKey || undefined });
      setStatus(isEnglish ? "Connection validated." : "Conexão validada.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not test the provider."
            : "Não foi possível testar o provedor.",
      );
    }
  }

  async function remove(provider: ConnectedProvider) {
    try {
      await deleteProvider(provider.id);
      const next = providers.filter((item) => item.id !== provider.id);
      onProvidersChange(next);
      reset();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not remove the provider."
            : "Não foi possível remover o provedor.",
      );
    }
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <button
        aria-label={isEnglish ? "Close settings" : "Fechar configurações"}
        className="settings-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={isSaving || profileSettings.isSavingProfile}
        aria-label={isEnglish ? "Provider settings" : "Configurações de provedores"}
        className="settings-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        tabIndex={-1}
      >
        <header className="settings-panel-header">
          <div>
            <p className="eyebrow">{isEnglish ? "Settings" : "Configurações"}</p>
            <h2>
              {isEnglish ? "Profile, workspaces and providers" : "Perfil, workspaces e provedores"}
            </h2>
          </div>
          <button
            aria-label={isEnglish ? "Close settings" : "Fechar configurações"}
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
          isEnglish={isEnglish}
          profileId={profileId}
          providers={providers}
        />
        <ProfileSettings
          isEnglish={isEnglish}
          isSavingProfile={profileSettings.isSavingProfile}
          onAvatarChange={profileSettings.chooseProfileAvatar}
          onSave={profileSettings.saveProfile}
          profileAvatar={profileSettings.profileAvatar}
          profileError={profileSettings.profileError}
          profileLocale={profileLocale}
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
          isEnglish={isEnglish}
          isSaving={isSaving}
          onWorkspaceSelected={onWorkspaceSelected}
          profileLocale={profileLocale}
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
          isEnglish={isEnglish}
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
          isEnglish={isEnglish}
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
          confirmLabel={isEnglish ? "Remove provider" : "Remover provedor"}
          description={
            isEnglish
              ? `The ${providerToRemove.name} configuration will be removed from this device.`
              : `A configuração de ${providerToRemove.name} será removida deste dispositivo.`
          }
          onCancel={() => setProviderToRemove(null)}
          onConfirm={() => {
            const provider = providerToRemove;
            setProviderToRemove(null);
            void remove(provider);
          }}
          headingLabel={isEnglish ? "Confirmation" : "Confirmação"}
          title={`${isEnglish ? "Remove" : "Remover"} ${providerToRemove.name}?`}
        />
      )}
      {profileSettings.profileToDelete && (
        <ConfirmDialog
          cancelLabel={isEnglish ? "Cancel" : "Cancelar"}
          confirmLabel={isEnglish ? "Delete profile" : "Excluir perfil"}
          description={
            isEnglish
              ? "All sessions, workspaces, messages and attachments from this profile will be removed from this device. This cannot be undone."
              : "Todas as sessões, workspaces, mensagens e anexos deste perfil serão removidos deste dispositivo. Essa ação é definitiva."
          }
          onCancel={() => profileSettings.setProfileToDelete(null)}
          onConfirm={() => {
            profileSettings.setProfileToDelete(null);
            void profileSettings.removeProfile();
          }}
          headingLabel={isEnglish ? "Confirmation" : "Confirmação"}
          title={`${isEnglish ? "Delete" : "Excluir"} ${profileSettings.profileToDelete.name}?`}
        />
      )}
    </div>
  );
}

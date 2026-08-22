// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import { currentRuntime } from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  deleteProvider,
  type Profile,
  type ProviderModel,
  testProvider,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ProfileSettings } from "./provider-manager/ProfileSettings";
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
        <form className="provider-form settings-form" onSubmit={submit}>
          <p className="eyebrow">
            {editingId
              ? isEnglish
                ? "Edit provider"
                : "Editar provedor"
              : isEnglish
                ? "Add provider"
                : "Adicionar provedor"}
          </p>
          <label className="field-label" htmlFor="settings-provider-type">
            {isEnglish ? "Type" : "Tipo"}
            <select
              id="settings-provider-type"
              onChange={(event) => updateForm("type", event.target.value)}
              value={form.type}
            >
              <option value="ollama">Ollama local</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>
          <label className="field-label" htmlFor="settings-provider-name">
            {isEnglish ? "Name" : "Nome"}
            <input
              id="settings-provider-name"
              onChange={(event) => updateForm("name", event.target.value)}
              value={form.name}
            />
          </label>
          <label className="field-label" htmlFor="settings-provider-url">
            Endpoint
            <input
              id="settings-provider-url"
              onChange={(event) => updateForm("baseUrl", event.target.value)}
              value={form.baseUrl}
            />
          </label>
          <label className="field-label" htmlFor="settings-provider-model">
            {isEnglish ? "Default model" : "Modelo padrão"}
            <div className="model-input-row">
              <input
                id="settings-provider-model"
                onChange={(event) => updateForm("model", event.target.value)}
                value={form.model}
              />
              <button
                className="button button-secondary"
                disabled={
                  modelOptions.isListingModels ||
                  (!editingId && form.type === "openai-compatible" && !form.apiKey.trim())
                }
                onClick={() => void modelOptions.listModels()}
                type="button"
              >
                {modelOptions.isListingModels
                  ? isEnglish
                    ? "Listing…"
                    : "Listando…"
                  : isEnglish
                    ? "List models"
                    : "Listar modelos"}
              </button>
            </div>
            {modelOptions.providerModels.length > 0 && (
              <select
                aria-label={isEnglish ? "Available models" : "Modelos disponíveis"}
                onChange={(event) => updateForm("model", event.target.value)}
                value={form.model}
              >
                {modelOptions.providerModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            {editingId && modelOptions.providerModels.length > 0 && (
              <>
                <select
                  aria-label={isEnglish ? "Tool calling mode" : "Modo de ferramentas"}
                  onChange={(event) =>
                    void modelOptions.changeToolMode(
                      event.target.value as ProviderModel["toolMode"],
                    )
                  }
                  value={modelOptions.toolMode}
                >
                  <option value="auto">
                    {isEnglish ? "Native tools (automatic)" : "Ferramentas nativas (automático)"}
                  </option>
                  <option value="compatibility">
                    {isEnglish ? "Compatibility JSON (opt-in)" : "JSON de compatibilidade (opt-in)"}
                  </option>
                  <option value="disabled">{isEnglish ? "Disabled" : "Desativado"}</option>
                </select>
                <select
                  aria-label={isEnglish ? "Protocol preference" : "Preferência de protocolo"}
                  onChange={(event) =>
                    void modelOptions.changeProtocol(
                      event.target.value as NonNullable<ProviderModel["protocolPreference"]>,
                    )
                  }
                  value={modelOptions.protocolPreference}
                >
                  <option value="auto">
                    {isEnglish ? "Protocol: automatic" : "Protocolo: automático"}
                  </option>
                  <option value="openai-chat">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                </select>
                <select
                  aria-label={
                    isEnglish ? "Parallel tool calls" : "Chamadas de ferramenta paralelas"
                  }
                  onChange={(event) =>
                    void modelOptions.changeParallelToolCalls(
                      event.target.value as ProviderModel["parallelToolCalls"],
                    )
                  }
                  value={modelOptions.parallelToolCalls}
                >
                  <option value="auto">
                    {isEnglish
                      ? "Parallel calls: automatic (on for OpenRouter only)"
                      : "Chamadas paralelas: automático (ligado só na OpenRouter)"}
                  </option>
                  <option value="enabled">
                    {isEnglish ? "Parallel calls: force on" : "Chamadas paralelas: forçar ligado"}
                  </option>
                  <option value="disabled">
                    {isEnglish
                      ? "Parallel calls: force off"
                      : "Chamadas paralelas: forçar desligado"}
                  </option>
                </select>
                <div className="provider-model-capability" aria-live="polite">
                  {(() => {
                    const selected = modelOptions.providerModels.find(
                      (model) => model.id === form.model,
                    );
                    const support = selected?.toolSupport ?? "unknown";
                    return support === "native"
                      ? isEnglish
                        ? "Native tools · verified"
                        : "Ferramentas nativas · verificado"
                      : support === "unsupported"
                        ? isEnglish
                          ? "This model does not advertise tools"
                          : "Este modelo não anuncia ferramentas"
                        : support === "probe-error"
                          ? isEnglish
                            ? "Tool probe failed"
                            : "O teste de ferramentas falhou"
                          : isEnglish
                            ? "Tool support not tested"
                            : "Suporte a ferramentas não testado";
                  })()}
                </div>
                <button
                  className="button button-secondary"
                  disabled={modelOptions.isProbingTools}
                  onClick={() => void modelOptions.probeTools()}
                  type="button"
                >
                  {modelOptions.isProbingTools
                    ? isEnglish
                      ? "Testing…"
                      : "Testando…"
                    : isEnglish
                      ? "Test tools"
                      : "Testar ferramentas"}
                </button>
              </>
            )}
          </label>
          {form.type === "openai-compatible" && (
            <label className="field-label" htmlFor="settings-provider-key">
              {isEnglish ? "API key" : "Chave de API"}
              <input
                autoComplete="off"
                id="settings-provider-key"
                onChange={(event) => updateForm("apiKey", event.target.value)}
                placeholder={
                  editingId ? (isEnglish ? "Keep current key" : "Manter chave atual") : "sk-…"
                }
                type="password"
                value={form.apiKey}
              />
            </label>
          )}
          <div className="settings-actions">
            <button
              className="button button-secondary"
              disabled={isSaving}
              onClick={() => void testCurrent()}
              type="button"
            >
              {isEnglish ? "Test" : "Testar"}
            </button>
            <button
              className="button button-primary"
              disabled={isSaving || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
              type="submit"
            >
              {isSaving ? (isEnglish ? "Saving…" : "Salvando…") : isEnglish ? "Save" : "Salvar"}
            </button>
            {editingId && (
              <button className="text-button" onClick={reset} type="button">
                {isEnglish ? "Cancel" : "Cancelar"}
              </button>
            )}
            <button
              className="text-button danger settings-sign-out"
              onClick={() => void onSignOut()}
              type="button"
            >
              {isEnglish ? "Sign out" : "Sair do perfil"}
            </button>
            {profile && (
              <button
                className="text-button danger settings-delete-profile"
                disabled={profileSettings.isDeletingProfile}
                onClick={() => profileSettings.setProfileToDelete(profile)}
                type="button"
              >
                {isEnglish ? "Delete profile" : "Excluir perfil"}
              </button>
            )}
          </div>
          {status && <p className="settings-status">{status}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </form>
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

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
import { SoulPicker } from "../../../shared/components/SoulPicker";
import { emptyForm, type ProviderForm } from "./provider-manager/providerForm";
import { useModelOptions } from "./provider-manager/useModelOptions";
import { useProfileSettingsForm } from "./provider-manager/useProfileSettingsForm";
import { useWorkspaceSettingsForm } from "./provider-manager/useWorkspaceSettingsForm";
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
        <form className="settings-section profile-settings" onSubmit={profileSettings.saveProfile}>
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">{isEnglish ? "Profile" : "Perfil"}</p>
              <h3>{isEnglish ? "What should we call you?" : "Como você quer ser chamado?"}</h3>
            </div>
            <div className="profile-avatar-preview" aria-hidden="true">
              {profileSettings.profileAvatar ? (
                <img alt="" src={profileSettings.profileAvatar} />
              ) : (
                <span>BW</span>
              )}
            </div>
          </div>
          <label className="field-label" htmlFor="settings-profile-name">
            {isEnglish ? "Name" : "Nome"}
            <input
              id="settings-profile-name"
              onChange={(event) => profileSettings.setProfileName(event.target.value)}
              value={profileSettings.profileName}
            />
          </label>
          <div className="profile-avatar-actions">
            <label className="button button-secondary" htmlFor="settings-profile-avatar">
              {isEnglish ? "Change photo" : "Alterar foto"}
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                id="settings-profile-avatar"
                onChange={profileSettings.chooseProfileAvatar}
                type="file"
              />
            </label>
            {profileSettings.profileAvatar && (
              <button
                className="text-button"
                onClick={() => profileSettings.setProfileAvatar(null)}
                type="button"
              >
                {isEnglish ? "Remove photo" : "Remover foto"}
              </button>
            )}
            <small>
              {isEnglish
                ? "PNG, JPEG, WebP or GIF · up to 2 MB · stays on this device"
                : "PNG, JPEG, WebP ou GIF · até 2 MB · fica somente neste dispositivo"}
            </small>
          </div>
          <SoulPicker
            hint={
              isEnglish
                ? "Choose a ready-made personality or write your own prompt."
                : "Escolha uma personalidade pronta ou escreva seu próprio prompt."
            }
            id="settings-profile-soul"
            label={isEnglish ? "Profile Soul" : "Soul do perfil"}
            locale={profileLocale}
            onChange={profileSettings.setProfileSoul}
            rows={4}
            value={profileSettings.profileSoul}
          />
          <div className="settings-actions">
            <button
              className="button button-primary"
              disabled={
                profileSettings.isSavingProfile ||
                !profileSettings.profileName.trim() ||
                !profileSettings.profileSoul.trim()
              }
              type="submit"
            >
              {profileSettings.isSavingProfile
                ? isEnglish
                  ? "Saving…"
                  : "Salvando…"
                : isEnglish
                  ? "Save profile"
                  : "Salvar perfil"}
            </button>
          </div>
          {profileSettings.profileStatus && (
            <p className="settings-status">{profileSettings.profileStatus}</p>
          )}
          {profileSettings.profileError && (
            <p className="form-error" role="alert">
              {profileSettings.profileError}
            </p>
          )}
        </form>
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
                  workspaceSettings.setWorkspaceSoulDraft(workspace.soul);
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
          <form className="workspace-create-form" onSubmit={workspaceSettings.submitWorkspace}>
            <label className="field-label" htmlFor="settings-workspace-name">
              {isEnglish ? "Workspace name" : "Nome do workspace"}
              <input
                id="settings-workspace-name"
                onChange={(event) => workspaceSettings.setWorkspaceName(event.target.value)}
                placeholder={isEnglish ? "My project" : "Meu projeto"}
                value={workspaceSettings.workspaceName}
              />
            </label>
            {runtime === "web" ? (
              <label className="folder-select-button settings-folder-button">
                <input
                  aria-label={isEnglish ? "Choose workspace folder" : "Escolher pasta do workspace"}
                  onChange={workspaceSettings.chooseBrowserWorkspaceFolder}
                  ref={(input) => {
                    input?.setAttribute("webkitdirectory", "");
                    input?.setAttribute("directory", "");
                  }}
                  type="file"
                />
                <strong>
                  {workspaceSettings.workspaceFolder?.name ??
                    (isEnglish ? "Choose folder" : "Escolher pasta")}
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
                onClick={() => void workspaceSettings.chooseWorkspaceFolder()}
                type="button"
              >
                <strong>
                  {workspaceSettings.workspaceFolder?.name ??
                    (isEnglish ? "Choose folder" : "Escolher pasta")}
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
              disabled={
                isSaving ||
                !workspaceSettings.workspaceName.trim() ||
                !workspaceSettings.workspaceFolder
              }
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
            <form
              className="workspace-soul-form"
              onSubmit={workspaceSettings.saveWorkspaceSoulDraft}
            >
              <label className="field-label" htmlFor="settings-workspace-soul">
                {profileLocale === "en" ? "Workspace context" : "Contexto do workspace"}
                <textarea
                  id="settings-workspace-soul"
                  onChange={(event) => workspaceSettings.setWorkspaceSoulDraft(event.target.value)}
                  placeholder={
                    profileLocale === "en"
                      ? "Describe the project, conventions and goals…"
                      : "Descreva o projeto, as convenções e os objetivos…"
                  }
                  rows={6}
                  value={workspaceSettings.workspaceSoul}
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
          {workspaceSettings.workspaceStatus && (
            <p className="settings-status">{workspaceSettings.workspaceStatus}</p>
          )}
        </section>
        <div className="provider-list">
          {providers.map((provider) => (
            <article className="provider-row" key={provider.id}>
              <button onClick={() => onSelect(provider)} type="button">
                <strong>{provider.name}</strong>
                <span>
                  {provider.type} · {provider.model || (isEnglish ? "no model" : "sem modelo")}
                </span>
              </button>
              <div>
                <button className="text-button" onClick={() => edit(provider)} type="button">
                  {isEnglish ? "Edit" : "Editar"}
                </button>
                <button
                  className="text-button danger"
                  onClick={() => setProviderToRemove(provider)}
                  type="button"
                >
                  {isEnglish ? "Remove" : "Remover"}
                </button>
              </div>
            </article>
          ))}
          {providers.length === 0 && (
            <p className="settings-empty">
              {isEnglish ? "No providers configured." : "Nenhum provedor configurado."}
            </p>
          )}
        </div>
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

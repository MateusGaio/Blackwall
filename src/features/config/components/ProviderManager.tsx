// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import {
  browserFilesToFolderSelection,
  currentRuntime,
  type FolderSelection,
  pickBrowserDirectory,
  pickDirectory,
} from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  createWorkspace,
  deleteProvider,
  discoverProviderModels,
  type Profile,
  type ProviderModel,
  probeProviderModel,
  setProviderModelProtocol,
  setProviderModelToolMode,
  setWorkspaceSoul,
  testProvider,
  updateProfile,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { SoulPicker } from "../../../shared/components/SoulPicker";
import { UsageDashboard } from "./UsageDashboard";

type ProviderManagerProps = {
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

type ProviderForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
  name: string;
  type: ConnectedProvider["type"];
};

const emptyForm: ProviderForm = {
  apiKey: "",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  name: "Ollama local",
  type: "ollama",
};

export function ProviderManager({
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
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceFolder, setWorkspaceFolder] = useState<FolderSelection | null>(null);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const [providerToRemove, setProviderToRemove] = useState<ConnectedProvider | null>(null);
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [profileName, setProfileName] = useState(profile?.name ?? "");
  const [profileSoul, setProfileSoul] = useState(profile?.soul ?? "");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(profile?.avatarData ?? null);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [workspaceSoul, setWorkspaceSoulDraft] = useState("");
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([]);
  const [isListingModels, setIsListingModels] = useState(false);
  const [toolMode, setToolMode] = useState<ProviderModel["toolMode"]>("auto");
  const [protocolPreference, setProtocolPreference] =
    useState<ProviderModel["protocolPreference"]>("auto");
  const [isProbingTools, setIsProbingTools] = useState(false);
  const runtime = currentRuntime();

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const profileLocale = profile?.locale === "en" ? "en" : "pt-BR";
  const isEnglish = profileLocale === "en";

  useEffect(() => {
    setProfileName(profile?.name ?? "");
    setProfileSoul(profile?.soul ?? "");
    setProfileAvatar(profile?.avatarData ?? null);
  }, [profile]);

  useEffect(() => {
    setWorkspaceSoulDraft(activeWorkspace?.soul ?? "");
  }, [activeWorkspace]);

  function updateForm(field: keyof ProviderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

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
    setProviderModels([]);
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setStatus("");
    setProviderModels([]);
  }

  async function listModels() {
    setError("");
    setIsListingModels(true);
    try {
      const listed = await discoverProviderModels({
        apiKey: form.apiKey || undefined,
        baseUrl: form.baseUrl,
        id: editingId ?? undefined,
        name: form.name,
        type: form.type,
      });
      setProviderModels(listed);
      setToolMode(
        listed.find((model) => model.id === (form.model || listed[0]?.id))?.toolMode ?? "auto",
      );
      setProtocolPreference(
        listed.find((model) => model.id === (form.model || listed[0]?.id))?.protocolPreference ??
          "auto",
      );
      if (!form.model && listed[0]) updateForm("model", listed[0].id);
      if (!listed.length)
        setStatus(
          isEnglish
            ? "This provider returned no models."
            : "Nenhum modelo foi retornado por este provedor.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not list models."
            : "Não foi possível listar os modelos.",
      );
    } finally {
      setIsListingModels(false);
    }
  }

  async function changeProtocol(next: NonNullable<ProviderModel["protocolPreference"]>) {
    setProtocolPreference(next);
    if (!editingId || !form.model) return;
    try {
      await setProviderModelProtocol(editingId, form.model, next);
      setStatus(isEnglish ? "Protocol preference saved." : "Preferência de protocolo salva.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save protocol."
            : "Não foi possível salvar o protocolo.",
      );
    }
  }

  async function probeTools() {
    if (!editingId || !form.model) return;
    setIsProbingTools(true);
    setError("");
    try {
      const probed = await probeProviderModel(
        editingId,
        form.model,
        protocolPreference === "auto"
          ? undefined
          : protocolPreference === "openai-responses"
            ? "openai-responses"
            : "openai-chat",
      );
      setProviderModels((current) =>
        current.map((model) => (model.id === probed.id ? { ...model, ...probed } : model)),
      );
      setStatus(isEnglish ? "Tool support checked." : "Suporte a ferramentas verificado.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not test tools."
            : "Não foi possível testar as ferramentas.",
      );
    } finally {
      setIsProbingTools(false);
    }
  }

  async function changeToolMode(next: ProviderModel["toolMode"]) {
    setToolMode(next);
    if (!editingId || !form.model || !next) return;
    try {
      await setProviderModelToolMode(editingId, form.model, next);
      setStatus(isEnglish ? "Tool mode saved." : "Modo de ferramentas salvo.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save tool mode."
            : "Não foi possível salvar o modo de ferramentas.",
      );
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setIsSavingProfile(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const saved = await updateProfile(profile.id, {
        avatarData: profileAvatar,
        name: profileName,
        soul: profileSoul,
      });
      onProfileChange(saved);
      setProfileStatus(
        isEnglish ? "Profile saved on this device." : "Perfil salvo neste dispositivo.",
      );
    } catch (reason) {
      setProfileError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save the profile."
            : "Não foi possível salvar o perfil.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  function chooseProfileAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setProfileError(
        isEnglish
          ? "Choose a PNG, JPEG, WebP or GIF image up to 2 MB."
          : "Escolha uma imagem PNG, JPEG, WebP ou GIF de até 2 MB.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setProfileAvatar(result);
        setProfileError("");
        setProfileStatus(isEnglish ? "Photo ready to save." : "Foto pronta para salvar.");
      }
    };
    reader.onerror = () =>
      setProfileError(
        isEnglish ? "Could not read this image." : "Não foi possível ler essa imagem.",
      );
    reader.readAsDataURL(file);
  }

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

  async function removeProfile() {
    if (!profile) return;
    setIsDeletingProfile(true);
    setProfileError("");
    try {
      await onDeleteProfile(profile.id);
    } catch (reason) {
      setProfileError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not delete the profile."
            : "Não foi possível excluir o perfil.",
      );
    } finally {
      setIsDeletingProfile(false);
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

  return (
    <div className="settings-backdrop" role="presentation">
      <button
        aria-label={isEnglish ? "Close settings" : "Fechar configurações"}
        className="settings-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={isSaving || isSavingProfile}
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
          isEnglish={isEnglish}
          profileId={profileId}
          providers={providers}
        />
        <form className="settings-section profile-settings" onSubmit={saveProfile}>
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">{isEnglish ? "Profile" : "Perfil"}</p>
              <h3>{isEnglish ? "What should we call you?" : "Como você quer ser chamado?"}</h3>
            </div>
            <div className="profile-avatar-preview" aria-hidden="true">
              {profileAvatar ? <img alt="" src={profileAvatar} /> : <span>BW</span>}
            </div>
          </div>
          <label className="field-label" htmlFor="settings-profile-name">
            {isEnglish ? "Name" : "Nome"}
            <input
              id="settings-profile-name"
              onChange={(event) => setProfileName(event.target.value)}
              value={profileName}
            />
          </label>
          <div className="profile-avatar-actions">
            <label className="button button-secondary" htmlFor="settings-profile-avatar">
              {isEnglish ? "Change photo" : "Alterar foto"}
              <input
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                id="settings-profile-avatar"
                onChange={chooseProfileAvatar}
                type="file"
              />
            </label>
            {profileAvatar && (
              <button className="text-button" onClick={() => setProfileAvatar(null)} type="button">
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
            onChange={setProfileSoul}
            rows={4}
            value={profileSoul}
          />
          <div className="settings-actions">
            <button
              className="button button-primary"
              disabled={isSavingProfile || !profileName.trim() || !profileSoul.trim()}
              type="submit"
            >
              {isSavingProfile
                ? isEnglish
                  ? "Saving…"
                  : "Salvando…"
                : isEnglish
                  ? "Save profile"
                  : "Salvar perfil"}
            </button>
          </div>
          {profileStatus && <p className="settings-status">{profileStatus}</p>}
          {profileError && (
            <p className="form-error" role="alert">
              {profileError}
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
                  onChange={chooseBrowserWorkspaceFolder}
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
                onClick={() => void chooseWorkspaceFolder()}
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
            <form className="workspace-soul-form" onSubmit={saveWorkspaceSoulDraft}>
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
                  isListingModels ||
                  (!editingId && form.type === "openai-compatible" && !form.apiKey.trim())
                }
                onClick={() => void listModels()}
                type="button"
              >
                {isListingModels
                  ? isEnglish
                    ? "Listing…"
                    : "Listando…"
                  : isEnglish
                    ? "List models"
                    : "Listar modelos"}
              </button>
            </div>
            {providerModels.length > 0 && (
              <select
                aria-label={isEnglish ? "Available models" : "Modelos disponíveis"}
                onChange={(event) => updateForm("model", event.target.value)}
                value={form.model}
              >
                {providerModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
            )}
            {editingId && providerModels.length > 0 && (
              <>
                <select
                  aria-label={isEnglish ? "Tool calling mode" : "Modo de ferramentas"}
                  onChange={(event) =>
                    void changeToolMode(event.target.value as ProviderModel["toolMode"])
                  }
                  value={toolMode}
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
                    void changeProtocol(
                      event.target.value as NonNullable<ProviderModel["protocolPreference"]>,
                    )
                  }
                  value={protocolPreference}
                >
                  <option value="auto">
                    {isEnglish ? "Protocol: automatic" : "Protocolo: automático"}
                  </option>
                  <option value="openai-chat">OpenAI Chat Completions</option>
                  <option value="openai-responses">OpenAI Responses</option>
                </select>
                <div className="provider-model-capability" aria-live="polite">
                  {(() => {
                    const selected = providerModels.find((model) => model.id === form.model);
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
                  disabled={isProbingTools}
                  onClick={() => void probeTools()}
                  type="button"
                >
                  {isProbingTools
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
                disabled={isDeletingProfile}
                onClick={() => setProfileToDelete(profile)}
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
      {profileToDelete && (
        <ConfirmDialog
          cancelLabel={isEnglish ? "Cancel" : "Cancelar"}
          confirmLabel={isEnglish ? "Delete profile" : "Excluir perfil"}
          description={
            isEnglish
              ? "All sessions, workspaces, messages and attachments from this profile will be removed from this device. This cannot be undone."
              : "Todas as sessões, workspaces, mensagens e anexos deste perfil serão removidos deste dispositivo. Essa ação é definitiva."
          }
          onCancel={() => setProfileToDelete(null)}
          onConfirm={() => {
            setProfileToDelete(null);
            void removeProfile();
          }}
          headingLabel={isEnglish ? "Confirmation" : "Confirmação"}
          title={`${isEnglish ? "Delete" : "Excluir"} ${profileToDelete.name}?`}
        />
      )}
    </div>
  );
}

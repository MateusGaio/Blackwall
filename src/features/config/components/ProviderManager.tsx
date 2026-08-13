// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { type FolderSelection, pickDirectory } from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  createWorkspace,
  deleteProvider,
  discoverProviderModels,
  type Profile,
  type ProviderModel,
  setWorkspaceSoul,
  testProvider,
  updateProfile,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";

type ProviderManagerProps = {
  activeWorkspaceId: string | null;
  onClose: () => void;
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
  onClose,
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
  const [profileName, setProfileName] = useState(profile?.name ?? "");
  const [profileSoul, setProfileSoul] = useState(profile?.soul ?? "");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(profile?.avatarData ?? null);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [workspaceSoul, setWorkspaceSoulDraft] = useState("");
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([]);
  const [isListingModels, setIsListingModels] = useState(false);

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

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
      if (!form.model && listed[0]) updateForm("model", listed[0].id);
      if (!listed.length) setStatus("Nenhum modelo foi retornado por este provedor.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível listar os modelos.");
    } finally {
      setIsListingModels(false);
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
      setProfileStatus("Perfil salvo neste dispositivo.");
    } catch (reason) {
      setProfileError(
        reason instanceof Error ? reason.message : "Não foi possível salvar o perfil.",
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
      setProfileError("Escolha uma imagem PNG, JPEG, WebP ou GIF de até 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setProfileAvatar(result);
        setProfileError("");
        setProfileStatus("Foto pronta para salvar.");
      }
    };
    reader.onerror = () => setProfileError("Não foi possível ler essa imagem.");
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
      setWorkspaceStatus("Soul do workspace salva neste dispositivo.");
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error ? reason.message : "Não foi possível salvar a Soul do workspace.",
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
      setStatus("Provedor salvo e validado neste dispositivo.");
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível salvar o provedor.");
    } finally {
      setIsSaving(false);
    }
  }

  async function testCurrent() {
    setError("");
    setStatus("");
    try {
      await testProvider({ ...form, apiKey: form.apiKey || undefined });
      setStatus("Conexão validada.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível testar o provedor.");
    }
  }

  async function remove(provider: ConnectedProvider) {
    try {
      await deleteProvider(provider.id);
      const next = providers.filter((item) => item.id !== provider.id);
      onProvidersChange(next);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o provedor.");
    }
  }

  async function chooseWorkspaceFolder() {
    const selected = await pickDirectory();
    if (!selected) return;
    setWorkspaceFolder(selected);
    setWorkspaceName((current) => current || selected.name);
    setWorkspaceStatus("");
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
        soul: "Preserve o contexto e as convenções deste workspace.",
        workspaceFiles: workspaceFolder.files,
      });
      await onWorkspaceSelected(created);
      setWorkspaceName("");
      setWorkspaceFolder(null);
      setWorkspaceStatus(`Workspace ${created.name} adicionado.`);
    } catch (reason) {
      setWorkspaceStatus(
        reason instanceof Error ? reason.message : "Não foi possível criar o workspace.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="settings-backdrop" role="presentation">
      <button
        aria-label="Fechar configurações"
        className="settings-backdrop-dismiss"
        onClick={onClose}
        type="button"
      />
      <section
        aria-busy={isSaving || isSavingProfile}
        aria-label="Configurações de provedores"
        className="settings-panel"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        tabIndex={-1}
      >
        <header className="settings-panel-header">
          <div>
            <p className="eyebrow">Configurações</p>
            <h2>Perfil, workspaces e provedores</h2>
          </div>
          <button
            aria-label="Fechar configurações"
            className="icon-button"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <form className="settings-section profile-settings" onSubmit={saveProfile}>
          <div className="settings-section-heading">
            <div>
              <p className="eyebrow">Perfil</p>
              <h3>Como você quer ser chamado?</h3>
            </div>
            <div className="profile-avatar-preview" aria-hidden="true">
              {profileAvatar ? <img alt="" src={profileAvatar} /> : <span>BW</span>}
            </div>
          </div>
          <label className="field-label" htmlFor="settings-profile-name">
            Nome
            <input
              id="settings-profile-name"
              onChange={(event) => setProfileName(event.target.value)}
              value={profileName}
            />
          </label>
          <div className="profile-avatar-actions">
            <label className="button button-secondary" htmlFor="settings-profile-avatar">
              Alterar foto
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
                Remover foto
              </button>
            )}
            <small>PNG, JPEG, WebP ou GIF · até 2 MB · fica somente neste dispositivo</small>
          </div>
          <label className="field-label" htmlFor="settings-profile-soul">
            Soul do perfil
            <textarea
              id="settings-profile-soul"
              onChange={(event) => setProfileSoul(event.target.value)}
              rows={4}
              value={profileSoul}
            />
          </label>
          <div className="settings-actions">
            <button
              className="button button-primary"
              disabled={isSavingProfile || !profileName.trim() || !profileSoul.trim()}
              type="submit"
            >
              {isSavingProfile ? "Salvando…" : "Salvar perfil"}
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
            Workspaces
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
              <p className="settings-empty">Nenhum workspace com pasta selecionada.</p>
            )}
          </div>
          <form className="workspace-create-form" onSubmit={submitWorkspace}>
            <label className="field-label" htmlFor="settings-workspace-name">
              Nome do workspace
              <input
                id="settings-workspace-name"
                onChange={(event) => setWorkspaceName(event.target.value)}
                placeholder="Meu projeto"
                value={workspaceName}
              />
            </label>
            <button
              className="folder-select-button settings-folder-button"
              onClick={() => void chooseWorkspaceFolder()}
              type="button"
            >
              <strong>{workspaceFolder?.name ?? "Escolher pasta"}</strong>
              <small>Selecione uma pasta para habilitar Vault, grafo e ferramentas.</small>
            </button>
            <button
              className="button button-primary"
              disabled={isSaving || !workspaceName.trim() || !workspaceFolder}
              type="submit"
            >
              {isSaving ? "Salvando…" : "Adicionar workspace"}
            </button>
          </form>
          {activeWorkspace && (
            <form className="workspace-soul-form" onSubmit={saveWorkspaceSoulDraft}>
              <label className="field-label" htmlFor="settings-workspace-soul">
                Soul do workspace selecionado
                <textarea
                  id="settings-workspace-soul"
                  onChange={(event) => setWorkspaceSoulDraft(event.target.value)}
                  rows={4}
                  value={workspaceSoul}
                />
              </label>
              <button
                className="button button-secondary"
                disabled={isSaving || !workspaceSoul.trim()}
                type="submit"
              >
                Salvar Soul
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
                  {provider.type} · {provider.model || "sem modelo"}
                </span>
              </button>
              <div>
                <button className="text-button" onClick={() => edit(provider)} type="button">
                  Editar
                </button>
                <button
                  className="text-button danger"
                  onClick={() => setProviderToRemove(provider)}
                  type="button"
                >
                  Remover
                </button>
              </div>
            </article>
          ))}
          {providers.length === 0 && <p className="settings-empty">Nenhum provedor configurado.</p>}
        </div>
        <form className="provider-form settings-form" onSubmit={submit}>
          <p className="eyebrow">{editingId ? "Editar provedor" : "Adicionar provedor"}</p>
          <label className="field-label" htmlFor="settings-provider-type">
            Tipo
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
            Nome
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
            Modelo padrão
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
                {isListingModels ? "Listando…" : "Listar modelos"}
              </button>
            </div>
            {providerModels.length > 0 && (
              <select
                aria-label="Modelos disponíveis"
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
          </label>
          {form.type === "openai-compatible" && (
            <label className="field-label" htmlFor="settings-provider-key">
              Chave de API
              <input
                autoComplete="off"
                id="settings-provider-key"
                onChange={(event) => updateForm("apiKey", event.target.value)}
                placeholder={editingId ? "Manter chave atual" : "sk-…"}
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
              Testar
            </button>
            <button
              className="button button-primary"
              disabled={isSaving || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
              type="submit"
            >
              {isSaving ? "Salvando…" : "Salvar"}
            </button>
            {editingId && (
              <button className="text-button" onClick={reset} type="button">
                Cancelar
              </button>
            )}
            <button
              className="text-button danger settings-sign-out"
              onClick={() => void onSignOut()}
              type="button"
            >
              Sair do perfil
            </button>
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
          confirmLabel="Remover provedor"
          description={`A configuração de ${providerToRemove.name} será removida deste dispositivo.`}
          onCancel={() => setProviderToRemove(null)}
          onConfirm={() => {
            const provider = providerToRemove;
            setProviderToRemove(null);
            void remove(provider);
          }}
          title={`Remover ${providerToRemove.name}?`}
        />
      )}
    </div>
  );
}

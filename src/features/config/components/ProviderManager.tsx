// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import { type FolderSelection, pickDirectory } from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  createWorkspace,
  deleteProvider,
  testProvider,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";

type ProviderManagerProps = {
  activeWorkspaceId: string | null;
  onClose: () => void;
  onProvidersChange: (providers: ConnectedProvider[]) => void;
  onSelect: (provider: ConnectedProvider) => void;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
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
  onSelect,
  onWorkspaceSelected,
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
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setStatus("");
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
      <section
        aria-busy={isSaving}
        aria-label="Configurações de provedores"
        className="settings-panel"
      >
        <header className="settings-panel-header">
          <div>
            <p className="eyebrow">Configurações</p>
            <h2>Workspace e provedores</h2>
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
        <section aria-labelledby="workspace-settings-title" className="settings-section">
          <p className="eyebrow" id="workspace-settings-title">
            Workspaces
          </p>
          <div className="settings-workspace-list">
            {workspaces.map((workspace) => (
              <button
                className={`settings-workspace-row ${workspace.id === activeWorkspaceId ? "is-active" : ""}`}
                key={workspace.id}
                onClick={() => void onWorkspaceSelected(workspace)}
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
            <input
              id="settings-provider-model"
              onChange={(event) => updateForm("model", event.target.value)}
              value={form.model}
            />
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

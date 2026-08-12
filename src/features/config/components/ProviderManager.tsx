// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import {
  type ConnectedProvider,
  connectProvider,
  deleteProvider,
  testProvider,
  updateProvider,
} from "../../../shared/api/sidecar";

type ProviderManagerProps = {
  onClose: () => void;
  onProvidersChange: (providers: ConnectedProvider[]) => void;
  onSelect: (provider: ConnectedProvider) => void;
  providers: ConnectedProvider[];
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
  onClose,
  onProvidersChange,
  onSelect,
  providers,
}: ProviderManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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
    if (!window.confirm(`Remover o provedor ${provider.name}?`)) return;
    try {
      await deleteProvider(provider.id);
      const next = providers.filter((item) => item.id !== provider.id);
      onProvidersChange(next);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível remover o provedor.");
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
            <h2>Provedores e modelos</h2>
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
                  onClick={() => void remove(provider)}
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
    </div>
  );
}

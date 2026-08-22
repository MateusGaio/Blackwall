// MIT License — Copyright (c) 2026 Mateus Gaio
import type { FormEvent } from "react";
import type { Profile, ProviderModel } from "../../../../shared/api/sidecar";
import type { ProviderForm } from "./providerForm";
import type { useModelOptions } from "./useModelOptions";

type ProviderFormSectionProps = {
  editingId: string | null;
  error: string;
  form: ProviderForm;
  isDeletingProfile: boolean;
  isEnglish: boolean;
  isSaving: boolean;
  modelOptions: ReturnType<typeof useModelOptions>;
  onSignOut: () => Promise<void>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTest: () => Promise<void>;
  profile: Profile | null;
  requestDeleteProfile: () => void;
  reset: () => void;
  setFormField: (field: keyof ProviderForm, value: string) => void;
  status: string;
};

export function ProviderFormSection({
  editingId,
  error,
  form,
  isDeletingProfile,
  isEnglish,
  isSaving,
  modelOptions,
  onSignOut,
  onSubmit,
  onTest,
  profile,
  requestDeleteProfile,
  reset,
  setFormField,
  status,
}: ProviderFormSectionProps) {
  return (
    <form className="provider-form settings-form" onSubmit={onSubmit}>
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
          onChange={(event) => setFormField("type", event.target.value)}
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
          onChange={(event) => setFormField("name", event.target.value)}
          value={form.name}
        />
      </label>
      <label className="field-label" htmlFor="settings-provider-url">
        Endpoint
        <input
          id="settings-provider-url"
          onChange={(event) => setFormField("baseUrl", event.target.value)}
          value={form.baseUrl}
        />
      </label>
      <label className="field-label" htmlFor="settings-provider-model">
        {isEnglish ? "Default model" : "Modelo padrão"}
        <div className="model-input-row">
          <input
            id="settings-provider-model"
            onChange={(event) => setFormField("model", event.target.value)}
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
            onChange={(event) => setFormField("model", event.target.value)}
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
                void modelOptions.changeToolMode(event.target.value as ProviderModel["toolMode"])
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
              aria-label={isEnglish ? "Parallel tool calls" : "Chamadas de ferramenta paralelas"}
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
                {isEnglish ? "Parallel calls: force off" : "Chamadas paralelas: forçar desligado"}
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
            onChange={(event) => setFormField("apiKey", event.target.value)}
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
          onClick={() => void onTest()}
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
            onClick={requestDeleteProfile}
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
  );
}

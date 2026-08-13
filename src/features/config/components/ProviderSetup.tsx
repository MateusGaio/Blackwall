// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import {
  type ConnectedProvider,
  connectProvider,
  discoverProviderModels,
  type ProviderModel,
} from "../../../shared/api/sidecar";

type ProviderSetupProps = {
  locale: "pt-BR" | "en";
  onConnected: (provider: ConnectedProvider) => void;
};

export function ProviderSetup({ locale, onConnected }: ProviderSetupProps) {
  const isEnglish = locale === "en";
  const [name, setName] = useState("OpenRouter");
  const [baseUrl, setBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [providerType, setProviderType] = useState<"openai-compatible" | "ollama">(
    "openai-compatible",
  );
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);

  function changeProviderType(type: "openai-compatible" | "ollama") {
    setProviderType(type);
    setModels([]);
    setError("");
    if (type === "ollama") {
      setName("Ollama local");
      setBaseUrl("http://127.0.0.1:11434");
      setApiKey("");
      setModel("");
      return;
    }
    setName("OpenRouter");
    setBaseUrl("https://openrouter.ai/api/v1");
    setModel("openai/gpt-4o-mini");
  }

  async function discoverModels() {
    setError("");
    setIsDiscovering(true);
    try {
      const discovered = await discoverProviderModels({
        apiKey: apiKey || undefined,
        baseUrl,
        name,
        type: providerType,
      });
      setModels(discovered);
      if (!model && discovered[0]) setModel(discovered[0].id);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not list models."
            : "Não foi possível listar os modelos.",
      );
    } finally {
      setIsDiscovering(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsConnecting(true);
    try {
      onConnected(
        await connectProvider({
          apiKey: apiKey || undefined,
          baseUrl,
          model,
          name,
          type: providerType,
        }),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not connect the provider."
            : "Não foi possível conectar o provedor.",
      );
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <p className="provider-notice">
        {isEnglish
          ? "The key is validated once and remains encrypted on this device only."
          : "A chave é validada uma vez e permanece criptografada apenas neste dispositivo."}
      </p>
      <fieldset className="field-label provider-type-fieldset">
        <legend>{isEnglish ? "Provider type" : "Tipo de provedor"}</legend>
        <div className="provider-type-picker">
          <button
            aria-pressed={providerType === "openai-compatible"}
            className={providerType === "openai-compatible" ? "is-selected" : ""}
            onClick={() => changeProviderType("openai-compatible")}
            type="button"
          >
            <strong>{isEnglish ? "Compatible API" : "API compatível"}</strong>
            <span>
              {isEnglish
                ? "OpenRouter, OpenCode Zen and compatible endpoints."
                : "OpenRouter, OpenCode Zen e endpoints compatíveis."}
            </span>
          </button>
          <button
            aria-pressed={providerType === "ollama"}
            className={providerType === "ollama" ? "is-selected" : ""}
            onClick={() => changeProviderType("ollama")}
            type="button"
          >
            <strong>Ollama local</strong>
            <span>
              {isEnglish
                ? "Models installed on your computer."
                : "Modelos instalados no seu computador."}
            </span>
          </button>
        </div>
      </fieldset>
      <label className="field-label" htmlFor="provider-name">
        {isEnglish ? "Provider name" : "Nome do provedor"}
        <input id="provider-name" onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label className="field-label" htmlFor="provider-url">
        Endpoint
        <input
          id="provider-url"
          onChange={(event) => setBaseUrl(event.target.value)}
          value={baseUrl}
        />
      </label>
      <label className="field-label" htmlFor="provider-model">
        {isEnglish ? "Model" : "Modelo"}
        <div className="model-input-row">
          <input
            id="provider-model"
            onChange={(event) => setModel(event.target.value)}
            value={model}
          />
          <button
            className="button button-secondary"
            disabled={isDiscovering || (providerType === "openai-compatible" && !apiKey.trim())}
            onClick={() => void discoverModels()}
            type="button"
          >
            {isDiscovering ? (isEnglish ? "Listing…" : "Listando…") : isEnglish ? "List" : "Listar"}
          </button>
        </div>
        {models.length > 0 && (
          <select
            aria-label={isEnglish ? "Available model" : "Modelo disponível"}
            onChange={(event) => setModel(event.target.value)}
            value={model}
          >
            {models.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
      </label>
      {providerType === "openai-compatible" && (
        <label className="field-label" htmlFor="provider-key">
          {isEnglish ? "API key" : "Chave de API"}
          <input
            autoComplete="off"
            id="provider-key"
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            value={apiKey}
          />
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary"
        disabled={
          isConnecting || !model.trim() || (providerType === "openai-compatible" && !apiKey.trim())
        }
        type="submit"
      >
        {isConnecting
          ? isEnglish
            ? "Checking connection…"
            : "Verificando conexão…"
          : isEnglish
            ? "Connect and continue"
            : "Conectar e continuar"}
      </button>
    </form>
  );
}

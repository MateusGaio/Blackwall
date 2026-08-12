// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import {
  type ConnectedProvider,
  connectProvider,
  discoverProviderModels,
  type ProviderModel,
} from "../../../shared/api/sidecar";

type ProviderSetupProps = {
  onConnected: (provider: ConnectedProvider) => void;
};

export function ProviderSetup({ onConnected }: ProviderSetupProps) {
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
      setError(reason instanceof Error ? reason.message : "Não foi possível listar os modelos.");
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
      setError(reason instanceof Error ? reason.message : "Não foi possível conectar o provedor.");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <p className="provider-notice">
        A chave é validada uma vez e permanece criptografada apenas neste dispositivo.
      </p>
      <label className="field-label" htmlFor="provider-type">
        Tipo de provedor
        <select
          id="provider-type"
          onChange={(event) => changeProviderType(event.target.value as typeof providerType)}
          value={providerType}
        >
          <option value="openai-compatible">OpenAI-compatible</option>
          <option value="ollama">Ollama local</option>
        </select>
      </label>
      <label className="field-label" htmlFor="provider-name">
        Nome do provedor
        <input id="provider-name" onChange={(event) => setName(event.target.value)} value={name} />
      </label>
      <label className="field-label" htmlFor="provider-url">
        Endpoint compatível com OpenAI
        <input
          id="provider-url"
          onChange={(event) => setBaseUrl(event.target.value)}
          value={baseUrl}
        />
      </label>
      <label className="field-label" htmlFor="provider-model">
        Modelo
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
            {isDiscovering ? "Listando…" : "Listar"}
          </button>
        </div>
        {models.length > 0 && (
          <select onChange={(event) => setModel(event.target.value)} value={model}>
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
          Chave de API
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
        {isConnecting ? "Verificando conexão…" : "Conectar e continuar"}
      </button>
    </form>
  );
}

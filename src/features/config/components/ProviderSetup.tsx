// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, useState } from "react";
import { type ConnectedProvider, connectProvider } from "../../../shared/api/sidecar";

type ProviderSetupProps = {
  onConnected: (provider: ConnectedProvider) => void;
};

export function ProviderSetup({ onConnected }: ProviderSetupProps) {
  const [name, setName] = useState("OpenRouter");
  const [baseUrl, setBaseUrl] = useState("https://openrouter.ai/api/v1");
  const [model, setModel] = useState("openai/gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsConnecting(true);
    try {
      onConnected(await connectProvider({ apiKey, baseUrl, model, name }));
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
        <input
          id="provider-model"
          onChange={(event) => setModel(event.target.value)}
          value={model}
        />
      </label>
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
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button button-primary"
        disabled={isConnecting || !apiKey.trim()}
        type="submit"
      >
        {isConnecting ? "Verificando conexão…" : "Conectar e continuar"}
      </button>
    </form>
  );
}

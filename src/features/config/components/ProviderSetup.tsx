// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      setError(reason instanceof Error ? reason.message : t("onboarding.couldNotListModels"));
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
        reason instanceof Error ? reason.message : t("onboarding.couldNotConnectTheProvider"),
      );
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <p className="provider-notice">{t("onboarding.theKeyIsValidatedOnce")}</p>
      <fieldset className="field-label provider-type-fieldset">
        <legend>{t("onboarding.providerType")}</legend>
        <div className="provider-type-picker">
          <button
            aria-pressed={providerType === "openai-compatible"}
            className={providerType === "openai-compatible" ? "is-selected" : ""}
            onClick={() => changeProviderType("openai-compatible")}
            type="button"
          >
            <strong>{t("onboarding.compatibleApi")}</strong>
            <span>{t("onboarding.openrouterOpencodeZenAndCompatible")}</span>
          </button>
          <button
            aria-pressed={providerType === "ollama"}
            className={providerType === "ollama" ? "is-selected" : ""}
            onClick={() => changeProviderType("ollama")}
            type="button"
          >
            <strong>Ollama local</strong>
            <span>{t("onboarding.modelsInstalledOnYourComputer")}</span>
          </button>
        </div>
      </fieldset>
      <label className="field-label" htmlFor="provider-name">
        {t("onboarding.providerName")}
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
        {t("onboarding.model")}
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
            {isDiscovering ? t("onboarding.listing") : t("onboarding.list")}
          </button>
        </div>
        {models.length > 0 && (
          <select
            aria-label={t("onboarding.availableModel")}
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
          {t("onboarding.apiKey")}
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
        {isConnecting ? t("onboarding.checkingConnection") : t("onboarding.connectAndContinue")}
      </button>
    </form>
  );
}

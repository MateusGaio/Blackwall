// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
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

  const typeCardClass = (selected: boolean) =>
    `grid min-w-0 gap-1 rounded-lg border p-3 text-left transition-colors duration-150 focus-visible:border-ring focus-visible:outline-none ${
      selected
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border hover:border-ring"
    }`;

  return (
    <form className="grid gap-4" onSubmit={submit}>
      <p className="text-[0.76rem] text-muted-foreground">
        {t("onboarding.theKeyIsValidatedOnce")}
      </p>
      <fieldset className="m-0 grid gap-2.5 border-0 p-0 font-mono text-[0.72rem] text-muted-foreground">
        <legend>{t("onboarding.providerType")}</legend>
        <div className="grid grid-cols-2 gap-2">
          <button
            aria-pressed={providerType === "openai-compatible"}
            className={typeCardClass(providerType === "openai-compatible")}
            onClick={() => changeProviderType("openai-compatible")}
            type="button"
          >
            <strong className="font-sans text-[0.84rem] font-medium">
              {t("onboarding.compatibleApi")}
            </strong>
            <span className="font-sans text-[0.68rem] text-muted-foreground">
              {t("onboarding.openrouterOpencodeZenAndCompatible")}
            </span>
          </button>
          <button
            aria-pressed={providerType === "ollama"}
            className={typeCardClass(providerType === "ollama")}
            onClick={() => changeProviderType("ollama")}
            type="button"
          >
            <strong className="font-sans text-[0.84rem] font-medium">Ollama local</strong>
            <span className="font-sans text-[0.68rem] text-muted-foreground">
              {t("onboarding.modelsInstalledOnYourComputer")}
            </span>
          </button>
        </div>
      </fieldset>
      <label
        className="grid gap-2.5 font-mono text-[0.72rem] text-muted-foreground"
        htmlFor="provider-name"
      >
        {t("onboarding.providerName")}
        <Input
          className="h-10"
          id="provider-name"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </label>
      <label
        className="grid gap-2.5 font-mono text-[0.72rem] text-muted-foreground"
        htmlFor="provider-url"
      >
        Endpoint
        <Input
          className="h-10"
          id="provider-url"
          onChange={(event) => setBaseUrl(event.target.value)}
          value={baseUrl}
        />
      </label>
      <label
        className="grid gap-2.5 font-mono text-[0.72rem] text-muted-foreground"
        htmlFor="provider-model"
      >
        {t("onboarding.model")}
        <span className="flex items-center gap-2">
          <Input
            className="h-10 flex-1"
            id="provider-model"
            onChange={(event) => setModel(event.target.value)}
            value={model}
          />
          <Button
            disabled={isDiscovering || (providerType === "openai-compatible" && !apiKey.trim())}
            onClick={() => void discoverModels()}
            type="button"
            variant="secondary"
          >
            {isDiscovering ? t("onboarding.listing") : t("onboarding.list")}
          </Button>
        </span>
        {models.length > 0 && (
          <select
            aria-label={t("onboarding.availableModel")}
            className="h-10 border border-input bg-input/30 px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
        <label
          className="grid gap-2.5 font-mono text-[0.72rem] text-muted-foreground"
          htmlFor="provider-key"
        >
          {t("onboarding.apiKey")}
          <Input
            autoComplete="off"
            className="h-10"
            id="provider-key"
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            value={apiKey}
          />
        </label>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        className="w-fit justify-self-end"
        disabled={
          isConnecting || !model.trim() || (providerType === "openai-compatible" && !apiKey.trim())
        }
        type="submit"
      >
        {isConnecting ? t("onboarding.checkingConnection") : t("onboarding.connectAndContinue")}
      </Button>
    </form>
  );
}

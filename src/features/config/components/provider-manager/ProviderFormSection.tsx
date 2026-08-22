// MIT License — Copyright (c) 2026 Mateus Gaio

import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, ProviderModel } from "../../../../shared/api/sidecar";
import type { ProviderForm } from "./providerForm";
import type { useModelOptions } from "./useModelOptions";

type ProviderFormSectionProps = {
  editingId: string | null;
  error: string;
  form: ProviderForm;
  isDeletingProfile: boolean;
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
  const { t } = useTranslation();
  return (
    <form className="provider-form settings-form" onSubmit={onSubmit}>
      <p className="eyebrow">
        {editingId ? t("settings.editProvider") : t("settings.addProvider")}
      </p>
      <label className="field-label" htmlFor="settings-provider-type">
        {t("settings.type")}
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
        {t("settings.name")}
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
        {t("settings.defaultModel")}
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
            {modelOptions.isListingModels ? t("settings.listing") : t("settings.listModels")}
          </button>
        </div>
        {modelOptions.providerModels.length > 0 && (
          <select
            aria-label={t("settings.availableModels")}
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
              aria-label={t("settings.toolCallingMode")}
              onChange={(event) =>
                void modelOptions.changeToolMode(event.target.value as ProviderModel["toolMode"])
              }
              value={modelOptions.toolMode}
            >
              <option value="auto">{t("settings.nativeToolsAutomatic")}</option>
              <option value="compatibility">{t("settings.compatibilityJsonOptin")}</option>
              <option value="disabled">{t("settings.disabled")}</option>
            </select>
            <select
              aria-label={t("settings.protocolPreference")}
              onChange={(event) =>
                void modelOptions.changeProtocol(
                  event.target.value as NonNullable<ProviderModel["protocolPreference"]>,
                )
              }
              value={modelOptions.protocolPreference}
            >
              <option value="auto">{t("settings.protocolAutomatic")}</option>
              <option value="openai-chat">OpenAI Chat Completions</option>
              <option value="openai-responses">OpenAI Responses</option>
            </select>
            <select
              aria-label={t("settings.parallelToolCalls")}
              onChange={(event) =>
                void modelOptions.changeParallelToolCalls(
                  event.target.value as ProviderModel["parallelToolCalls"],
                )
              }
              value={modelOptions.parallelToolCalls}
            >
              <option value="auto">{t("settings.parallelCallsAutomaticOnFor")}</option>
              <option value="enabled">{t("settings.parallelCallsForceOn")}</option>
              <option value="disabled">{t("settings.parallelCallsForceOff")}</option>
            </select>
            <div className="provider-model-capability" aria-live="polite">
              {(() => {
                const selected = modelOptions.providerModels.find(
                  (model) => model.id === form.model,
                );
                const support = selected?.toolSupport ?? "unknown";
                return support === "native"
                  ? t("settings.nativeToolsVerified")
                  : support === "unsupported"
                    ? t("settings.modelNoTools")
                    : support === "probe-error"
                      ? t("settings.toolProbeFailed")
                      : t("settings.toolSupportNotTested");
              })()}
            </div>
            <button
              className="button button-secondary"
              disabled={modelOptions.isProbingTools}
              onClick={() => void modelOptions.probeTools()}
              type="button"
            >
              {modelOptions.isProbingTools ? t("settings.testing") : t("settings.testTools")}
            </button>
          </>
        )}
      </label>
      {form.type === "openai-compatible" && (
        <label className="field-label" htmlFor="settings-provider-key">
          {t("settings.apiKey")}
          <input
            autoComplete="off"
            id="settings-provider-key"
            onChange={(event) => setFormField("apiKey", event.target.value)}
            placeholder={editingId ? t("settings.keepCurrentKey") : "sk-…"}
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
          {t("settings.test")}
        </button>
        <button
          className="button button-primary"
          disabled={isSaving || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
          type="submit"
        >
          {isSaving ? t("settings.saving") : t("settings.save")}
        </button>
        {editingId && (
          <button className="text-button" onClick={reset} type="button">
            {t("settings.cancel")}
          </button>
        )}
        <button
          className="text-button danger settings-sign-out"
          onClick={() => void onSignOut()}
          type="button"
        >
          {t("settings.signOut")}
        </button>
        {profile && (
          <button
            className="text-button danger settings-delete-profile"
            disabled={isDeletingProfile}
            onClick={requestDeleteProfile}
            type="button"
          >
            {t("settings.deleteProfile")}
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

// MIT License — Copyright (c) 2026 Mateus Gaio

import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
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

const fieldLabelClass = "grid gap-2 font-mono text-[0.72rem] text-muted-foreground";

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
    <form className="grid gap-4" onSubmit={onSubmit}>
      <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
        {editingId ? t("settings.editProvider") : t("settings.addProvider")}
      </p>
      <label className={fieldLabelClass} htmlFor="settings-provider-type">
        {t("settings.type")}
        <Select value={form.type} onValueChange={(value) => setFormField("type", value)}>
          <SelectTrigger className="w-full" id="settings-provider-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ollama">Ollama local</SelectItem>
            <SelectItem value="openai-compatible">OpenAI-compatible</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label className={fieldLabelClass} htmlFor="settings-provider-name">
        {t("settings.name")}
        <Input
          id="settings-provider-name"
          onChange={(event) => setFormField("name", event.target.value)}
          value={form.name}
        />
      </label>
      <label className={fieldLabelClass} htmlFor="settings-provider-url">
        Endpoint
        <Input
          id="settings-provider-url"
          onChange={(event) => setFormField("baseUrl", event.target.value)}
          value={form.baseUrl}
        />
      </label>
      <div className={fieldLabelClass}>
        <label htmlFor="settings-provider-model">{t("settings.defaultModel")}</label>
        <span className="flex items-center gap-2">
          <Input
            className="flex-1"
            id="settings-provider-model"
            onChange={(event) => setFormField("model", event.target.value)}
            value={form.model}
          />
          <Button
            disabled={
              modelOptions.isListingModels ||
              (!editingId && form.type === "openai-compatible" && !form.apiKey.trim())
            }
            onClick={() => void modelOptions.listModels()}
            type="button"
            variant="secondary"
          >
            {modelOptions.isListingModels ? t("settings.listing") : t("settings.listModels")}
          </Button>
        </span>
        {modelOptions.providerModels.length > 0 && (
          <Select value={form.model} onValueChange={(value) => setFormField("model", value)}>
            <SelectTrigger aria-label={t("settings.availableModels")} className="w-full" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {modelOptions.providerModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {editingId && modelOptions.providerModels.length > 0 && (
          <>
            <Select
              value={modelOptions.toolMode}
              onValueChange={(value) =>
                void modelOptions.changeToolMode(value as ProviderModel["toolMode"])
              }
            >
              <SelectTrigger
                aria-label={t("settings.toolCallingMode")}
                className="w-full"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("settings.nativeToolsAutomatic")}</SelectItem>
                <SelectItem value="compatibility">
                  {t("settings.compatibilityJsonOptin")}
                </SelectItem>
                <SelectItem value="disabled">{t("settings.disabled")}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={modelOptions.protocolPreference}
              onValueChange={(value) =>
                void modelOptions.changeProtocol(
                  value as NonNullable<ProviderModel["protocolPreference"]>,
                )
              }
            >
              <SelectTrigger
                aria-label={t("settings.protocolPreference")}
                className="w-full"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("settings.protocolAutomatic")}</SelectItem>
                <SelectItem value="openai-chat">OpenAI Chat Completions</SelectItem>
                <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={modelOptions.parallelToolCalls}
              onValueChange={(value) =>
                void modelOptions.changeParallelToolCalls(
                  value as ProviderModel["parallelToolCalls"],
                )
              }
            >
              <SelectTrigger
                aria-label={t("settings.parallelToolCalls")}
                className="w-full"
                size="sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{t("settings.parallelCallsAutomaticOnFor")}</SelectItem>
                <SelectItem value="enabled">{t("settings.parallelCallsForceOn")}</SelectItem>
                <SelectItem value="disabled">{t("settings.parallelCallsForceOff")}</SelectItem>
              </SelectContent>
            </Select>
            <div
              aria-live="polite"
              className="font-sans text-xs tracking-normal text-muted-foreground"
            >
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
            <Button
              className="w-fit"
              disabled={modelOptions.isProbingTools}
              onClick={() => void modelOptions.probeTools()}
              size="sm"
              type="button"
              variant="outline"
            >
              {modelOptions.isProbingTools ? t("settings.testing") : t("settings.testTools")}
            </Button>
          </>
        )}
      </div>
      {form.type === "openai-compatible" && (
        <label className={fieldLabelClass} htmlFor="settings-provider-key">
          {t("settings.apiKey")}
          <Input
            autoComplete="off"
            id="settings-provider-key"
            onChange={(event) => setFormField("apiKey", event.target.value)}
            placeholder={editingId ? t("settings.keepCurrentKey") : "sk-…"}
            type="password"
            value={form.apiKey}
          />
        </label>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button disabled={isSaving} onClick={() => void onTest()} type="button" variant="secondary">
          {t("settings.test")}
        </Button>
        <Button
          disabled={isSaving || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
          type="submit"
        >
          {isSaving ? t("settings.saving") : t("settings.save")}
        </Button>
        {editingId && (
          <Button onClick={reset} size="sm" type="button" variant="ghost">
            {t("settings.cancel")}
          </Button>
        )}
        <Button
          className="text-destructive hover:text-destructive"
          onClick={() => void onSignOut()}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("settings.signOut")}
        </Button>
        {profile && (
          <Button
            disabled={isDeletingProfile}
            onClick={requestDeleteProfile}
            size="sm"
            type="button"
            variant="ghost"
          >
            <span className="text-destructive">{t("settings.deleteProfile")}</span>
          </Button>
        )}
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

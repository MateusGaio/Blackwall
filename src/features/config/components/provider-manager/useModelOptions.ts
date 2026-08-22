// MIT License — Copyright (c) 2026 Mateus Gaio

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  discoverProviderModels,
  type ProviderModel,
  probeProviderModel,
  setProviderModelParallelToolCalls,
  setProviderModelProtocol,
  setProviderModelToolMode,
} from "../../../../shared/api/sidecar";
import type { ProviderForm } from "./providerForm";

type UseModelOptionsArgs = {
  editingId: string | null;
  form: ProviderForm;
  onFieldChange: (field: keyof ProviderForm, value: string) => void;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
};

export function useModelOptions({
  editingId,
  form,
  onFieldChange,
  setError,
  setStatus,
}: UseModelOptionsArgs) {
  const { t } = useTranslation();
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([]);
  const [isListingModels, setIsListingModels] = useState(false);
  const [toolMode, setToolMode] = useState<ProviderModel["toolMode"]>("auto");
  const [parallelToolCalls, setParallelToolCalls] =
    useState<ProviderModel["parallelToolCalls"]>("auto");
  const [protocolPreference, setProtocolPreference] =
    useState<ProviderModel["protocolPreference"]>("auto");
  const [isProbingTools, setIsProbingTools] = useState(false);

  function clearModels() {
    setProviderModels([]);
  }

  async function listModels() {
    setError("");
    setIsListingModels(true);
    try {
      const listed = await discoverProviderModels({
        apiKey: form.apiKey || undefined,
        baseUrl: form.baseUrl,
        id: editingId ?? undefined,
        name: form.name,
        type: form.type,
      });
      setProviderModels(listed);
      setToolMode(
        listed.find((model) => model.id === (form.model || listed[0]?.id))?.toolMode ?? "auto",
      );
      setParallelToolCalls(
        listed.find((model) => model.id === (form.model || listed[0]?.id))?.parallelToolCalls ??
          "auto",
      );
      setProtocolPreference(
        listed.find((model) => model.id === (form.model || listed[0]?.id))?.protocolPreference ??
          "auto",
      );
      if (!form.model && listed[0]) onFieldChange("model", listed[0].id);
      if (!listed.length) setStatus(t("settings.thisProviderReturnedNoModels"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotListModels"));
    } finally {
      setIsListingModels(false);
    }
  }

  async function changeProtocol(next: NonNullable<ProviderModel["protocolPreference"]>) {
    setProtocolPreference(next);
    if (!editingId || !form.model) return;
    try {
      await setProviderModelProtocol(editingId, form.model, next);
      setStatus(t("settings.protocolPreferenceSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotSaveProtocol"));
    }
  }

  async function probeTools() {
    if (!editingId || !form.model) return;
    setIsProbingTools(true);
    setError("");
    try {
      const probed = await probeProviderModel(
        editingId,
        form.model,
        protocolPreference === "auto"
          ? undefined
          : protocolPreference === "openai-responses"
            ? "openai-responses"
            : "openai-chat",
      );
      setProviderModels((current) =>
        current.map((model) => (model.id === probed.id ? { ...model, ...probed } : model)),
      );
      setStatus(t("settings.toolSupportChecked"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotTestTools"));
    } finally {
      setIsProbingTools(false);
    }
  }

  async function changeToolMode(next: ProviderModel["toolMode"]) {
    setToolMode(next);
    if (!editingId || !form.model || !next) return;
    try {
      await setProviderModelToolMode(editingId, form.model, next);
      setStatus(t("settings.toolModeSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotSaveToolMode"));
    }
  }

  async function changeParallelToolCalls(next: ProviderModel["parallelToolCalls"]) {
    setParallelToolCalls(next);
    if (!editingId || !form.model || !next) return;
    try {
      await setProviderModelParallelToolCalls(editingId, form.model, next);
      setStatus(t("settings.parallelToolCallsSettingSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotSaveTheParallel"));
    }
  }

  return {
    changeParallelToolCalls,
    changeProtocol,
    changeToolMode,
    clearModels,
    isListingModels,
    isProbingTools,
    listModels,
    parallelToolCalls,
    protocolPreference,
    providerModels,
    probeTools,
    toolMode,
  };
}

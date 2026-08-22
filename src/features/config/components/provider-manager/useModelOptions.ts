// MIT License — Copyright (c) 2026 Mateus Gaio
import { useState } from "react";
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
  isEnglish: boolean;
  onFieldChange: (field: keyof ProviderForm, value: string) => void;
  setError: (error: string) => void;
  setStatus: (status: string) => void;
};

export function useModelOptions({
  editingId,
  form,
  isEnglish,
  onFieldChange,
  setError,
  setStatus,
}: UseModelOptionsArgs) {
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
      if (!listed.length)
        setStatus(
          isEnglish
            ? "This provider returned no models."
            : "Nenhum modelo foi retornado por este provedor.",
        );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not list models."
            : "Não foi possível listar os modelos.",
      );
    } finally {
      setIsListingModels(false);
    }
  }

  async function changeProtocol(next: NonNullable<ProviderModel["protocolPreference"]>) {
    setProtocolPreference(next);
    if (!editingId || !form.model) return;
    try {
      await setProviderModelProtocol(editingId, form.model, next);
      setStatus(isEnglish ? "Protocol preference saved." : "Preferência de protocolo salva.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save protocol."
            : "Não foi possível salvar o protocolo.",
      );
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
      setStatus(isEnglish ? "Tool support checked." : "Suporte a ferramentas verificado.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not test tools."
            : "Não foi possível testar as ferramentas.",
      );
    } finally {
      setIsProbingTools(false);
    }
  }

  async function changeToolMode(next: ProviderModel["toolMode"]) {
    setToolMode(next);
    if (!editingId || !form.model || !next) return;
    try {
      await setProviderModelToolMode(editingId, form.model, next);
      setStatus(isEnglish ? "Tool mode saved." : "Modo de ferramentas salvo.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save tool mode."
            : "Não foi possível salvar o modo de ferramentas.",
      );
    }
  }

  async function changeParallelToolCalls(next: ProviderModel["parallelToolCalls"]) {
    setParallelToolCalls(next);
    if (!editingId || !form.model || !next) return;
    try {
      await setProviderModelParallelToolCalls(editingId, form.model, next);
      setStatus(
        isEnglish
          ? "Parallel tool calls setting saved."
          : "Preferência de chamadas paralelas salva.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save the parallel tool calls setting."
            : "Não foi possível salvar a preferência de chamadas paralelas.",
      );
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

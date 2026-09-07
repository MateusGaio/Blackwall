// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProgressIndicator } from "@/shared/components/motion/ProgressIndicator";
import { Button } from "@/shared/components/ui/button";
import {
  callE2EMcp,
  type E2EState,
  e2eScenarios,
  getE2EState,
  setE2EState,
} from "../../../shared/api/sidecar";
import { notifyQaMotionChange } from "../../../shared/qa-controls";

const labelFor: Record<(typeof e2eScenarios)[number], string> = {
  citation_review: "Revisão de citações",
  default: "Padrão",
  embedding_unavailable: "Embeddings indisponíveis",
  hybrid_search: "Busca híbrida",
  invalid_paths: "Paths inválidos",
  mcp: "MCP leitura/mutação",
  memory: "Memória determinística",
  memory_fail_once: "Memória fail-once",
  pdf_citation: "Citação PDF",
  pending_mutation: "Mutação pendente",
  search_turn_limit: "Limite de buscas por turno",
};

export function QaControlsSection() {
  const { t } = useTranslation();
  const [state, setState] = useState<E2EState | null>(null);
  const [motion, setMotion] = useState<"normal" | "reduced">("normal");
  const [textScale, setTextScale] = useState<"100" | "200">("100");
  const [latency, setLatency] = useState<"normal" | "slow">("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getE2EState()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t("settings.qaError"));
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.qaMotion = motion;
    root.dataset.qaTextScale = textScale;
    root.dataset.qaLatency = latency;
    notifyQaMotionChange();
    return () => {
      delete root.dataset.qaMotion;
      delete root.dataset.qaTextScale;
      delete root.dataset.qaLatency;
      notifyQaMotionChange();
    };
  }, [latency, motion, textScale]);

  async function chooseScenario(scenario: (typeof e2eScenarios)[number]) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      setState(await setE2EState(scenario));
      setStatus(t("settings.qaStateSaved"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.qaError"));
    } finally {
      setBusy(false);
    }
  }

  async function runMcp(operation: "read_marker" | "write_marker") {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await callE2EMcp(operation);
      setState((current) =>
        current
          ? { ...current, mcpReads: result.counters.reads, mcpWrites: result.counters.writes }
          : current,
      );
      setStatus(t("settings.qaMcpCompleted"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.qaError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="qa-controls-title" className="grid gap-5" data-testid="qa-controls">
      <div>
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
          QA
        </p>
        <h3 className="mt-1 text-base font-medium" id="qa-controls-title">
          {t("settings.qaTitle")}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{t("settings.qaDescription")}</p>
      </div>
      <div
        aria-busy={busy || state === null}
        className="grid gap-4 rounded-[var(--radius-panel)] border border-border p-4"
      >
        {state === null ? (
          <ProgressIndicator label={t("settings.qaLoading")} />
        ) : (
          <>
            <label className="grid gap-1 text-sm" htmlFor="qa-scenario">
              {t("settings.qaScenario")}
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                disabled={busy}
                id="qa-scenario"
                onChange={(event) =>
                  void chooseScenario(event.target.value as E2EState["scenario"])
                }
                value={state.scenario}
              >
                {e2eScenarios.map((scenario) => (
                  <option key={scenario} value={scenario}>
                    {labelFor[scenario]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="grid grid-cols-2 gap-3 text-sm">
              <legend className="sr-only">{t("settings.qaMcpCounters")}</legend>
              <span>
                {t("settings.qaMcpReads")}: {state.mcpReads}
              </span>
              <span>
                {t("settings.qaMcpWrites")}: {state.mcpWrites}
              </span>
            </fieldset>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void runMcp("read_marker")}
                type="button"
                variant="outline"
              >
                {t("settings.qaMcpRead")}
              </Button>
              <Button
                disabled={busy}
                onClick={() => void runMcp("write_marker")}
                type="button"
                variant="outline"
              >
                {t("settings.qaMcpWrite")}
              </Button>
            </div>
            <fieldset className="grid gap-2 border-t border-border pt-4 text-sm">
              <legend className="font-medium">{t("settings.qaMotion")}</legend>
              <div className="flex flex-wrap gap-3">
                {(["normal", "reduced"] as const).map((value) => (
                  <label className="flex items-center gap-2" key={value}>
                    <input
                      checked={motion === value}
                      name="qa-motion"
                      onChange={() => setMotion(value)}
                      type="radio"
                    />
                    {value === "normal"
                      ? t("settings.qaMotionNormal")
                      : t("settings.qaMotionReduced")}
                  </label>
                ))}
              </div>
            </fieldset>
            <label
              className="grid gap-1 border-t border-border pt-4 text-sm"
              htmlFor="qa-text-scale"
            >
              {t("settings.qaTextScale")}
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                id="qa-text-scale"
                onChange={(event) => setTextScale(event.target.value as "100" | "200")}
                value={textScale}
              >
                <option value="100">100%</option>
                <option value="200">200%</option>
              </select>
            </label>
            <label className="grid gap-1 border-t border-border pt-4 text-sm" htmlFor="qa-latency">
              {t("settings.qaLatency")}
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                id="qa-latency"
                onChange={(event) => setLatency(event.target.value as "normal" | "slow")}
                value={latency}
              >
                <option value="normal">{t("settings.qaLatencyNormal")}</option>
                <option value="slow">{t("settings.qaLatencySlow")}</option>
              </select>
            </label>
          </>
        )}
      </div>
      {status && (
        <p className="text-sm text-muted-foreground" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

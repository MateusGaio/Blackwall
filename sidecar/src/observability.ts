// MIT License — Copyright (c) 2026 Mateus Gaio
import { trace } from "@opentelemetry/api";

type TelemetryExporter = "disabled" | "sentry" | "datadog" | "newrelic";
const configuredExporter = process.env.BLACKWALL_TELEMETRY?.toLowerCase();
const exporters: TelemetryExporter[] = ["disabled", "sentry", "datadog", "newrelic"];
export const telemetryMode: TelemetryExporter = exporters.includes(
  configuredExporter as TelemetryExporter,
)
  ? (configuredExporter as TelemetryExporter)
  : "disabled";
const telemetryEndpoint = process.env.BLACKWALL_TELEMETRY_ENDPOINT ?? "";
const tracer = trace.getTracer("blackwall-sidecar");

/**
 * Cria um span sem exporter configurado. Dados de prompts e respostas nunca
 * devem ser adicionados a spans; exportação só poderá existir via opt-in futuro.
 *
 * `success` reflete o RESULTADO REAL do trabalho (#210/item 10): exceção
 * registra false — nunca mais sucesso no finally após throw.
 */
export function withInstrumentation<T>(
  name: string,
  work: () => T,
  onEvent?: (event: { name: string; success: boolean }) => void,
): T {
  return tracer.startActiveSpan(name, (span) => {
    let success = true;
    try {
      return work();
    } catch (error) {
      success = false;
      throw error;
    } finally {
      span.end();
      const event = { name, success };
      void emitTelemetry(event);
      onEvent?.(event);
    }
  });
}

export async function withAsyncInstrumentation<T>(
  name: string,
  work: () => Promise<T>,
  onEvent?: (event: { name: string; success: boolean }) => void,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    let success = true;
    try {
      return await work();
    } catch (error) {
      success = false;
      throw error;
    } finally {
      span.end();
      const event = { name, success };
      void emitTelemetry(event);
      onEvent?.(event);
    }
  });
}

/** Sends technical metadata only when an exporter and endpoint are explicitly configured. */
export async function emitTelemetry(event: {
  name: string;
  durationMs?: number;
  success?: boolean;
}): Promise<boolean> {
  if (telemetryMode === "disabled" || !telemetryEndpoint) return false;
  try {
    const response = await fetch(telemetryEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        exporter: telemetryMode,
        service: "blackwall-sidecar",
        event,
        timestamp: new Date().toISOString(),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

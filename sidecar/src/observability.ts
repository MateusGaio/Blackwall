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
 */
export function withInstrumentation<T>(name: string, work: () => T): T {
  return tracer.startActiveSpan(name, (span) => {
    try {
      return work();
    } finally {
      span.end();
      void emitTelemetry({ name, success: true });
    }
  });
}

export async function withAsyncInstrumentation<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    try {
      return await work();
    } finally {
      span.end();
      void emitTelemetry({ name, success: true });
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

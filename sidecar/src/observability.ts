// MIT License — Copyright (c) 2026 Mateus Gaio
import { trace } from "@opentelemetry/api";

export const telemetryMode = "disabled" as const;
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
    }
  });
}

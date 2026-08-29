// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  emitTelemetry,
  telemetryMode,
  withAsyncInstrumentation,
  withInstrumentation,
} from "./observability.js";

describe("observability", () => {
  it("mantém instrumentação local e sem exportação", () => {
    expect(telemetryMode).toBe("disabled");
    expect(withInstrumentation("test.span", () => "concluído")).toBe("concluído");
  });

  it("não envia nada sem opt-in explícito", async () => {
    expect(await emitTelemetry({ name: "chat.completed", success: true })).toBe(false);
  });

  it("#210/item10: exceção registra success=false (não sucesso no finally)", async () => {
    const events: Array<{ name: string; success: boolean }> = [];
    expect(() =>
      withInstrumentation(
        "span.falho",
        () => {
          throw new Error("boom");
        },
        (event) => events.push(event),
      ),
    ).toThrow("boom");
    await expect(
      withAsyncInstrumentation(
        "span.ok",
        async () => "valor",
        (event) => events.push(event),
      ),
    ).resolves.toBe("valor");
    expect(events).toEqual([
      { name: "span.falho", success: false },
      { name: "span.ok", success: true },
    ]);
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { emitTelemetry, telemetryMode, withInstrumentation } from "./observability.js";

describe("observability", () => {
  it("mantém instrumentação local e sem exportação", () => {
    expect(telemetryMode).toBe("disabled");
    expect(withInstrumentation("test.span", () => "concluído")).toBe("concluído");
  });

  it("não envia nada sem opt-in explícito", async () => {
    expect(await emitTelemetry({ name: "chat.completed", success: true })).toBe(false);
  });
});

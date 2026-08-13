// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { greetingForTime, supportedGreetingLanguages } from "./greetings";

describe("saudações do workspace", () => {
  it("oferece cinco faixas de horário em 25 idiomas", () => {
    expect(supportedGreetingLanguages).toHaveLength(25);
    for (const locale of supportedGreetingLanguages) {
      const greetings = [
        greetingForTime(new Date(2026, 0, 1, 2), locale),
        greetingForTime(new Date(2026, 0, 1, 8), locale),
        greetingForTime(new Date(2026, 0, 1, 14), locale),
        greetingForTime(new Date(2026, 0, 1, 19), locale),
        greetingForTime(new Date(2026, 0, 1, 23), locale),
      ];
      expect(greetings.every(Boolean)).toBe(true);
    }
  });

  it("mantém o contexto de horário em português", () => {
    expect(greetingForTime(new Date(2026, 0, 1, 8), "pt-BR")).toBe("Bom dia");
    expect(greetingForTime(new Date(2026, 0, 1, 14), "pt-BR")).toBe("Boa tarde");
    expect(greetingForTime(new Date(2026, 0, 1, 23), "pt-BR")).toBe("Tenha uma boa noite");
  });

  it("varia o idioma da saudação sem depender do idioma da interface", () => {
    const morning = greetingForTime(new Date(2026, 0, 1, 8), "mixed");
    const nextMorning = greetingForTime(new Date(2026, 0, 2, 8), "mixed");
    expect(morning).not.toBe(nextMorning);
  });
});

/* MIT License — Copyright (c) 2026 Mateus Gaio */
import { describe, expect, it } from "vitest";
import { DEFAULT_SOUL_PROMPT, getSoulPreset, identifySoul, SOUL_PRESETS } from "./souls";

describe("Soul presets", () => {
  it("usa o prompt Builder como padrão e permanece local-first", () => {
    expect(DEFAULT_SOUL_PROMPT).toContain("You are Blackwall Builder");
    expect(DEFAULT_SOUL_PROMPT).toContain("local-first");
  });

  it("inclui creative, dev e custom além do Builder", () => {
    expect(SOUL_PRESETS.map((preset) => preset.id)).toEqual([
      "blackwall",
      "creative",
      "dev",
      "custom",
    ]);
    expect(getSoulPreset("creative").prompt).toContain("imaginative");
  });

  it("Builder é colaborativa e proporcional ao risco; Dev permanece rigorosa com gates", () => {
    const builder = getSoulPreset("blackwall").prompt;
    const dev = getSoulPreset("dev").prompt;

    // Semântica Builder: entender/planejar/construir/revisar + ritual proporcional.
    for (const word of ["understanding", "planning", "building", "reviewing"]) {
      expect(builder).toContain(word);
    }
    expect(builder).toContain("proportional to risk");
    expect(builder).toContain("focused questions");
    expect(builder.toLowerCase()).not.toContain("generic creative");

    // Dev mantém o ritual completo de engenharia.
    expect(dev).toContain("OpenTelemetry");
    expect(dev).toContain("Playwright");
    expect(dev).toContain("Closes #<issue>");
    // Diferencial chave: Dev exige o fluxo sempre; Builder só quando o pedido justifica.
    expect(builder).toContain("unless the user asks");
  });

  it("reconhece presets e trata prompts editados como custom", () => {
    expect(identifySoul(DEFAULT_SOUL_PROMPT)).toBe("blackwall");
    expect(identifySoul(getSoulPreset("dev").prompt)).toBe("dev");
    expect(identifySoul(`${DEFAULT_SOUL_PROMPT}\nBe concise.`)).toBe("custom");
  });
});

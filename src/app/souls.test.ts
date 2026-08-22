/* MIT License — Copyright (c) 2026 Mateus Gaio */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOUL_PROMPT,
  getSoulPreset,
  identifySoul,
  SOUL_PRESETS,
} from "./souls";

describe("Soul presets", () => {
  it("uses the English Blackwall prompt as the default", () => {
    expect(DEFAULT_SOUL_PROMPT).toContain("You are Blackwall");
    expect(DEFAULT_SOUL_PROMPT).toContain("local-first");
  });

  it("includes creative, dev and custom personalities", () => {
    expect(SOUL_PRESETS.map((preset) => preset.id)).toEqual([
      "blackwall",
      "creative",
      "dev",
      "custom",
    ]);
    expect(getSoulPreset("creative").prompt).toContain("imaginative");
    expect(getSoulPreset("dev").prompt).toContain("OpenTelemetry");
    expect(getSoulPreset("dev").prompt).toContain("Playwright");
    expect(getSoulPreset("dev").prompt).toContain("Closes #<issue>");
  });

  it("recognizes presets and treats edited prompts as custom", () => {
    expect(identifySoul(DEFAULT_SOUL_PROMPT)).toBe("blackwall");
    expect(identifySoul(getSoulPreset("dev").prompt)).toBe("dev");
    expect(identifySoul(`${DEFAULT_SOUL_PROMPT}\nBe concise.`)).toBe("custom");
  });
});

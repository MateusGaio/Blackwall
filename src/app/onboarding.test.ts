// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { clampOnboardingStep, detectInitialLocale, onboardingSteps } from "./onboarding";

describe("onboarding", () => {
  it("mantém a etapa dentro dos limites do fluxo", () => {
    expect(clampOnboardingStep(-1)).toBe(0);
    expect(clampOnboardingStep(99)).toBe(onboardingSteps.length - 1);
  });

  it("prioriza português para sistemas em português", () => {
    expect(detectInitialLocale("pt-BR")).toBe("pt-BR");
    expect(detectInitialLocale("en-US")).toBe("en");
  });
});

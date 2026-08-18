// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  clampOnboardingStep,
  detectInitialLocale,
  nextOnboardingStepIndex,
  onboardingSteps,
  previousOnboardingStepIndex,
} from "./onboarding";

describe("onboarding", () => {
  it("mantém a etapa dentro dos limites do fluxo", () => {
    expect(clampOnboardingStep(-1)).toBe(0);
    expect(clampOnboardingStep(99)).toBe(onboardingSteps.length - 1);
  });

  it("prioriza português para sistemas em português", () => {
    expect(detectInitialLocale("pt-BR")).toBe("pt-BR");
    expect(detectInitialLocale("en-US")).toBe("en");
  });

  it("pula o contexto de workspace quando o usuário escolhe iniciar sem workspace", () => {
    const workspaceSoulIndex = onboardingSteps.findIndex((step) => step.id === "workspace-soul");
    const soulIndex = onboardingSteps.findIndex((step) => step.id === "soul");
    const providerIndex = onboardingSteps.findIndex((step) => step.id === "provider");

    expect(nextOnboardingStepIndex(soulIndex, true)).toBe(providerIndex);
    expect(previousOnboardingStepIndex(providerIndex, true)).toBe(soulIndex);
    expect(workspaceSoulIndex).toBeGreaterThan(soulIndex);
  });
});

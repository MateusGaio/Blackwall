// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import {
  clampOnboardingStep,
  detectInitialLocale,
  onboardingSteps,
  visibleOnboardingSteps,
} from "./onboarding";

describe("onboarding", () => {
  it("mantém a etapa dentro dos limites do fluxo visível", () => {
    const total = visibleOnboardingSteps(true).length;
    expect(clampOnboardingStep(-1, total)).toBe(0);
    expect(clampOnboardingStep(99, total)).toBe(total - 1);
    // Fluxo sem workspace tem uma etapa a menos; o limite acompanha.
    const shortTotal = visibleOnboardingSteps(false).length;
    expect(clampOnboardingStep(99, shortTotal)).toBe(shortTotal - 1);
  });

  it("prioriza português para sistemas em português", () => {
    expect(detectInitialLocale("pt-BR")).toBe("pt-BR");
    expect(detectInitialLocale("en-US")).toBe("en");
  });

  it("exclui apenas o contexto do workspace quando não há workspace", () => {
    const full = visibleOnboardingSteps(true);
    const withoutWorkspace = visibleOnboardingSteps(false);
    expect(full).toHaveLength(onboardingSteps.length);
    expect(withoutWorkspace.map((step) => step.id)).toEqual(
      full.filter((step) => step.id !== "workspace-soul").map((step) => step.id),
    );
    expect(withoutWorkspace.some((step) => step.id === "provider")).toBe(true);
    expect(withoutWorkspace.some((step) => step.id === "vault")).toBe(true);
  });
});

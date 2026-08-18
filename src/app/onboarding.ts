// MIT License — Copyright (c) 2026 Mateus Gaio
export const onboardingSteps = [
  { id: "language", label: "Idioma", title: "Seu espaço local para pensar e construir." },
  { id: "profile", label: "Perfil", title: "Como devemos chamar você?" },
  { id: "workspace", label: "Workspace", title: "Onde vamos trabalhar?" },
  { id: "folder", label: "Pasta", title: "Escolha a pasta do projeto." },
  { id: "soul", label: "Soul", title: "Comece com uma Soul pronta." },
  {
    id: "workspace-soul",
    label: "Contexto do workspace",
    title: "Dê contexto ao workspace.",
  },
  { id: "provider", label: "Provedor", title: "Conecte sua primeira inteligência." },
  { id: "vault", label: "Vault", title: "Conhecimento que continua com você." },
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number];

export function clampOnboardingStep(step: number): number {
  return Math.min(Math.max(step, 0), onboardingSteps.length - 1);
}

export function nextOnboardingStepIndex(step: number, withoutWorkspace: boolean): number {
  let next = clampOnboardingStep(step + 1);
  while (withoutWorkspace && onboardingSteps[next]?.id === "workspace-soul") {
    next = clampOnboardingStep(next + 1);
  }
  return next;
}

export function previousOnboardingStepIndex(step: number, withoutWorkspace: boolean): number {
  let previous = clampOnboardingStep(step - 1);
  while (withoutWorkspace && onboardingSteps[previous]?.id === "workspace-soul") {
    previous = clampOnboardingStep(previous - 1);
  }
  return previous;
}

export function detectInitialLocale(language?: string): "pt-BR" | "en" {
  return language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

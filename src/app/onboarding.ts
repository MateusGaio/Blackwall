// MIT License — Copyright (c) 2026 Mateus Gaio
export const onboardingSteps = [
  { id: "language", label: "Idioma", title: "Seu espaço local para pensar e construir." },
  { id: "profile", label: "Perfil", title: "Como devemos chamar você?" },
  { id: "workspace", label: "Workspace", title: "Onde vamos trabalhar?" },
  { id: "folder", label: "Pasta", title: "Escolha a pasta do projeto." },
  { id: "soul", label: "Soul", title: "Comece com uma Soul pronta." },
  { id: "workspace-soul", label: "Soul do workspace", title: "Dê uma identidade ao workspace." },
  { id: "provider", label: "Provedor", title: "Conecte sua primeira inteligência." },
  { id: "vault", label: "Vault", title: "Conhecimento que continua com você." },
] as const;

export type OnboardingStep = (typeof onboardingSteps)[number];

export function clampOnboardingStep(step: number): number {
  return Math.min(Math.max(step, 0), onboardingSteps.length - 1);
}

export function detectInitialLocale(language?: string): "pt-BR" | "en" {
  return language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

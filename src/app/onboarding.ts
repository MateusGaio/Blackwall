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

/**
 * Etapas efetivamente visíveis. O contexto do workspace ("workspace-soul") só
 * existe quando há um workspace: ao escolher "iniciar sem workspace" a etapa é
 * removida da lista e toda a navegação (frente, trás, Enter e contador) usa
 * esta lista, evitando cair na tela pulada ou exibir progresso fantasma.
 */
export function visibleOnboardingSteps(withWorkspaceContext: boolean): OnboardingStep[] {
  return onboardingSteps.filter((step) => withWorkspaceContext || step.id !== "workspace-soul");
}

export function clampOnboardingStep(step: number, visibleTotal: number): number {
  return Math.min(Math.max(step, 0), Math.max(0, visibleTotal - 1));
}

export function detectInitialLocale(language?: string): "pt-BR" | "en" {
  return language?.toLowerCase().startsWith("pt") ? "pt-BR" : "en";
}

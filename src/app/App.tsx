// MIT License — Copyright (c) 2026 Mateus Gaio
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { currentRuntime } from "../platform/runtime";
import type { ConnectedProvider } from "../shared/api/sidecar";
import {
  clampOnboardingStep,
  detectInitialLocale,
  type OnboardingStep,
  onboardingSteps,
} from "./onboarding";

const WorkspaceShell = lazy(async () => import("./WorkspaceShell"));
const ProviderSetup = lazy(async () => {
  const module = await import("../features/config/components/ProviderSetup");
  return { default: module.ProviderSetup };
});

function LoadingSkeleton() {
  return (
    <main aria-busy="true" className="app-shell loading-shell">
      <div className="loading-mark skeleton" />
      <div className="loading-line skeleton" />
      <div className="loading-card skeleton" />
    </main>
  );
}

type OnboardingPanelProps = {
  locale: "pt-BR" | "en";
  profileName: string;
  soul: string;
  step: OnboardingStep;
  isExiting: boolean;
  runtime: "desktop" | "web";
  onLocaleChange: (locale: "pt-BR" | "en") => void;
  onProfileNameChange: (name: string) => void;
  onSoulChange: (soul: string) => void;
  onProviderConnected: (provider: ConnectedProvider) => void;
  onAdvance: (animate: boolean) => void;
  onBack: (animate: boolean) => void;
};

function OnboardingPanel({
  locale,
  profileName,
  soul,
  step,
  isExiting,
  runtime,
  onLocaleChange,
  onProfileNameChange,
  onSoulChange,
  onProviderConnected,
  onAdvance,
  onBack,
}: OnboardingPanelProps) {
  const stepIndex = onboardingSteps.findIndex((item) => item.id === step.id);
  const isLastStep = stepIndex === onboardingSteps.length - 1;
  const progress = `${((stepIndex + 1) / onboardingSteps.length) * 100}%`;

  return (
    <main className="app-shell">
      <aside className="brand-column" aria-label="Blackwall">
        <div>
          <span className="brand-mark" aria-hidden="true">
            BW
          </span>
          <p className="eyebrow">Blackwall / local-first</p>
        </div>
        <p className="brand-note">Privado por padrão. Seu contexto continua no seu computador.</p>
      </aside>

      <section className="onboarding-area" aria-label="Configuração inicial">
        <header className="progress-header">
          <p>
            {String(stepIndex + 1).padStart(2, "0")} /{" "}
            {String(onboardingSteps.length).padStart(2, "0")}
          </p>
          <div
            aria-label={`Etapa ${stepIndex + 1} de ${onboardingSteps.length}`}
            aria-valuemax={onboardingSteps.length}
            aria-valuemin={1}
            aria-valuenow={stepIndex + 1}
            className="progress-track"
            role="progressbar"
          >
            <span
              className="progress-value"
              style={{ transform: `scaleX(${(stepIndex + 1) / onboardingSteps.length})` }}
            />
          </div>
        </header>

        <div className={`onboarding-card ${isExiting ? "is-leaving" : ""}`} key={step.id}>
          <p className="eyebrow">{step.label}</p>
          <h1>{step.title}</h1>
          {step.id === "language" && (
            <div className="choice-list" role="radiogroup" aria-label="Idioma">
              <button
                className={locale === "pt-BR" ? "choice is-selected" : "choice"}
                onClick={() => onLocaleChange("pt-BR")}
                aria-pressed={locale === "pt-BR"}
                type="button"
              >
                Português do Brasil
                <span>PT-BR</span>
              </button>
              <button
                className={locale === "en" ? "choice is-selected" : "choice"}
                onClick={() => onLocaleChange("en")}
                aria-pressed={locale === "en"}
                type="button"
              >
                English
                <span>EN</span>
              </button>
            </div>
          )}
          {step.id === "profile" && (
            <label className="field-label" htmlFor="profile-name">
              Nome do perfil
              <input
                autoComplete="name"
                id="profile-name"
                onChange={(event) => onProfileNameChange(event.target.value)}
                placeholder="Seu nome"
                value={profileName}
              />
            </label>
          )}
          {step.id === "soul" && (
            <label className="field-label" htmlFor="soul-prompt">
              Soul do perfil
              <textarea
                id="soul-prompt"
                onChange={(event) => onSoulChange(event.target.value)}
                rows={5}
                value={soul}
              />
              <span className="field-hint">
                Você poderá combinar esta Soul com a do workspace depois.
              </span>
            </label>
          )}
          {step.id === "provider" && (
            <Suspense fallback={<div className="provider-skeleton skeleton" aria-busy="true" />}>
              <ProviderSetup onConnected={onProviderConnected} />
            </Suspense>
          )}
          {step.id === "vault" && (
            <div className="info-panel">
              <strong>Um Vault real, em Markdown.</strong>
              <p>
                O Blackwall manterá notas, links e contexto em arquivos que você também pode abrir
                no Obsidian.
              </p>
            </div>
          )}

          <footer className="card-actions">
            <button
              className="button button-secondary"
              disabled={stepIndex === 0 || isExiting}
              onClick={(event) => onBack(event.detail !== 0)}
              type="button"
            >
              Voltar
            </button>
            {step.id !== "provider" && (
              <button
                className="button button-primary"
                disabled={isExiting || (step.id === "profile" && profileName.trim().length === 0)}
                onClick={(event) => onAdvance(event.detail !== 0)}
                type="button"
              >
                {isLastStep ? "Entrar no Blackwall" : "Continuar"}
              </button>
            )}
          </footer>
        </div>
        <p className="stage-status">
          Configuração local · {runtime} · {progress} concluída
        </p>
      </section>
    </main>
  );
}

export function App() {
  const [isReady, setIsReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [locale, setLocale] = useState<"pt-BR" | "en">(() =>
    detectInitialLocale(navigator.language),
  );
  const [profileName, setProfileName] = useState("");
  const [soul, setSoul] = useState(
    "Você é uma assistente clara, direta e preparada para ajudar com código.",
  );
  const [provider, setProvider] = useState<ConnectedProvider | null>(null);
  const runtime = currentRuntime();

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setIsReady(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const currentStep = useMemo(() => onboardingSteps[stepIndex], [stepIndex]);

  function navigate(nextStep: number, animate: boolean) {
    const safeStep = clampOnboardingStep(nextStep);
    if (safeStep === stepIndex || isExiting) return;
    if (!animate) {
      setStepIndex(safeStep);
      return;
    }

    setIsExiting(true);
    window.setTimeout(() => {
      setStepIndex(safeStep);
      setIsExiting(false);
    }, 150);
  }

  function advance(animate: boolean) {
    if (stepIndex === onboardingSteps.length - 1) {
      setIsComplete(true);
      return;
    }
    navigate(stepIndex + 1, animate);
  }

  function providerConnected(connectedProvider: ConnectedProvider) {
    setProvider(connectedProvider);
    navigate(stepIndex + 1, true);
  }

  useEffect(() => {
    function advanceWithEnter(event: KeyboardEvent) {
      if (
        event.key !== "Enter" ||
        isComplete ||
        isExiting ||
        onboardingSteps[stepIndex].id === "provider"
      )
        return;
      if (onboardingSteps[stepIndex].id === "profile" && !profileName.trim()) return;
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (stepIndex === onboardingSteps.length - 1) {
        setIsComplete(true);
        return;
      }
      setStepIndex(clampOnboardingStep(stepIndex + 1));
    }

    window.addEventListener("keydown", advanceWithEnter);
    return () => window.removeEventListener("keydown", advanceWithEnter);
  }, [isComplete, isExiting, profileName, stepIndex]);

  if (!isReady) return <LoadingSkeleton />;
  if (isComplete) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <WorkspaceShell profileName={profileName} provider={provider} />
      </Suspense>
    );
  }

  return (
    <OnboardingPanel
      isExiting={isExiting}
      locale={locale}
      onAdvance={advance}
      onBack={(animate) => navigate(stepIndex - 1, animate)}
      onLocaleChange={setLocale}
      onProfileNameChange={setProfileName}
      onSoulChange={setSoul}
      onProviderConnected={providerConnected}
      profileName={profileName}
      soul={soul}
      step={currentStep}
      runtime={runtime}
    />
  );
}

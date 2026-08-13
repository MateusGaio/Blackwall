// MIT License — Copyright (c) 2026 Mateus Gaio
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { currentRuntime, type FolderSelection, pickDirectory } from "../platform/runtime";
import {
  type AppState,
  bootstrapApp,
  type ConnectedProvider,
  deleteProfile,
  getAppState,
  listProviders,
  type Profile,
  selectProfile,
  signOutProfile,
} from "../shared/api/sidecar";
import { SoulPicker } from "../shared/components/SoulPicker";
import {
  clampOnboardingStep,
  detectInitialLocale,
  type OnboardingStep,
  onboardingSteps,
} from "./onboarding";
import { DEFAULT_SOUL_PROMPT } from "./souls";

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

type ProfileChooserProps = {
  isSelecting: boolean;
  locale: "pt-BR" | "en";
  onCreate: () => void;
  onSelect: (profileId: string) => void;
  profiles: Profile[];
};

function ProfileChooser({
  isSelecting,
  locale,
  onCreate,
  onSelect,
  profiles,
}: ProfileChooserProps) {
  const isEnglish = locale === "en";
  return (
    <main className="app-shell profile-chooser-shell">
      <aside className="brand-column" aria-label="Blackwall">
        <div>
          <span className="brand-mark" aria-hidden="true">
            BW
          </span>
          <p className="eyebrow">Blackwall / local-first</p>
        </div>
        <p className="brand-note">
          {isEnglish
            ? "Private by default. Your context stays on your computer."
            : "Privado por padrão. Seu contexto continua no seu computador."}
        </p>
      </aside>
      <section
        className="onboarding-area profile-chooser-area"
        aria-label={isEnglish ? "Choose a profile" : "Escolha de perfil"}
      >
        <div className="profile-chooser-card">
          <p className="eyebrow">{isEnglish ? "Profile" : "Perfil"}</p>
          <h1>{isEnglish ? "Who is using Blackwall?" : "Quem está usando o Blackwall?"}</h1>
          <p className="profile-chooser-intro">
            {isEnglish
              ? "Choose a saved profile or create a new one. Your conversations remain local."
              : "Escolha um perfil salvo ou crie um novo. Suas conversas permanecem locais."}
          </p>
          <ul className="profile-choice-list">
            {profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  className="profile-choice"
                  disabled={isSelecting}
                  onClick={() => onSelect(profile.id)}
                  type="button"
                >
                  <span className="profile-choice-avatar" aria-hidden="true">
                    {profile.avatarData ? (
                      <img alt="" src={profile.avatarData} />
                    ) : (
                      profile.name.slice(0, 2).toUpperCase()
                    )}
                  </span>
                  <span className="profile-choice-copy">
                    <strong>{profile.name}</strong>
                    <small>{profile.soul.split("\n")[0].slice(0, 80)}</small>
                  </span>
                  <span className="profile-choice-arrow" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button button-primary profile-create-button"
            onClick={onCreate}
            type="button"
          >
            {isEnglish ? "Create new profile" : "Criar novo perfil"}
          </button>
        </div>
      </section>
    </main>
  );
}

type OnboardingPanelProps = {
  locale: "pt-BR" | "en";
  profileName: string;
  soul: string;
  workspaceName: string;
  folderSelection: FolderSelection | null;
  startWithoutWorkspace: boolean;
  workspaceSoul: string;
  isCompleting: boolean;
  completionError: string;
  step: OnboardingStep;
  isExiting: boolean;
  runtime: "desktop" | "web";
  onLocaleChange: (locale: "pt-BR" | "en") => void;
  onProfileNameChange: (name: string) => void;
  onSoulChange: (soul: string) => void;
  onWorkspaceNameChange: (name: string) => void;
  onStartWithoutWorkspace: () => void;
  onWorkspaceSoulChange: (soul: string) => void;
  onPickFolder: () => void;
  onProviderConnected: (provider: ConnectedProvider) => void;
  onAdvance: (animate: boolean) => void;
  onBack: (animate: boolean) => void;
};

function OnboardingPanel({
  locale,
  profileName,
  soul,
  workspaceName,
  folderSelection,
  startWithoutWorkspace,
  workspaceSoul,
  isCompleting,
  completionError,
  step,
  isExiting,
  runtime,
  onLocaleChange,
  onProfileNameChange,
  onSoulChange,
  onWorkspaceNameChange,
  onStartWithoutWorkspace,
  onWorkspaceSoulChange,
  onPickFolder,
  onProviderConnected,
  onAdvance,
  onBack,
}: OnboardingPanelProps) {
  const { t } = useTranslation();
  const stepIndex = onboardingSteps.findIndex((item) => item.id === step.id);
  const isLastStep = stepIndex === onboardingSteps.length - 1;
  const progress = `${((stepIndex + 1) / onboardingSteps.length) * 100}%`;
  const isEnglish = locale === "en";
  const title = isEnglish
    ? {
        language: "Your local space to think and build.",
        profile: "What should we call you?",
        workspace: "Where will we work?",
        folder: "Choose the project folder.",
        "workspace-soul": "Give your workspace context.",
        provider: "Connect your first intelligence.",
        soul: "Start with a ready-made Soul.",
        vault: "Knowledge that stays with you.",
      }[step.id]
    : step.title;
  const label = isEnglish
    ? {
        language: "Language",
        profile: "Profile",
        workspace: "Workspace",
        folder: "Folder",
        "workspace-soul": "Workspace context",
        provider: "Provider",
        soul: "Soul",
        vault: "Vault",
      }[step.id]
    : step.label;
  const brandNote = t("brand.note");

  return (
    <main className="app-shell">
      <aside className="brand-column" aria-label="Blackwall">
        <div>
          <span className="brand-mark" aria-hidden="true">
            BW
          </span>
          <p className="eyebrow">Blackwall / local-first</p>
        </div>
        <p className="brand-note">{brandNote}</p>
      </aside>

      <section
        className="onboarding-area"
        aria-label={isEnglish ? "Initial setup" : "Configuração inicial"}
      >
        <header className="progress-header">
          <p>
            {String(stepIndex + 1).padStart(2, "0")} /{" "}
            {String(onboardingSteps.length).padStart(2, "0")}
          </p>
          <div
            aria-label={
              isEnglish
                ? `Step ${stepIndex + 1} of ${onboardingSteps.length}`
                : `Etapa ${stepIndex + 1} de ${onboardingSteps.length}`
            }
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
          <p className="eyebrow">{label}</p>
          <h1>{title}</h1>
          {step.id === "language" && (
            <div
              className="choice-list"
              role="radiogroup"
              aria-label={isEnglish ? "Language" : "Idioma"}
            >
              <button
                className={locale === "pt-BR" ? "choice is-selected" : "choice"}
                onClick={() => onLocaleChange("pt-BR")}
                aria-pressed={locale === "pt-BR"}
                type="button"
              >
                {isEnglish ? "Portuguese (Brazil)" : "Português do Brasil"}
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
              {isEnglish ? "Profile name" : "Nome do perfil"}
              <input
                autoComplete="name"
                id="profile-name"
                onChange={(event) => onProfileNameChange(event.target.value)}
                placeholder={isEnglish ? "Your name" : "Seu nome"}
                value={profileName}
              />
            </label>
          )}
          {step.id === "workspace" && (
            <label className="field-label" htmlFor="workspace-name">
              {isEnglish ? "Workspace name" : "Nome do workspace"}
              <input
                id="workspace-name"
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
                placeholder={isEnglish ? "My project" : "Meu projeto"}
                value={workspaceName}
              />
            </label>
          )}
          {step.id === "folder" && (
            <div className="folder-picker">
              <button className="folder-select-button" onClick={onPickFolder} type="button">
                <span className="folder-select-icon" aria-hidden="true">
                  ⌘
                </span>
                <span>
                  <strong>{isEnglish ? "Choose folder" : "Escolher pasta"}</strong>
                  <small>
                    {runtime === "desktop"
                      ? isEnglish
                        ? "Open the system file explorer"
                        : "Abrir o explorador de arquivos"
                      : isEnglish
                        ? "Open the browser file explorer"
                        : "Abrir o explorador do navegador"}
                  </small>
                </span>
              </button>
              <button
                aria-pressed={startWithoutWorkspace}
                className={startWithoutWorkspace ? "choice is-selected" : "choice"}
                onClick={onStartWithoutWorkspace}
                type="button"
              >
                <span>
                  {isEnglish ? "Start without a workspace" : "Começar sem um workspace"}
                  <small>
                    {isEnglish
                      ? "Add a project folder later"
                      : "Adicione uma pasta de projeto depois"}
                  </small>
                </span>
                <span>{startWithoutWorkspace ? "✓" : ""}</span>
              </button>
              {folderSelection && (
                <div className="folder-selected" role="status">
                  <strong>{folderSelection.name}</strong>
                  {folderSelection.source === "web" && (
                    <span>
                      {folderSelection.files.length}{" "}
                      {isEnglish ? "Markdown files selected" : "arquivos Markdown selecionados"}
                    </span>
                  )}
                </div>
              )}
              <span className="field-hint">
                {isEnglish
                  ? "Choose a folder to use files and the Vault, or start without a workspace."
                  : "Escolha uma pasta para usar arquivos e o Vault, ou inicie sem workspace."}
              </span>
            </div>
          )}
          {step.id === "soul" && (
            <SoulPicker
              hint={
                isEnglish
                  ? "This Soul guides your profile in every workspace. You can edit any preset."
                  : "Esta Soul orienta seu perfil em todos os workspaces. Você pode editar qualquer preset."
              }
              id="soul-prompt"
              label={isEnglish ? "Profile Soul" : "Soul do perfil"}
              locale={locale}
              onChange={onSoulChange}
              value={soul}
            />
          )}
          {step.id === "workspace-soul" && (
            <label className="field-label" htmlFor="workspace-soul-prompt">
              {isEnglish ? "Workspace context" : "Contexto do workspace"}
              <textarea
                id="workspace-soul-prompt"
                onChange={(event) => onWorkspaceSoulChange(event.target.value)}
                placeholder={
                  isEnglish
                    ? "Describe the project, conventions and goals…"
                    : "Descreva o projeto, as convenções e os objetivos…"
                }
                rows={6}
                value={workspaceSoul}
              />
              <span className="field-hint">
                {isEnglish
                  ? "Add context that should guide conversations in this workspace."
                  : "Adicione o contexto que deve orientar as conversas neste workspace."}
              </span>
            </label>
          )}
          {step.id === "provider" && (
            <Suspense fallback={<div className="provider-skeleton skeleton" aria-busy="true" />}>
              <ProviderSetup locale={locale} onConnected={onProviderConnected} />
            </Suspense>
          )}
          {step.id === "vault" && (
            <div className="info-panel">
              <strong>
                {isEnglish ? "A real Vault, in Markdown." : "Um Vault real, em Markdown."}
              </strong>
              <p>
                {isEnglish
                  ? "Blackwall will keep notes, links, and context in files you can also open in Obsidian."
                  : "O Blackwall manterá notas, links e contexto em arquivos que você também pode abrir no Obsidian."}
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
              {isEnglish ? "Back" : "Voltar"}
            </button>
            {step.id !== "provider" && (
              <button
                className="button button-primary"
                disabled={
                  isExiting ||
                  isCompleting ||
                  (step.id === "profile" && profileName.trim().length === 0) ||
                  (step.id === "workspace" && workspaceName.trim().length === 0) ||
                  (step.id === "folder" && !folderSelection && !startWithoutWorkspace)
                }
                onClick={(event) => onAdvance(event.detail !== 0)}
                type="button"
              >
                {isCompleting
                  ? isEnglish
                    ? "Saving…"
                    : "Salvando…"
                  : isLastStep
                    ? isEnglish
                      ? "Enter Blackwall"
                      : "Entrar no Blackwall"
                    : isEnglish
                      ? "Continue"
                      : "Continuar"}
              </button>
            )}
          </footer>
          {completionError && <p className="form-error">{completionError}</p>}
        </div>
        <p className="stage-status">
          {isEnglish ? "Local setup" : "Configuração local"} · {runtime} · {progress}{" "}
          {isEnglish ? "complete" : "concluída"}
        </p>
      </section>
    </main>
  );
}

export function App() {
  const { i18n } = useTranslation();
  const [isReady, setIsReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState("");
  const [appState, setAppState] = useState<AppState | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<Profile[]>([]);
  const [showProfileChooser, setShowProfileChooser] = useState(false);
  const [isSelectingProfile, setIsSelectingProfile] = useState(false);
  const [locale, setLocale] = useState<"pt-BR" | "en">(() =>
    detectInitialLocale(navigator.language),
  );
  const [profileName, setProfileName] = useState("");
  const defaultProfileSoul = DEFAULT_SOUL_PROMPT;
  const [soul, setSoul] = useState(defaultProfileSoul);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceRootPath, setWorkspaceRootPath] = useState("");
  const [folderSelection, setFolderSelection] = useState<FolderSelection | null>(null);
  const [startWithoutWorkspace, setStartWithoutWorkspace] = useState(false);
  const [workspaceSoul, setWorkspaceSoul] = useState("");
  const [provider, setProvider] = useState<ConnectedProvider | null>(null);
  const runtime = currentRuntime();

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [i18n, locale]);

  useEffect(() => {
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => setIsReady(true));
    void getAppState()
      .then(async (state) => {
        if (cancelled) return;
        setAvailableProfiles(state.profiles);
        // A profile is always an explicit entry point. This prevents the last
        // active conversation from opening under the wrong person after a
        // restart, while still keeping all data available to the chooser.
        if (state.profiles.length > 0) {
          setAppState(state);
          setShowProfileChooser(true);
          return;
        }
        const profile = state.profiles.find((item) => item.id === state.activeProfileId);
        const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
        if (!profile) return;
        setAppState(state);
        setProfileName(profile.name);
        setLocale(profile.locale === "en" ? "en" : "pt-BR");
        setWorkspaceName(workspace?.name ?? "");
        setWorkspaceRootPath(workspace?.rootPath ?? "");
        setWorkspaceSoul(workspace?.soul ?? "");
        setStartWithoutWorkspace(!workspace);
        const providers = await listProviders();
        const activeSession = state.sessions.find((item) => item.id === state.activeSessionId);
        setProvider(
          providers.find((item) => item.id === activeSession?.selectedProviderId) ??
            providers[0] ??
            null,
        );
        setShowProfileChooser(false);
        setIsComplete(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
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
      void completeOnboarding();
      return;
    }
    navigate(stepIndex + 1, animate);
  }

  function providerConnected(connectedProvider: ConnectedProvider) {
    setProvider(connectedProvider);
    navigate(stepIndex + 1, true);
  }

  function resetOnboarding() {
    setStepIndex(0);
    setIsExiting(false);
    setCompletionError("");
    setProfileName("");
    setSoul(defaultProfileSoul);
    setWorkspaceName("");
    setWorkspaceRootPath("");
    setFolderSelection(null);
    setStartWithoutWorkspace(false);
    setWorkspaceSoul("");
    setProvider(null);
  }

  function startNewProfile() {
    resetOnboarding();
    setAppState(null);
    setShowProfileChooser(false);
  }

  async function chooseProfile(profileId: string) {
    setIsSelectingProfile(true);
    setCompletionError("");
    try {
      const state = await selectProfile(profileId);
      const profile = state.profiles.find((item) => item.id === profileId);
      if (!profile) throw new Error("O perfil selecionado não existe.");
      const workspace = state.workspaces.find((item) => item.id === state.activeWorkspaceId);
      const providers = await listProviders();
      const activeSession = state.sessions.find((item) => item.id === state.activeSessionId);
      setAppState(state);
      setAvailableProfiles(state.profiles);
      setProfileName(profile.name);
      setLocale(profile.locale === "en" ? "en" : "pt-BR");
      setWorkspaceName(workspace?.name ?? "");
      setWorkspaceRootPath(workspace?.rootPath ?? "");
      setWorkspaceSoul(workspace?.soul ?? "");
      setStartWithoutWorkspace(!workspace);
      setProvider(
        providers.find((item) => item.id === activeSession?.selectedProviderId) ??
          providers[0] ??
          null,
      );
      setShowProfileChooser(false);
      setIsComplete(true);
    } catch (reason) {
      setCompletionError(
        reason instanceof Error ? reason.message : "Não foi possível abrir esse perfil.",
      );
    } finally {
      setIsSelectingProfile(false);
    }
  }

  async function exitProfile() {
    try {
      const state = await signOutProfile();
      setAvailableProfiles(state.profiles);
      setAppState(state);
      resetOnboarding();
      setIsComplete(false);
      setShowProfileChooser(state.profiles.length > 0);
    } catch (reason) {
      setCompletionError(
        reason instanceof Error ? reason.message : "Não foi possível sair do perfil.",
      );
    }
  }

  async function removeProfile(profileId: string) {
    try {
      const state = await deleteProfile(profileId);
      setAvailableProfiles(state.profiles);
      setAppState(state);
      resetOnboarding();
      setIsComplete(false);
      setShowProfileChooser(state.profiles.length > 0);
    } catch (reason) {
      setCompletionError(
        reason instanceof Error ? reason.message : "Não foi possível excluir o perfil.",
      );
      throw reason;
    }
  }

  const completeOnboarding = useCallback(async () => {
    setCompletionError("");
    setIsCompleting(true);
    try {
      const workspaceMode =
        startWithoutWorkspace || (!workspaceRootPath.trim() && !folderSelection)
          ? "none"
          : "workspace";
      const state = await bootstrapApp({
        locale,
        permissionMode: "ask",
        profileName,
        profileSoul: soul,
        workspaceName,
        workspaceRootPath,
        workspaceFiles: folderSelection?.files,
        workspaceMode,
        workspaceSoul,
      });
      setAppState(state);
      setAvailableProfiles(state.profiles);
      setShowProfileChooser(false);
      setIsComplete(true);
    } catch (reason) {
      setCompletionError(
        reason instanceof Error ? reason.message : "Não foi possível salvar a configuração.",
      );
    } finally {
      setIsCompleting(false);
    }
  }, [
    folderSelection,
    locale,
    profileName,
    soul,
    startWithoutWorkspace,
    workspaceRootPath,
    workspaceName,
    workspaceSoul,
  ]);

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
      if (onboardingSteps[stepIndex].id === "workspace" && !workspaceName.trim()) return;
      if (onboardingSteps[stepIndex].id === "folder" && !folderSelection && !startWithoutWorkspace)
        return;
      if (event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (stepIndex === onboardingSteps.length - 1) {
        void completeOnboarding();
        return;
      }
      setStepIndex(clampOnboardingStep(stepIndex + 1));
    }

    window.addEventListener("keydown", advanceWithEnter);
    return () => window.removeEventListener("keydown", advanceWithEnter);
  }, [
    completeOnboarding,
    folderSelection,
    isComplete,
    isExiting,
    profileName,
    startWithoutWorkspace,
    stepIndex,
    workspaceName,
  ]);

  if (!isReady) return <LoadingSkeleton />;
  if (showProfileChooser) {
    return (
      <ProfileChooser
        isSelecting={isSelectingProfile}
        locale={locale}
        onCreate={startNewProfile}
        onSelect={(profileId) => void chooseProfile(profileId)}
        profiles={availableProfiles}
      />
    );
  }
  if (isComplete) {
    return (
      <Suspense fallback={<LoadingSkeleton />}>
        <WorkspaceShell
          appState={appState}
          onDeleteProfile={removeProfile}
          onSignOut={exitProfile}
          profileName={profileName}
          provider={provider}
        />
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
      onWorkspaceNameChange={setWorkspaceName}
      onStartWithoutWorkspace={() => {
        setFolderSelection(null);
        setWorkspaceRootPath("");
        setStartWithoutWorkspace(true);
      }}
      onWorkspaceSoulChange={setWorkspaceSoul}
      onPickFolder={() => {
        void pickDirectory(locale).then((selection) => {
          if (!selection) return;
          setFolderSelection(selection);
          setStartWithoutWorkspace(false);
          setWorkspaceRootPath(selection.path ?? "");
        });
      }}
      onProviderConnected={providerConnected}
      profileName={profileName}
      soul={soul}
      step={currentStep}
      runtime={runtime}
      workspaceName={workspaceName}
      folderSelection={folderSelection}
      startWithoutWorkspace={startWithoutWorkspace}
      workspaceSoul={workspaceSoul}
      isCompleting={isCompleting}
      completionError={completionError}
    />
  );
}

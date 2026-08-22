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

function ProfileChooser({ isSelecting, onCreate, onSelect, profiles }: ProfileChooserProps) {
  const { t } = useTranslation();
  return (
    <main className="app-shell profile-chooser-shell">
      <aside className="brand-column" aria-label="Blackwall">
        <div>
          <span className="brand-mark" aria-hidden="true">
            BW
          </span>
          <p className="eyebrow">Blackwall / local-first</p>
        </div>
        <p className="brand-note">{t("onboarding.privateByDefaultYourContext")}</p>
      </aside>
      <section
        className="onboarding-area profile-chooser-area"
        aria-label={t("onboarding.chooseAProfile")}
      >
        <div className="profile-chooser-card">
          <p className="eyebrow">{t("onboarding.profile")}</p>
          <h1>{t("onboarding.whoIsUsingBlackwall")}</h1>
          <p className="profile-chooser-intro">{t("onboarding.chooseASavedProfileOr")}</p>
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
            {t("onboarding.createNewProfile")}
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
  const stepKey = `onboarding.stepTitle.${step.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const labelKey = `onboarding.stepLabel.${step.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const title = t(stepKey);
  const label = t(labelKey);
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

      <section className="onboarding-area" aria-label={t("onboarding.initialSetup")}>
        <header className="progress-header">
          <p>
            {String(stepIndex + 1).padStart(2, "0")} /{" "}
            {String(onboardingSteps.length).padStart(2, "0")}
          </p>
          <div
            aria-label={t("onboarding.stepProgress", {
              current: stepIndex + 1,
              total: onboardingSteps.length,
            })}
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
            <div className="choice-list" role="radiogroup" aria-label={t("onboarding.language")}>
              <button
                className={locale === "pt-BR" ? "choice is-selected" : "choice"}
                onClick={() => onLocaleChange("pt-BR")}
                aria-pressed={locale === "pt-BR"}
                type="button"
              >
                {t("onboarding.portugueseBrazil")}
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
              {t("onboarding.profileName")}
              <input
                autoComplete="name"
                id="profile-name"
                onChange={(event) => onProfileNameChange(event.target.value)}
                placeholder={t("onboarding.yourName")}
                value={profileName}
              />
            </label>
          )}
          {step.id === "workspace" && (
            <label className="field-label" htmlFor="workspace-name">
              {t("onboarding.workspaceName")}
              <input
                id="workspace-name"
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
                placeholder={t("onboarding.myProject")}
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
                  <strong>{t("onboarding.chooseFolder")}</strong>
                  <small>
                    {runtime === "desktop"
                      ? t("onboarding.openTheSystemFileExplorer")
                      : t("onboarding.openTheBrowserFileExplorer")}
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
                  {t("onboarding.startWithoutAWorkspace")}
                  <small>{t("onboarding.addAProjectFolderLater")}</small>
                </span>
                <span>{startWithoutWorkspace ? "✓" : ""}</span>
              </button>
              {folderSelection && (
                <div className="folder-selected" role="status">
                  <strong>{folderSelection.name}</strong>
                  {folderSelection.source === "web" && (
                    <span>
                      {folderSelection.files.length} {t("onboarding.markdownFilesSelected")}
                    </span>
                  )}
                </div>
              )}
              <span className="field-hint">{t("onboarding.chooseAFolderToUse")}</span>
            </div>
          )}
          {step.id === "soul" && (
            <SoulPicker
              hint={t("onboarding.thisSoulGuidesYourProfile")}
              id="soul-prompt"
              label={t("onboarding.profileSoul")}
              onChange={onSoulChange}
              value={soul}
            />
          )}
          {step.id === "workspace-soul" && (
            <label className="field-label" htmlFor="workspace-soul-prompt">
              {t("onboarding.workspaceContext")}
              <textarea
                id="workspace-soul-prompt"
                onChange={(event) => onWorkspaceSoulChange(event.target.value)}
                placeholder={t("onboarding.describeTheProjectConventionsAnd")}
                rows={6}
                value={workspaceSoul}
              />
              <span className="field-hint">{t("onboarding.addContextThatShouldGuide")}</span>
            </label>
          )}
          {step.id === "provider" && (
            <Suspense fallback={<div className="provider-skeleton skeleton" aria-busy="true" />}>
              <ProviderSetup onConnected={onProviderConnected} />
            </Suspense>
          )}
          {step.id === "vault" && (
            <div className="info-panel">
              <strong>{t("onboarding.aRealVaultInMarkdown")}</strong>
              <p>{t("onboarding.blackwallWillKeepNotesLinks")}</p>
            </div>
          )}

          <footer className="card-actions">
            <button
              className="button button-secondary"
              disabled={stepIndex === 0 || isExiting}
              onClick={(event) => onBack(event.detail !== 0)}
              type="button"
            >
              {t("onboarding.back")}
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
                  ? t("onboarding.saving")
                  : isLastStep
                    ? t("onboarding.enterBlackwall")
                    : t("onboarding.continue")}
              </button>
            )}
          </footer>
          {completionError && <p className="form-error">{completionError}</p>}
        </div>
        <p className="stage-status">
          {t("onboarding.localSetup")} · {runtime} · {progress} {t("onboarding.complete")}
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

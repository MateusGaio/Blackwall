// MIT License — Copyright (c) 2026 Mateus Gaio
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { ProgressIndicator } from "@/shared/components/motion/ProgressIndicator";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Textarea } from "@/shared/components/ui/textarea";
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
import { choiceCardBase, ProfileChooser } from "./shell/ProfileChooser";
import { DEFAULT_SOUL_PROMPT } from "./souls";

const WorkspaceShell = lazy(async () => import("./WorkspaceShell"));
const ProviderSetup = lazy(async () => {
  const module = await import("../features/config/components/ProviderSetup");
  return { default: module.ProviderSetup };
});

/* Tokens U1 em utilitários locais (nenhum CSS global novo para telas migradas). */
const eyebrowClass = "font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground";
const metaClass =
  "whitespace-nowrap font-mono text-[0.7rem] tracking-[0.04em] text-muted-foreground";
const cardShellClass =
  "min-h-[340px] rounded-xl border border-border bg-card/30 p-[clamp(26px,5vw,48px)]";
const cardTitleClass =
  "mt-4 mb-10 max-w-[12ch] text-[clamp(2rem,5vw,3.75rem)] leading-[0.98] font-medium tracking-[-0.055em]";
const fieldLabelClass = "grid gap-2.5 font-mono text-[0.72rem] text-muted-foreground";
const fieldHintClass =
  "text-[0.76rem] leading-snug font-sans tracking-normal text-muted-foreground";

function LoadingSkeleton() {
  return (
    <main
      aria-busy="true"
      className="grid min-h-screen grid-cols-[minmax(180px,0.68fr)_minmax(0,1.32fr)]"
    >
      <div className="flex flex-col justify-between gap-8 border-r border-border p-8">
        <Skeleton className="size-[34px]" />
        <Skeleton className="h-4 w-2/3" />
      </div>
      <div className="mx-auto flex w-full max-w-[620px] flex-col justify-center px-7 py-12">
        <div aria-busy="true" role="status">
          <Skeleton className="mb-[34px] h-0.5" />
          <Skeleton className="h-[340px] rounded-xl" />
        </div>
      </div>
    </main>
  );
}

type ToggleCardProps = {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  selected: boolean;
};

/** Card de escolha monocromático sobre tokens U1; seleção invertendo superfície/texto. */
function ToggleCard({ children, className, onClick, selected }: ToggleCardProps) {
  return (
    <button
      aria-pressed={selected}
      className={`${choiceCardBase} ${
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:border-ring"
      } ${className ?? ""}`}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
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
  pendingStep: number | null;
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
  onStepExited: () => void;
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
  pendingStep,
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
  onStepExited,
}: OnboardingPanelProps) {
  const { t } = useTranslation();
  const stepIndex = onboardingSteps.findIndex((item) => item.id === step.id);
  const isLastStep = stepIndex === onboardingSteps.length - 1;
  const progressValue = ((stepIndex + 1) / onboardingSteps.length) * 100;
  const isTransitioning = pendingStep !== null;
  const stepKey = `onboarding.stepTitle.${step.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const labelKey = `onboarding.stepLabel.${step.id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`;
  const title = t(stepKey);
  const label = t(labelKey);

  return (
    <main className="grid min-h-screen grid-cols-[minmax(180px,0.68fr)_minmax(0,1.32fr)]">
      <aside
        aria-label="Blackwall"
        className="flex flex-col justify-between border-r border-border p-8"
      >
        <div>
          <span
            aria-hidden="true"
            className="inline-flex size-[34px] items-center justify-center bg-primary font-mono text-[0.72rem] font-extrabold tracking-tighter text-primary-foreground"
          >
            BW
          </span>
          <p className={`${eyebrowClass} mt-[18px]`}>Blackwall / local-first</p>
        </div>
        <p className="max-w-[19ch] text-[0.82rem] leading-normal text-muted-foreground">
          {t("brand.note")}
        </p>
      </aside>

      <section
        aria-label={t("onboarding.initialSetup")}
        className="mx-auto flex w-full max-w-[620px] flex-col justify-center px-7 py-12"
      >
        <header className="mb-[34px] flex items-center gap-4">
          <p className={metaClass}>
            {String(stepIndex + 1).padStart(2, "0")} /{" "}
            {String(onboardingSteps.length).padStart(2, "0")}
          </p>
          <ProgressIndicator
            className="h-0.5 flex-1 rounded-none"
            label={t("onboarding.stepProgress", {
              current: stepIndex + 1,
              total: onboardingSteps.length,
            })}
            value={progressValue}
          />
        </header>

        <EnterExit
          className={cardShellClass}
          duration="fast"
          offsetPx={4}
          show={!isTransitioning}
          onExited={onStepExited}
        >
          <p className={eyebrowClass}>{label}</p>
          <h1 className={cardTitleClass}>{title}</h1>
          {step.id === "language" && (
            <div aria-label={t("onboarding.language")} className="grid gap-2.5" role="radiogroup">
              <ToggleCard onClick={() => onLocaleChange("pt-BR")} selected={locale === "pt-BR"}>
                <span className="grid gap-1">
                  {t("onboarding.portugueseBrazil")}
                  <small className="font-sans text-[0.68rem] text-muted-foreground">PT-BR</small>
                </span>
                <span className="font-mono text-xs">PT-BR</span>
              </ToggleCard>
              <ToggleCard onClick={() => onLocaleChange("en")} selected={locale === "en"}>
                <span className="grid gap-1">
                  English
                  <small className="font-sans text-[0.68rem] text-muted-foreground">EN</small>
                </span>
                <span className="font-mono text-xs">EN</span>
              </ToggleCard>
            </div>
          )}
          {step.id === "profile" && (
            <label className={fieldLabelClass} htmlFor="profile-name">
              {t("onboarding.profileName")}
              <Input
                autoComplete="name"
                className="h-10"
                id="profile-name"
                onChange={(event) => onProfileNameChange(event.target.value)}
                placeholder={t("onboarding.yourName")}
                value={profileName}
              />
            </label>
          )}
          {step.id === "workspace" && (
            <label className={fieldLabelClass} htmlFor="workspace-name">
              {t("onboarding.workspaceName")}
              <Input
                className="h-10"
                id="workspace-name"
                onChange={(event) => onWorkspaceNameChange(event.target.value)}
                placeholder={t("onboarding.myProject")}
                value={workspaceName}
              />
            </label>
          )}
          {step.id === "folder" && (
            <div className="grid gap-3">
              <button
                className={`${choiceCardBase} rounded-lg`}
                onClick={onPickFolder}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-[30px] items-center justify-center border border-ring font-mono text-foreground/85"
                >
                  ⌘
                </span>
                <span className="grid gap-1">
                  <strong>{t("onboarding.chooseFolder")}</strong>
                  <small className="font-mono text-[0.68rem] text-muted-foreground">
                    {runtime === "desktop"
                      ? t("onboarding.openTheSystemFileExplorer")
                      : t("onboarding.openTheBrowserFileExplorer")}
                  </small>
                </span>
              </button>
              <ToggleCard onClick={onStartWithoutWorkspace} selected={startWithoutWorkspace}>
                <span className="grid gap-1">
                  {t("onboarding.startWithoutAWorkspace")}
                  <small className="font-sans text-[0.68rem] text-muted-foreground">
                    {t("onboarding.addAProjectFolderLater")}
                  </small>
                </span>
                <span>{startWithoutWorkspace ? "✓" : ""}</span>
              </ToggleCard>
              {folderSelection && (
                <div
                  className="flex items-baseline justify-between gap-2.5 border-l-2 border-ring bg-muted px-3 py-2.5"
                  role="status"
                >
                  <strong>{folderSelection.name}</strong>
                  {folderSelection.source === "web" && (
                    <span className="font-mono text-[0.68rem] text-muted-foreground">
                      {folderSelection.files.length} {t("onboarding.markdownFilesSelected")}
                    </span>
                  )}
                </div>
              )}
              <span className={fieldHintClass}>{t("onboarding.chooseAFolderToUse")}</span>
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
            <label className={fieldLabelClass} htmlFor="workspace-soul-prompt">
              {t("onboarding.workspaceContext")}
              <Textarea
                className="min-h-[132px]"
                id="workspace-soul-prompt"
                onChange={(event) => onWorkspaceSoulChange(event.target.value)}
                placeholder={t("onboarding.describeTheProjectConventionsAnd")}
                rows={6}
                value={workspaceSoul}
              />
              <span className={fieldHintClass}>{t("onboarding.addContextThatShouldGuide")}</span>
            </label>
          )}
          {step.id === "provider" && (
            <Suspense fallback={<Skeleton aria-hidden className="h-40" />}>
              <ProviderSetup onConnected={onProviderConnected} />
            </Suspense>
          )}
          {step.id === "vault" && (
            <div className="border-l-2 border-ring pl-4 text-muted-foreground">
              <strong className="block text-[0.95rem] font-medium text-foreground">
                {t("onboarding.aRealVaultInMarkdown")}
              </strong>
              <p className="mt-2.5 max-w-[48ch] text-[0.9rem] leading-relaxed">
                {t("onboarding.blackwallWillKeepNotesLinks")}
              </p>
            </div>
          )}

          <footer className="mt-10 flex items-center justify-between gap-3">
            <Button
              disabled={stepIndex === 0 || isTransitioning}
              onClick={(event) => onBack(event.detail !== 0)}
              variant="secondary"
            >
              {t("onboarding.back")}
            </Button>
            {step.id !== "provider" && (
              <Button
                disabled={
                  isTransitioning ||
                  isCompleting ||
                  (step.id === "profile" && profileName.trim().length === 0) ||
                  (step.id === "workspace" && workspaceName.trim().length === 0) ||
                  (step.id === "folder" && !folderSelection && !startWithoutWorkspace)
                }
                onClick={(event) => onAdvance(event.detail !== 0)}
                variant="default"
              >
                {isCompleting
                  ? t("onboarding.saving")
                  : isLastStep
                    ? t("onboarding.enterBlackwall")
                    : t("onboarding.continue")}
              </Button>
            )}
          </footer>
          {completionError && (
            <p className="text-sm text-destructive" role="alert">
              {completionError}
            </p>
          )}
        </EnterExit>
        <p className={`${metaClass} mt-4`}>
          {t("onboarding.localSetup")} · {runtime} · {progressValue.toFixed(0)}%{" "}
          {t("onboarding.complete")}
        </p>
      </section>
    </main>
  );
}

export function App() {
  const { i18n, t } = useTranslation();
  const [isReady, setIsReady] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
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
  const [soul, setSoul] = useState(DEFAULT_SOUL_PROMPT);
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
    if (safeStep === stepIndex || pendingRef.current !== null) return;
    if (!animate) {
      setStepIndex(safeStep);
      return;
    }
    pendingRef.current = safeStep;
    setPendingStep(safeStep);
  }

  function commitPendingStep() {
    const target = pendingRef.current;
    if (target === null) return;
    pendingRef.current = null;
    setStepIndex(target);
    setPendingStep(null);
  }

  function advance(animate: boolean) {
    if (pendingRef.current !== null) return;
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
    pendingRef.current = null;
    setStepIndex(0);
    setPendingStep(null);
    setCompletionError("");
    setProfileName("");
    setSoul(DEFAULT_SOUL_PROMPT);
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
      if (!profile) throw new Error(t("errors.profileDoesNotExist"));
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
        reason instanceof Error ? reason.message : t("errors.couldNotOpenProfile"),
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
      setCompletionError(reason instanceof Error ? reason.message : t("errors.couldNotSignOut"));
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
        reason instanceof Error ? reason.message : t("errors.couldNotDeleteProfile"),
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
      setCompletionError(reason instanceof Error ? reason.message : t("errors.couldNotSaveSetup"));
    } finally {
      setIsCompleting(false);
    }
  }, [
    folderSelection,
    locale,
    profileName,
    soul,
    startWithoutWorkspace,
    t,
    workspaceRootPath,
    workspaceName,
    workspaceSoul,
  ]);

  useEffect(() => {
    function advanceWithEnter(event: KeyboardEvent) {
      if (
        event.key !== "Enter" ||
        isComplete ||
        pendingRef.current !== null ||
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
        onCreate={startNewProfile}
        onDelete={removeProfile}
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
      isCompleting={isCompleting}
      completionError={completionError}
      folderSelection={folderSelection}
      locale={locale}
      onAdvance={advance}
      onBack={(animate) => navigate(stepIndex - 1, animate)}
      onLocaleChange={setLocale}
      onProfileNameChange={setProfileName}
      onProviderConnected={providerConnected}
      onSoulChange={setSoul}
      onStartWithoutWorkspace={() => {
        setFolderSelection(null);
        setWorkspaceRootPath("");
        setStartWithoutWorkspace(true);
      }}
      onStepExited={commitPendingStep}
      onWorkspaceNameChange={setWorkspaceName}
      onWorkspaceSoulChange={setWorkspaceSoul}
      onPickFolder={() => {
        void pickDirectory().then((selection) => {
          if (!selection) return;
          setFolderSelection(selection);
          setStartWithoutWorkspace(false);
          setWorkspaceRootPath(selection.path ?? "");
        });
      }}
      pendingStep={pendingStep}
      profileName={profileName}
      runtime={runtime}
      soul={soul}
      startWithoutWorkspace={startWithoutWorkspace}
      step={currentStep}
      workspaceName={workspaceName}
      workspaceSoul={workspaceSoul}
    />
  );
}

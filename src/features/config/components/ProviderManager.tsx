// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { currentRuntime } from "../../../platform/runtime";
import {
  type ConnectedProvider,
  connectProvider,
  deleteProvider,
  type Profile,
  testProvider,
  updateProvider,
  type Workspace,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { type SettingsSection, settingsSections } from "../settings-sections";
import { ProfileSettings } from "./provider-manager/ProfileSettings";
import { ProviderFormSection } from "./provider-manager/ProviderFormSection";
import { ProviderList } from "./provider-manager/ProviderList";
import { emptyForm, type ProviderForm } from "./provider-manager/providerForm";
import { useModelOptions } from "./provider-manager/useModelOptions";
import { useProfileSettingsForm } from "./provider-manager/useProfileSettingsForm";
import { useWorkspaceSettingsForm } from "./provider-manager/useWorkspaceSettingsForm";
import { WorkspacesSection } from "./provider-manager/WorkspacesSection";
import { UsageDashboard } from "./UsageDashboard";

type ProviderManagerProps = {
  activeSessionId?: string | null;
  activeWorkspaceId: string | null;
  activeProviderId?: string | null;
  section: SettingsSection;
  onClose: () => void;
  onSectionChange: (section: SettingsSection) => void;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onProvidersChange: (providers: ConnectedProvider[]) => void;
  onProfileChange: (profile: Profile) => void;
  onSignOut: () => Promise<void>;
  onSelect: (provider: ConnectedProvider) => void;
  onWorkspaceChange: (workspace: Workspace) => void;
  onWorkspaceSelected: (workspace: Workspace) => Promise<void>;
  profile: Profile | null;
  profileId: string | null;
  providers: ConnectedProvider[];
  workspaces: Workspace[];
};

export function ProviderManager({
  activeSessionId,
  activeWorkspaceId,
  activeProviderId,
  section,
  onClose,
  onSectionChange,
  onDeleteProfile,
  onProvidersChange,
  onProfileChange,
  onSignOut,
  onSelect,
  onWorkspaceChange,
  onWorkspaceSelected,
  profile,
  profileId,
  providers,
  workspaces,
}: ProviderManagerProps) {
  const { t } = useTranslation();
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProviderForm>(emptyForm);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [providerToRemove, setProviderToRemove] = useState<ConnectedProvider | null>(null);
  const runtime = currentRuntime();

  const activeWorkspace =
    workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null;

  // A troca de aba deve reancorar a única superfície rolável no início.
  // biome-ignore lint/correctness/useExhaustiveDependencies: section é o sinal explícito de troca de aba.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      scrollRootRef.current
        ?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
        ?.scrollTo({ behavior: "auto", top: 0 });
    });
    return () => cancelAnimationFrame(frame);
  }, [section]);

  function updateForm(field: keyof ProviderForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  const modelOptions = useModelOptions({
    editingId,
    form,
    onFieldChange: updateForm,
    setError,
    setStatus,
  });

  const profileSettings = useProfileSettingsForm({
    onDeleteProfile,
    onProfileChange,
    profile,
  });

  const workspaceSettings = useWorkspaceSettingsForm({
    activeWorkspace,
    onWorkspaceChange,
    onWorkspaceSelected,
    profileId,
    setError,
    setIsSaving,
  });

  function edit(provider: ConnectedProvider) {
    setEditingId(provider.id);
    setForm({
      apiKey: "",
      baseUrl: provider.baseUrl,
      model: provider.model,
      name: provider.name,
      type: provider.type,
    });
    setError("");
    setStatus("");
    modelOptions.clearModels();
  }

  function reset() {
    setEditingId(null);
    setForm(emptyForm);
    setError("");
    setStatus("");
    modelOptions.clearModels();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const input = {
        apiKey: form.apiKey || undefined,
        baseUrl: form.baseUrl,
        model: form.model,
        name: form.name,
        type: form.type,
      };
      const saved = editingId
        ? await updateProvider(editingId, input)
        : await connectProvider(input);
      const next = editingId
        ? providers.map((provider) => (provider.id === saved.id ? saved : provider))
        : [...providers, saved];
      onProvidersChange(next);
      onSelect(saved);
      setStatus(t("settings.providerSavedAndValidatedOn"));
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotSaveTheProvider"));
    } finally {
      setIsSaving(false);
    }
  }

  async function testCurrent() {
    setError("");
    setStatus("");
    try {
      await testProvider({ ...form, apiKey: form.apiKey || undefined });
      setStatus(t("settings.connectionValidated"));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotTestTheProvider"));
    }
  }

  async function remove(provider: ConnectedProvider) {
    try {
      await deleteProvider(provider.id);
      const next = providers.filter((item) => item.id !== provider.id);
      onProvidersChange(next);
      reset();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("settings.couldNotRemoveTheProvider"));
    }
  }

  const sectionTitle =
    section === "usage"
      ? t("settings.tabUsage")
      : section === "profile"
        ? t("settings.tabProfile")
        : section === "workspaces"
          ? t("settings.tabWorkspaces")
          : t("settings.tabProviders");

  return (
    <>
      <section
        aria-busy={isSaving || profileSettings.isSavingProfile}
        aria-labelledby="blackwall-settings-title"
        className="flex h-full min-h-0 w-full min-w-0 flex-col bg-background"
        data-testid="settings-surface"
      >
        <header className="shrink-0 border-b border-border px-5 pt-4 md:px-8">
          <div className="flex items-start justify-between gap-4 pb-4">
            <div>
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-muted-foreground">
                {t("settings.settings")}
              </p>
              <h2 className="mt-1 text-base font-medium" id="blackwall-settings-title">
                {sectionTitle}
              </h2>
              <p className="sr-only">{t("settings.profileWorkspacesAndProviders")}</p>
            </div>
            <Button
              aria-label={t("settings.close")}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <span aria-hidden="true">×</span>
            </Button>
          </div>
          <nav
            aria-label={t("settings.settingsSections")}
            className="flex gap-1 overflow-x-auto pb-3"
            data-testid="settings-tabs"
          >
            {settingsSections.map((value) => (
              <button
                aria-current={section === value ? "page" : undefined}
                className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs transition-colors duration-[120ms] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  section === value
                    ? "bg-neutral-800/70 text-foreground"
                    : "text-muted-foreground hover:bg-neutral-800/40 hover:text-foreground"
                }`}
                data-testid={`settings-tab-${value}`}
                key={value}
                onClick={() => onSectionChange(value)}
                type="button"
              >
                {t(`settings.tab${value[0].toUpperCase()}${value.slice(1)}`)}
              </button>
            ))}
          </nav>
        </header>
        <div className="min-h-0 flex-1" ref={scrollRootRef}>
          <ScrollArea className="h-full">
            <div className="mx-auto grid w-full max-w-3xl gap-6 px-5 py-6 pb-10 md:px-8">
              {section === "usage" && (
                <UsageDashboard
                  activeProviderId={activeProviderId}
                  activeSessionId={activeSessionId}
                  profileId={profileId}
                  providers={providers}
                />
              )}
              {section === "profile" && (
                <ProfileSettings
                  isDeletingProfile={profileSettings.isDeletingProfile}
                  isSavingProfile={profileSettings.isSavingProfile}
                  onAvatarChange={profileSettings.chooseProfileAvatar}
                  onDeleteProfileRequest={() => profileSettings.setProfileToDelete(profile)}
                  onSave={profileSettings.saveProfile}
                  onSignOut={onSignOut}
                  profileAvatar={profileSettings.profileAvatar}
                  profileError={profileSettings.profileError}
                  profileName={profileSettings.profileName}
                  profileSoul={profileSettings.profileSoul}
                  profileStatus={profileSettings.profileStatus}
                  setProfileAvatar={profileSettings.setProfileAvatar}
                  setProfileName={profileSettings.setProfileName}
                  setProfileSoul={profileSettings.setProfileSoul}
                />
              )}
              {section === "workspaces" && (
                <WorkspacesSection
                  activeWorkspace={activeWorkspace}
                  activeWorkspaceId={activeWorkspaceId}
                  chooseBrowserFolder={workspaceSettings.chooseBrowserWorkspaceFolder}
                  chooseFolder={workspaceSettings.chooseWorkspaceFolder}
                  isSaving={isSaving}
                  onWorkspaceSelected={onWorkspaceSelected}
                  runtime={runtime}
                  saveSoulDraft={workspaceSettings.saveWorkspaceSoulDraft}
                  setWorkspaceName={workspaceSettings.setWorkspaceName}
                  setWorkspaceSoulDraft={workspaceSettings.setWorkspaceSoulDraft}
                  submitWorkspace={workspaceSettings.submitWorkspace}
                  workspaces={workspaces}
                  workspaceFolder={workspaceSettings.workspaceFolder}
                  workspaceName={workspaceSettings.workspaceName}
                  workspaceSoul={workspaceSettings.workspaceSoul}
                  workspaceStatus={workspaceSettings.workspaceStatus}
                />
              )}
              {section === "providers" && (
                <div className="grid gap-6">
                  <ProviderList
                    onEdit={edit}
                    onRemoveRequest={setProviderToRemove}
                    onSelect={onSelect}
                    providers={providers}
                  />
                  <ProviderFormSection
                    editingId={editingId}
                    error={error}
                    form={form}
                    isSaving={isSaving}
                    modelOptions={modelOptions}
                    onSubmit={submit}
                    onTest={testCurrent}
                    reset={reset}
                    setFormField={updateForm}
                    status={status}
                  />
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </section>
      {providerToRemove && (
        <ConfirmDialog
          confirmLabel={t("settings.removeProvider")}
          description={t("settings.removeProviderDescription", {
            name: providerToRemove.name,
          })}
          onCancel={() => setProviderToRemove(null)}
          onConfirm={() => {
            const provider = providerToRemove;
            setProviderToRemove(null);
            void remove(provider);
          }}
          headingLabel={t("settings.confirmation")}
          title={`${t("settings.remove")} ${providerToRemove.name}?`}
        />
      )}
      {profileSettings.profileToDelete && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.deleteProfile")}
          description={t("settings.allSessionsWorkspacesMessagesAnd")}
          onCancel={() => profileSettings.setProfileToDelete(null)}
          onConfirm={() => {
            profileSettings.setProfileToDelete(null);
            void profileSettings.removeProfile();
          }}
          headingLabel={t("settings.confirmation")}
          title={`${t("settings.delete")} ${profileSettings.profileToDelete.name}?`}
        />
      )}
    </>
  );
}

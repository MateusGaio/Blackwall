// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { SoulPicker } from "../../../../shared/components/SoulPicker";

type ProfileSettingsProps = {
  isDeletingProfile: boolean;
  isSavingProfile: boolean;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onDeleteProfileRequest: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onSignOut: () => Promise<void>;
  profileAvatar: string | null;
  profileError: string;
  profileName: string;
  profileSoul: string;
  profileStatus: string;
  setProfileAvatar: (avatar: string | null) => void;
  setProfileName: (name: string) => void;
  setProfileSoul: (soul: string) => void;
};

const fieldLabelClass = "grid gap-2 font-mono text-[0.72rem] text-muted-foreground";

export function ProfileSettings({
  isDeletingProfile,
  isSavingProfile,
  onAvatarChange,
  onDeleteProfileRequest,
  onSave,
  onSignOut,
  profileAvatar,
  profileError,
  profileName,
  profileSoul,
  profileStatus,
  setProfileAvatar,
  setProfileName,
  setProfileSoul,
}: ProfileSettingsProps) {
  const { t } = useTranslation();
  return (
    <form className="grid gap-4" onSubmit={onSave}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
            {t("settings.profile")}
          </p>
          <h3 className="mt-1 text-sm font-medium">{t("settings.whatShouldWeCallYou")}</h3>
        </div>
        <div
          aria-hidden="true"
          className="flex size-10 items-center justify-center overflow-hidden rounded-full bg-primary font-mono text-[0.7rem] font-bold text-primary-foreground"
        >
          {profileAvatar ? (
            <img alt="" className="size-full object-cover" src={profileAvatar} />
          ) : (
            <span>BW</span>
          )}
        </div>
      </div>
      <label className={fieldLabelClass} htmlFor="settings-profile-name">
        {t("settings.name")}
        <Input
          id="settings-profile-name"
          onChange={(event) => setProfileName(event.target.value)}
          value={profileName}
        />
      </label>
      <div className="flex items-center gap-3">
        <label
          className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-input bg-transparent px-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:border-ring focus-visible:outline-none"
          htmlFor="settings-profile-avatar"
        >
          {t("settings.changePhoto")}
          <input
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            id="settings-profile-avatar"
            onChange={onAvatarChange}
            type="file"
          />
        </label>
        {profileAvatar && (
          <Button onClick={() => setProfileAvatar(null)} size="sm" type="button" variant="ghost">
            {t("settings.removePhoto")}
          </Button>
        )}
        <small className="font-mono text-[0.68rem] text-muted-foreground">
          {t("settings.pngJpegWebpOrGif")}
        </small>
      </div>
      <SoulPicker
        hint={t("settings.chooseAReadymadePersonalityOr")}
        id="settings-profile-soul"
        label={t("settings.profileSoul")}
        onChange={setProfileSoul}
        rows={4}
        value={profileSoul}
      />
      <div className="flex justify-end">
        <Button
          disabled={isSavingProfile || !profileName.trim() || !profileSoul.trim()}
          type="submit"
        >
          {isSavingProfile ? t("settings.saving") : t("settings.saveProfile")}
        </Button>
      </div>
      {profileStatus && <p className="text-xs text-muted-foreground">{profileStatus}</p>}
      {profileError && (
        <p className="text-sm text-destructive" role="alert">
          {profileError}
        </p>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
        <div>
          <p className="text-sm font-medium">{t("settings.deleteProfile")}</p>
          <p className="text-xs text-muted-foreground">
            {t("settings.allSessionsWorkspacesMessagesAnd")}
          </p>
        </div>
        <Button
          disabled={isDeletingProfile}
          onClick={onDeleteProfileRequest}
          size="sm"
          type="button"
          variant="ghost"
        >
          <span className="text-destructive">{t("settings.deleteProfile")}</span>
        </Button>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => void onSignOut()} size="sm" type="button" variant="ghost">
          {t("settings.signOut")}
        </Button>
      </div>
    </form>
  );
}

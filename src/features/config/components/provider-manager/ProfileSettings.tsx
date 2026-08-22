// MIT License — Copyright (c) 2026 Mateus Gaio

import type { ChangeEvent, FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { SoulPicker } from "../../../../shared/components/SoulPicker";

type ProfileSettingsProps = {
  isSavingProfile: boolean;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  profileAvatar: string | null;
  profileError: string;
  profileName: string;
  profileSoul: string;
  profileStatus: string;
  setProfileAvatar: (avatar: string | null) => void;
  setProfileName: (name: string) => void;
  setProfileSoul: (soul: string) => void;
};

export function ProfileSettings({
  isSavingProfile,
  onAvatarChange,
  onSave,
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
    <form className="settings-section profile-settings" onSubmit={onSave}>
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">{t("settings.profile")}</p>
          <h3>{t("settings.whatShouldWeCallYou")}</h3>
        </div>
        <div className="profile-avatar-preview" aria-hidden="true">
          {profileAvatar ? <img alt="" src={profileAvatar} /> : <span>BW</span>}
        </div>
      </div>
      <label className="field-label" htmlFor="settings-profile-name">
        {t("settings.name")}
        <input
          id="settings-profile-name"
          onChange={(event) => setProfileName(event.target.value)}
          value={profileName}
        />
      </label>
      <div className="profile-avatar-actions">
        <label className="button button-secondary" htmlFor="settings-profile-avatar">
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
          <button className="text-button" onClick={() => setProfileAvatar(null)} type="button">
            {t("settings.removePhoto")}
          </button>
        )}
        <small>{t("settings.pngJpegWebpOrGif")}</small>
      </div>
      <SoulPicker
        hint={t("settings.chooseAReadymadePersonalityOr")}
        id="settings-profile-soul"
        label={t("settings.profileSoul")}
        onChange={setProfileSoul}
        rows={4}
        value={profileSoul}
      />
      <div className="settings-actions">
        <button
          className="button button-primary"
          disabled={isSavingProfile || !profileName.trim() || !profileSoul.trim()}
          type="submit"
        >
          {isSavingProfile ? t("settings.saving") : t("settings.saveProfile")}
        </button>
      </div>
      {profileStatus && <p className="settings-status">{profileStatus}</p>}
      {profileError && (
        <p className="form-error" role="alert">
          {profileError}
        </p>
      )}
    </form>
  );
}

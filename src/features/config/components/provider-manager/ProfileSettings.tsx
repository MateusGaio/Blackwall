// MIT License — Copyright (c) 2026 Mateus Gaio
import type { ChangeEvent, FormEvent } from "react";
import { SoulPicker } from "../../../../shared/components/SoulPicker";

type ProfileSettingsProps = {
  isEnglish: boolean;
  isSavingProfile: boolean;
  onAvatarChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  profileAvatar: string | null;
  profileError: string;
  profileLocale: "en" | "pt-BR";
  profileName: string;
  profileSoul: string;
  profileStatus: string;
  setProfileAvatar: (avatar: string | null) => void;
  setProfileName: (name: string) => void;
  setProfileSoul: (soul: string) => void;
};

export function ProfileSettings({
  isEnglish,
  isSavingProfile,
  onAvatarChange,
  onSave,
  profileAvatar,
  profileError,
  profileLocale,
  profileName,
  profileSoul,
  profileStatus,
  setProfileAvatar,
  setProfileName,
  setProfileSoul,
}: ProfileSettingsProps) {
  return (
    <form className="settings-section profile-settings" onSubmit={onSave}>
      <div className="settings-section-heading">
        <div>
          <p className="eyebrow">{isEnglish ? "Profile" : "Perfil"}</p>
          <h3>{isEnglish ? "What should we call you?" : "Como você quer ser chamado?"}</h3>
        </div>
        <div className="profile-avatar-preview" aria-hidden="true">
          {profileAvatar ? <img alt="" src={profileAvatar} /> : <span>BW</span>}
        </div>
      </div>
      <label className="field-label" htmlFor="settings-profile-name">
        {isEnglish ? "Name" : "Nome"}
        <input
          id="settings-profile-name"
          onChange={(event) => setProfileName(event.target.value)}
          value={profileName}
        />
      </label>
      <div className="profile-avatar-actions">
        <label className="button button-secondary" htmlFor="settings-profile-avatar">
          {isEnglish ? "Change photo" : "Alterar foto"}
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
            {isEnglish ? "Remove photo" : "Remover foto"}
          </button>
        )}
        <small>
          {isEnglish
            ? "PNG, JPEG, WebP or GIF · up to 2 MB · stays on this device"
            : "PNG, JPEG, WebP ou GIF · até 2 MB · fica somente neste dispositivo"}
        </small>
      </div>
      <SoulPicker
        hint={
          isEnglish
            ? "Choose a ready-made personality or write your own prompt."
            : "Escolha uma personalidade pronta ou escreva seu próprio prompt."
        }
        id="settings-profile-soul"
        label={isEnglish ? "Profile Soul" : "Soul do perfil"}
        locale={profileLocale}
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
          {isSavingProfile
            ? isEnglish
              ? "Saving…"
              : "Salvando…"
            : isEnglish
              ? "Save profile"
              : "Salvar perfil"}
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

// MIT License — Copyright (c) 2026 Mateus Gaio
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { type Profile, updateProfile } from "../../../../shared/api/sidecar";

type UseProfileSettingsFormArgs = {
  isEnglish: boolean;
  onDeleteProfile: (profileId: string) => Promise<void>;
  onProfileChange: (profile: Profile) => void;
  profile: Profile | null;
};

export function useProfileSettingsForm({
  isEnglish,
  onDeleteProfile,
  onProfileChange,
  profile,
}: UseProfileSettingsFormArgs) {
  const [isDeletingProfile, setIsDeletingProfile] = useState(false);
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [profileName, setProfileName] = useState(profile?.name ?? "");
  const [profileSoul, setProfileSoul] = useState(profile?.soul ?? "");
  const [profileAvatar, setProfileAvatar] = useState<string | null>(profile?.avatarData ?? null);
  const [profileStatus, setProfileStatus] = useState("");
  const [profileError, setProfileError] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  useEffect(() => {
    setProfileName(profile?.name ?? "");
    setProfileSoul(profile?.soul ?? "");
    setProfileAvatar(profile?.avatarData ?? null);
  }, [profile]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    setIsSavingProfile(true);
    setProfileError("");
    setProfileStatus("");
    try {
      const saved = await updateProfile(profile.id, {
        avatarData: profileAvatar,
        name: profileName,
        soul: profileSoul,
      });
      onProfileChange(saved);
      setProfileStatus(
        isEnglish ? "Profile saved on this device." : "Perfil salvo neste dispositivo.",
      );
    } catch (reason) {
      setProfileError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not save the profile."
            : "Não foi possível salvar o perfil.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  }

  function chooseProfileAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2 * 1024 * 1024) {
      setProfileError(
        isEnglish
          ? "Choose a PNG, JPEG, WebP or GIF image up to 2 MB."
          : "Escolha uma imagem PNG, JPEG, WebP ou GIF de até 2 MB.",
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        setProfileAvatar(result);
        setProfileError("");
        setProfileStatus(isEnglish ? "Photo ready to save." : "Foto pronta para salvar.");
      }
    };
    reader.onerror = () =>
      setProfileError(
        isEnglish ? "Could not read this image." : "Não foi possível ler essa imagem.",
      );
    reader.readAsDataURL(file);
  }

  async function removeProfile() {
    if (!profile) return;
    setIsDeletingProfile(true);
    setProfileError("");
    try {
      await onDeleteProfile(profile.id);
    } catch (reason) {
      setProfileError(
        reason instanceof Error
          ? reason.message
          : isEnglish
            ? "Could not delete the profile."
            : "Não foi possível excluir o perfil.",
      );
    } finally {
      setIsDeletingProfile(false);
    }
  }

  return {
    chooseProfileAvatar,
    isDeletingProfile,
    isSavingProfile,
    profileAvatar,
    profileError,
    profileName,
    profileSoul,
    profileStatus,
    profileToDelete,
    removeProfile,
    saveProfile,
    setProfileAvatar,
    setProfileName,
    setProfileSoul,
    setProfileToDelete,
  };
}

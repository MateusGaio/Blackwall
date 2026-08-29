// MIT License — Copyright (c) 2026 Mateus Gaio
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { EnterExit } from "@/shared/components/motion/EnterExit";
import { Button } from "@/shared/components/ui/button";
import type { Profile } from "../../shared/api/sidecar";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { CompactIcon } from "./CompactIcon";

/* Tokens U1 em utilitários locais (nenhum CSS global novo para telas migradas). */
const eyebrowClass = "font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground";

export const choiceCardBase =
  "flex items-center justify-between gap-3 border px-[18px] py-4 text-left transition-colors duration-150 focus-visible:border-ring focus-visible:outline-none";

type ProfileChooserProps = {
  isSelecting: boolean;
  onCreate: () => void;
  onDelete?: (profileId: string) => Promise<void>;
  onSelect: (profileId: string) => void;
  profiles: Profile[];
};

export function ProfileChooser({
  isSelecting,
  onCreate,
  onDelete,
  onSelect,
  profiles,
}: ProfileChooserProps) {
  const { t } = useTranslation();
  const [profileToDelete, setProfileToDelete] = useState<Profile | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  async function confirmDelete() {
    if (!profileToDelete || !onDelete) return;
    const target = profileToDelete;
    setProfileToDelete(null);
    setIsDeleting(true);
    setDeleteError("");
    try {
      await onDelete(target.id);
    } catch {
      setDeleteError(t("errors.couldNotDeleteProfile"));
    } finally {
      setIsDeleting(false);
    }
  }

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
          {t("onboarding.privateByDefaultYourContext")}
        </p>
      </aside>
      <section
        aria-label={t("onboarding.chooseAProfile")}
        className="mx-auto flex w-full max-w-[680px] flex-col justify-center px-7 py-12"
      >
        <EnterExit duration="base" show>
          <div className="rounded-xl border border-border p-[clamp(26px,5vw,48px)]">
            <p className={eyebrowClass}>{t("onboarding.profile")}</p>
            <h1 className="mt-4 mb-3.5 max-w-[14ch] text-[clamp(2rem,5vw,3.5rem)] leading-[0.98] font-medium tracking-[-0.055em]">
              {t("onboarding.whoIsUsingBlackwall")}
            </h1>
            <p className="mb-6 max-w-[52ch] text-[0.88rem] leading-relaxed text-muted-foreground">
              {t("onboarding.chooseASavedProfileOr")}
            </p>
            <ul aria-busy={isDeleting || isSelecting} className="m-0 grid list-none gap-2 p-0">
              {profiles.map((profile) => (
                <li className="flex min-w-0 items-center gap-1.5" key={profile.id}>
                  <button
                    className={`${choiceCardBase} w-full rounded-lg py-3`}
                    data-testid="profile-option"
                    disabled={isSelecting || isDeleting}
                    onClick={() => onSelect(profile.id)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-mono text-[0.7rem] font-bold text-primary-foreground"
                    >
                      {profile.avatarData ? (
                        <img alt="" className="size-full object-cover" src={profile.avatarData} />
                      ) : (
                        profile.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span className="grid min-w-0 gap-[3px]">
                      <strong className="truncate text-[0.86rem] font-medium">
                        {profile.name}
                      </strong>
                      <small className="truncate font-mono text-[0.7rem] text-muted-foreground">
                        {profile.soul.split("\n")[0].slice(0, 80)}
                      </small>
                    </span>
                    <span aria-hidden="true" className="ml-auto text-muted-foreground">
                      →
                    </span>
                  </button>
                  {onDelete && (
                    <Button
                      aria-label={`${t("settings.deleteProfile")}: ${profile.name}`}
                      className="shrink-0"
                      disabled={isSelecting || isDeleting}
                      onClick={() => setProfileToDelete(profile)}
                      size="icon-sm"
                      title={`${t("settings.deleteProfile")}: ${profile.name}`}
                      type="button"
                      variant="ghost"
                    >
                      <CompactIcon kind="close" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {deleteError && (
              <p className="mt-2 text-[0.76rem] text-muted-foreground" role="alert">
                {deleteError}
              </p>
            )}
            {isDeleting && (
              // Estado ocupado da exclusão: bloqueia repetição nos botões acima
              // e anuncia o progresso sem interromper o leitor de tela em loop.
              <p
                className="mt-2 flex items-center gap-2 text-[0.76rem] text-muted-foreground"
                role="status"
              >
                <span
                  aria-hidden="true"
                  className="size-2 animate-pulse rounded-full bg-muted-foreground motion-reduce:animate-none"
                />
                {t("settings.deletingProfile")}
              </p>
            )}
            <Button className="mt-[18px] w-fit" onClick={onCreate} variant="default">
              {t("onboarding.createNewProfile")}
            </Button>
          </div>
        </EnterExit>
        {profileToDelete && (
          <ConfirmDialog
            cancelLabel={t("settings.cancel")}
            confirmLabel={t("settings.deleteProfile")}
            description={t("settings.allSessionsWorkspacesMessagesAnd")}
            headingLabel={t("settings.confirmation")}
            onCancel={() => setProfileToDelete(null)}
            onConfirm={() => void confirmDelete()}
            title={`${t("settings.delete")} ${profileToDelete.name}?`}
          />
        )}
      </section>
    </main>
  );
}

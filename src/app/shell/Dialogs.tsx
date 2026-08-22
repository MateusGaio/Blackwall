// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { Input } from "@/shared/components/ui/input";
import type { SessionSummary } from "../../shared/api/sidecar";

type RenameSessionDialogProps = {
  onCancel: () => void;
  onRenameDraftChange: (draft: string) => void;
  onSubmit: (sessionId: string, currentTitle: string) => void;
  renameDraft: string;
  sessionToRename: { id: string; title: string } | null;
};

export function RenameSessionDialog({
  onCancel,
  onRenameDraftChange,
  onSubmit,
  renameDraft,
  sessionToRename,
}: RenameSessionDialogProps) {
  const { t } = useTranslation();
  if (!sessionToRename) return null;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
            {t("sessions.session")}
          </p>
          <DialogTitle>{t("sessions.renameConversation")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(sessionToRename.id, sessionToRename.title);
          }}
        >
          <label
            className="grid gap-2 font-mono text-[0.72rem] text-muted-foreground"
            htmlFor="rename-session-draft"
          >
            {t("sessions.newName")}
            <Input
              id="rename-session-draft"
              onChange={(event) => onRenameDraftChange(event.target.value)}
              value={renameDraft}
            />
          </label>
          <DialogFooter className="mt-4 sm:justify-end">
            <Button onClick={onCancel} type="button" variant="secondary">
              {t("sessions.cancel")}
            </Button>
            <Button disabled={!renameDraft.trim()} type="submit">
              {t("sessions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type CommandPaletteProps = {
  onClose: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  paletteQuery: string;
  recentSessions: SessionSummary[];
  setPaletteQuery: (query: string) => void;
};

export function CommandPalette({
  onClose,
  onOpenSession,
  onOpenSettings,
  paletteQuery,
  recentSessions,
  setPaletteQuery,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  return (
    <CommandDialog
      description={t("sessions.searchCommands")}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={t("sessions.commandPalette")}
    >
      <CommandInput
        aria-label={t("sessions.searchCommands")}
        onValueChange={setPaletteQuery}
        placeholder={t("sessions.searchSessionsAndActions")}
        value={paletteQuery}
      />
      <CommandList>
        <CommandEmpty>{t("sessions.nothingFoundInPalette")}</CommandEmpty>
        <CommandGroup heading={t("sessions.actions")}>
          <CommandItem
            onSelect={() => {
              onClose();
              onOpenSettings();
            }}
          >
            {t("sessions.openSettings")}
          </CommandItem>
        </CommandGroup>
        {recentSessions.length > 0 && (
          <CommandGroup heading={t("sessions.threads")}>
            {recentSessions.map((session) => (
              <CommandItem
                key={session.id}
                onSelect={() => {
                  onClose();
                  onOpenSession(session.id);
                }}
                value={`${session.title}`}
              >
                {t("sessions.openSession")}
                {session.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}

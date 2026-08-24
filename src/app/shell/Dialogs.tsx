// MIT License — Copyright (c) 2026 Mateus Gaio
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import {
  Command,
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

type CommandSurfaceProps = {
  onClose: () => void;
  onNewSession: () => void;
  onOpenNote?: () => void;
  onOpenProfileChooser?: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenSoulSection?: () => void;
  onFocusModelSelector?: () => void;
  onOpenProviders: () => void;
  query: string;
  recentSessions: SessionSummary[];
  setQuery: (query: string) => void;
};

/**
 * Corpo da paleta (input + lista + grupos). Extraído do diálogo para ser
 * testável isoladamente; a raiz <Command> vive no CommandDialog e envolve
 * exatamente esta superfície.
 */
export function CommandSurface({
  onClose,
  onNewSession,
  onOpenNote,
  onOpenProfileChooser,
  onOpenSession,
  onOpenSettings,
  onOpenSoulSection,
  onFocusModelSelector,
  onOpenProviders,
  query,
  recentSessions,
  setQuery,
}: CommandSurfaceProps) {
  const { t } = useTranslation();
  function run(action: () => void) {
    onClose();
    action();
  }
  return (
    // Raiz cmdk OBRIGATÓRIA aqui: Input/List fora deste contexto leem um
    // store inexistente e quebram com "subscribe" undefined ao interagir.
    <Command>
      <CommandInput
        aria-label={t("sessions.searchCommands")}
        onValueChange={setQuery}
        placeholder={t("sessions.searchSessionsAndActions")}
        value={query}
      />
      <CommandList>
        <CommandEmpty>{t("sessions.nothingFoundInPalette")}</CommandEmpty>
        <CommandGroup heading={t("sessions.actions")}>
          <CommandItem onSelect={() => run(onNewSession)}>{t("sessions.new")}</CommandItem>
          <CommandItem
            onSelect={onOpenProfileChooser ? () => run(onOpenProfileChooser) : undefined}
            {...(onOpenProfileChooser ? {} : { disabled: true, "data-disabled": true })}
          >
            {t("palette.switchProfile")}
          </CommandItem>
          <CommandItem onSelect={() => run(onOpenProviders)}>{t("composer.providers")}</CommandItem>
          <CommandItem
            onSelect={
              onOpenSoulSection ? () => run(onOpenSoulSection) : undefined
            }
            {...(onOpenSoulSection ? {} : { disabled: true, "data-disabled": true })}
          >
            {t("palette.editSoul")}
          </CommandItem>
          <CommandItem
            onSelect={onFocusModelSelector ? () => run(onFocusModelSelector) : undefined}
            {...(onFocusModelSelector ? {} : { disabled: true, "data-disabled": true })}
          >
            {t("chat.selectModel")}
          </CommandItem>
          <CommandItem
            onSelect={onOpenNote ? () => run(onOpenNote) : undefined}
            {...(onOpenNote ? {} : { disabled: true, "data-disabled": true })}
            
          >
            {t("palette.openVaultNote")}
            {!onOpenNote && (
              <span className="ml-auto text-xs text-muted-foreground">
                {t("palette.requiresWorkspace")}
              </span>
            )}
          </CommandItem>
          <CommandItem
            onSelect={() => run(onOpenSettings)}
            value={`${t("sessions.openSettings")} ${t("sessions.settings")}`}
          >
            {t("sessions.openSettings")}
          </CommandItem>
          {/* Destino ainda não existe (UX_SPEC §2 lista Agentes como página
          futura): item visível, desabilitado e com motivo acessível. */}
          <CommandItem disabled data-disabled>
            {t("palette.goToAgents")}
            <span className="ml-auto text-xs text-muted-foreground">{t("palette.comingSoon")}</span>
          </CommandItem>
        </CommandGroup>
        {recentSessions.length > 0 && (
          <CommandGroup heading={t("sessions.threads")}>
            {recentSessions.map((session) => (
              <CommandItem
                key={session.id}
                onSelect={() =>
                  run(() => {
                    onOpenSession(session.id);
                  })
                }
                value={`${session.title}`}
              >
                {t("sessions.openSession")}
                {session.title}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  );
}

type CommandPaletteProps = {
  onClose: () => void;
  onNewSession?: () => void;
  onOpenNote?: () => void;
  onOpenProfileChooser?: () => void;
  onOpenSession: (sessionId: string) => void;
  onOpenSettings: () => void;
  onOpenSoulSection?: () => void;
  onFocusModelSelector?: () => void;
  onOpenProviders?: () => void;
  open: boolean;
  paletteQuery: string;
  recentSessions: SessionSummary[];
  setPaletteQuery: (query: string) => void;
};

/**
 * Montada persistentemente e controlada por `open`: o desmonte imediato
 * mataria a animação de saída e o retorno de foco do Radix.
 */
export function CommandPalette({
  onClose,
  onNewSession = () => undefined,
  onOpenNote,
  onOpenProfileChooser,
  onOpenSession,
  onOpenSettings,
  onOpenSoulSection,
  onFocusModelSelector,
  onOpenProviders = () => undefined,
  open,
  paletteQuery,
  recentSessions,
  setPaletteQuery,
}: CommandPaletteProps) {
  const { t } = useTranslation();
  return (
    <CommandDialog
      description={t("sessions.searchCommands")}
      onOpenChange={(next) => {
        if (!next) {
          setPaletteQuery("");
          onClose();
        }
      }}
      open={open}
      title={t("sessions.commandPalette")}
    >
      <CommandSurface
        onClose={() => {
          setPaletteQuery("");
          onClose();
        }}
        onFocusModelSelector={onFocusModelSelector}
        onNewSession={onNewSession}
        onOpenNote={onOpenNote}
        onOpenProfileChooser={onOpenProfileChooser}
        onOpenSession={onOpenSession}
        onOpenProviders={onOpenProviders}
        onOpenSettings={onOpenSettings}
        onOpenSoulSection={onOpenSoulSection}
        query={paletteQuery}
        recentSessions={recentSessions}
        setQuery={setPaletteQuery}
      />
    </CommandDialog>
  );
}

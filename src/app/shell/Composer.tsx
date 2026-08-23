// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import type { ConnectedProvider, ProviderModel, Workspace } from "../../shared/api/sidecar";
import { isSubmitShortcut } from "../composer";
import { CompactIcon } from "./CompactIcon";

type ComposerProps = {
  activeProvider: ConnectedProvider | null;
  activeSessionId: string | undefined;
  changeModel: (model: string) => void;
  changePermissionMode: (mode: Workspace["permissionMode"]) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  isSending: boolean;
  modelName: string;
  models: ProviderModel[];
  onAttachFile: (file: File) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  permissionError: string;
  selectedModel: string;
  setDraft: (draft: string) => void;
  stopGeneration: () => void;
  workspace: Workspace | undefined;
};

function resizeComposer(target: HTMLTextAreaElement) {
  target.style.height = "auto";
  target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
}

const menuItem =
  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors duration-[120ms] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none aria-checked:bg-accent/60";

const popoverContent = "w-64 p-1";

/** Linha de prompt (U4): borda 1px, prefixo ❯ e uma linha de controles no rodapé. */
export function Composer({
  activeProvider,
  activeSessionId,
  changeModel,
  changePermissionMode,
  composerRef,
  draft,
  isSending,
  modelName,
  models,
  onAttachFile,
  onSubmit,
  permissionError,
  selectedModel,
  setDraft,
  stopGeneration,
  workspace,
}: ComposerProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      !isSubmitShortcut({
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        shiftKey: event.shiftKey,
      })
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  return (
    <form
      className="relative z-10 rounded-lg border border-input bg-input/30 transition-colors duration-150 focus-within:border-ring"
      onSubmit={onSubmit}
    >
      <input
        accept=".c,.cpp,.css,.csv,.go,.h,.html,.java,.js,.json,.jsx,.md,.pdf,.py,.rs,.sh,.sql,.toml,.ts,.tsx,.txt,.yaml,.yml"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onAttachFile(file);
        }}
        ref={fileInput}
        type="file"
      />
      <div className="flex items-start gap-2 px-3 pt-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 font-mono text-sm leading-6 text-muted-foreground select-none"
        >
          ❯
        </span>
        <textarea
          aria-label={t("composer.message")}
          className="max-h-[180px] flex-1 resize-none border-0 bg-transparent p-0 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="chat-composer"
          disabled={!activeProvider || !activeSessionId || isSending}
          onChange={(event) => {
            setDraft(event.target.value);
            resizeComposer(event.target);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("composer.writeAMessage")}
          ref={composerRef}
          rows={1}
          value={draft}
        />
      </div>
      <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5 pt-1">
        <div className="flex items-center gap-0.5">
          <Button
            aria-label={t("composer.attachFile")}
            disabled={!activeSessionId || !workspace || isSending}
            onClick={() => fileInput.current?.click()}
            size="icon-sm"
            title={t("composer.attachFile")}
            type="button"
            variant="ghost"
          >
            <CompactIcon kind="clip" />
          </Button>
          {workspace && (
            <Popover onOpenChange={setPermissionOpen} open={permissionOpen}>
              <PopoverTrigger asChild>
                <Button
                  aria-label={t("composer.permissionMode")}
                  size="icon-sm"
                  title={`${t("composer.permissions")}: ${
                    workspace.permissionMode === "ask"
                      ? t("composer.askEveryTime")
                      : workspace.permissionMode === "automatic"
                        ? t("composer.automaticMode")
                        : t("composer.readonly")
                  }`}
                  type="button"
                  variant="ghost"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M12 3 5 6v5c0 4.3 2.8 8.2 7 10 4.2-1.8 7-5.7 7-10V6l-7-3Z" />
                    <path d="m9 12 2 2 4-4" />
                  </svg>
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className={popoverContent} role="menu">
                <p className="px-2 pb-1 font-mono text-[0.68rem] tracking-wide text-muted-foreground uppercase">
                  {t("composer.permissions")}
                </p>
                {(
                  [
                    ["ask", t("composer.askEveryTime")],
                    ["automatic", t("composer.automatic")],
                    ["read-only", t("composer.readonly")],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    aria-checked={workspace.permissionMode === mode}
                    className={cn(
                      menuItem,
                      workspace.permissionMode === mode && "aria-checked:bg-accent",
                    )}
                    key={mode}
                    onClick={() => {
                      changePermissionMode(mode);
                      setPermissionOpen(false);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{label}</span>
                    {workspace.permissionMode === mode && (
                      <span aria-hidden="true" className="text-xs text-muted-foreground">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
                {permissionError && (
                  <small className="block px-2 pt-1 text-xs text-muted-foreground">
                    {permissionError}
                  </small>
                )}
              </PopoverContent>
            </Popover>
          )}
          {activeProvider && (
            <Popover onOpenChange={setModelOpen} open={modelOpen}>
              <PopoverTrigger asChild>
                <Button
                  className="gap-1.5 px-2 font-mono text-xs"
                  data-testid="provider-chip"
                  size="sm"
                  title={modelName}
                  type="button"
                  variant="ghost"
                >
                  <span className="hidden text-muted-foreground sm:inline">
                    {activeProvider.name}
                  </span>
                  <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
                    ›
                  </span>
                  <span className="truncate">{modelName}</span>
                  <CompactIcon kind="chevron" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className={popoverContent} role="menu">
                <p className="px-2 pb-1 font-mono text-[0.68rem] tracking-wide text-muted-foreground uppercase">
                  {activeProvider.name}
                </p>
                {models.map((model) => (
                  <button
                    aria-checked={model.id === selectedModel}
                    className={cn(menuItem, model.id === selectedModel && "aria-checked:bg-accent")}
                    key={model.id}
                    onClick={() => {
                      changeModel(model.id);
                      setModelOpen(false);
                    }}
                    role="menuitemradio"
                    type="button"
                  >
                    <span>{model.name}</span>
                    {model.id === selectedModel && (
                      <span aria-hidden="true" className="text-xs text-muted-foreground">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          )}
        </div>
        {isSending ? (
          <Button
            aria-label={t("composer.stopGenerating")}
            onClick={stopGeneration}
            size="icon-sm"
            title={t("composer.stop")}
            type="button"
            variant="destructive"
          >
            <CompactIcon kind="stop" />
          </Button>
        ) : (
          <Button
            aria-label={t("composer.sendMessage")}
            disabled={!draft.trim() || !activeProvider || !activeSessionId}
            size="icon-sm"
            title={t("composer.sendMessage")}
            type="submit"
            variant="secondary"
          >
            <CompactIcon kind="send" />
          </Button>
        )}
      </div>
    </form>
  );
}

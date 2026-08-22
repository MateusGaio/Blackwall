// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, type KeyboardEvent, type RefObject, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
    <form className="composer relative z-10" onSubmit={onSubmit}>
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
      <button
        aria-label={t("composer.attachFile")}
        className="composer-attach"
        disabled={!activeSessionId || !workspace || isSending}
        onClick={() => fileInput.current?.click()}
        type="button"
      >
        <CompactIcon kind="clip" />
      </button>
      {workspace && (
        <Popover onOpenChange={setPermissionOpen} open={permissionOpen}>
          <PopoverTrigger
            aria-label={t("composer.permissionMode")}
            className="composer-permission"
            title={`${t("composer.permissions")}: ${
              workspace.permissionMode === "ask"
                ? t("composer.askEveryTime")
                : workspace.permissionMode === "automatic"
                  ? t("composer.automaticMode")
                  : t("composer.readonly")
            }`}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 3 5 6v5c0 4.3 2.8 8.2 7 10 4.2-1.8 7-5.7 7-10V6l-7-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
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
      <textarea
        aria-label={t("composer.message")}
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
      {activeProvider && (
        <Popover onOpenChange={setModelOpen} open={modelOpen}>
          <PopoverTrigger className="composer-model" title={modelName} type="button">
            <span className="hidden font-mono text-[0.68rem] text-muted-foreground sm:inline">
              {activeProvider.name}
            </span>
            <span aria-hidden="true" className="hidden text-muted-foreground sm:inline">
              ▸
            </span>
            <span className="composer-model-name">{modelName}</span>
            <CompactIcon kind="chevron" />
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
      {isSending ? (
        <button
          aria-label={t("composer.stopGenerating")}
          className="composer-stop"
          onClick={stopGeneration}
          title={t("composer.stop")}
          type="button"
        >
          <CompactIcon kind="stop" />
        </button>
      ) : (
        <button
          aria-label={t("composer.sendMessage")}
          className="composer-send"
          disabled={!draft.trim() || !activeProvider || !activeSessionId}
          title={t("composer.sendMessage")}
          type="submit"
        >
          <CompactIcon kind="send" />
        </button>
      )}
    </form>
  );
}

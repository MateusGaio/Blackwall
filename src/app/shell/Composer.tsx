// MIT License — Copyright (c) 2026 Mateus Gaio
import { type FormEvent, type KeyboardEvent, type RefObject, useRef } from "react";
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
  isEnglish: boolean;
  isSending: boolean;
  modelName: string;
  models: ProviderModel[];
  modelOpen: boolean;
  onAttachFile: (file: File) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  permissionError: string;
  permissionOpen: boolean;
  selectedModel: string;
  setDraft: (draft: string) => void;
  setModelOpen: DispatchSetBoolean;
  setPermissionOpen: DispatchSetBoolean;
  stopGeneration: () => void;
  workspace: Workspace | undefined;
};

type DispatchSetBoolean = (update: (current: boolean) => boolean) => void;

function resizeComposer(target: HTMLTextAreaElement) {
  target.style.height = "auto";
  target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
}

export function Composer({
  activeProvider,
  activeSessionId,
  changeModel,
  changePermissionMode,
  composerRef,
  draft,
  isEnglish,
  isSending,
  modelName,
  models,
  modelOpen,
  onAttachFile,
  onSubmit,
  permissionError,
  permissionOpen,
  selectedModel,
  setDraft,
  setModelOpen,
  setPermissionOpen,
  stopGeneration,
  workspace,
}: ComposerProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);

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
    <form className="composer" onSubmit={onSubmit}>
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
        aria-label={isEnglish ? "Attach file" : "Anexar arquivo"}
        className="composer-attach"
        disabled={!activeSessionId || !workspace || isSending}
        onClick={() => fileInput.current?.click()}
        type="button"
      >
        <CompactIcon kind="clip" />
      </button>
      {workspace && (
        <div className="permission-control" data-permission-control>
          <button
            aria-expanded={permissionOpen}
            aria-haspopup="menu"
            aria-label={isEnglish ? "Permission mode" : "Modo de permissões"}
            className="composer-permission"
            onClick={() => setPermissionOpen((current) => !current)}
            title={`Permissões: ${
              workspace.permissionMode === "ask"
                ? isEnglish
                  ? "Ask every time"
                  : "Perguntar sempre"
                : workspace.permissionMode === "automatic"
                  ? isEnglish
                    ? "Automatic"
                    : "Automático"
                  : isEnglish
                    ? "Read-only"
                    : "Somente leitura"
            }`}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M12 3 5 6v5c0 4.3 2.8 8.2 7 10 4.2-1.8 7-5.7 7-10V6l-7-3Z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </button>
          {permissionOpen && (
            <div className="permission-popover" role="menu">
              <p>{isEnglish ? "Permissions" : "Permissões"}</p>
              {(
                [
                  ["ask", isEnglish ? "Ask every time" : "Perguntar sempre"],
                  ["automatic", isEnglish ? "Automatic" : "Automático"],
                  ["read-only", isEnglish ? "Read-only" : "Somente leitura"],
                ] as const
              ).map(([mode, label]) => (
                <button
                  className={workspace.permissionMode === mode ? "is-selected" : ""}
                  key={mode}
                  onClick={() => {
                    changePermissionMode(mode);
                    setPermissionOpen(() => false);
                  }}
                  role="menuitemradio"
                  aria-checked={workspace.permissionMode === mode}
                  type="button"
                >
                  <span>{label}</span>
                  {workspace.permissionMode === mode && <span aria-hidden="true">✓</span>}
                </button>
              ))}
              {permissionError && <small className="permission-error">{permissionError}</small>}
            </div>
          )}
        </div>
      )}
      <textarea
        aria-label={isEnglish ? "Message" : "Mensagem"}
        data-testid="chat-composer"
        disabled={!activeProvider || !activeSessionId || isSending}
        onChange={(event) => {
          setDraft(event.target.value);
          resizeComposer(event.target);
        }}
        onKeyDown={handleKeyDown}
        placeholder={isEnglish ? "Write a message…" : "Escreva uma mensagem…"}
        ref={composerRef}
        rows={1}
        value={draft}
      />
      {activeProvider && (
        <div className="model-control" data-model-control>
          <button
            aria-expanded={modelOpen}
            aria-haspopup="menu"
            className="composer-model"
            onClick={() => setModelOpen((current) => !current)}
            title={modelName}
            type="button"
          >
            <span className="composer-model-name">{modelName}</span>
            <CompactIcon kind="chevron" />
          </button>
          {modelOpen && (
            <div className="model-popover" role="menu">
              <p className="eyebrow">{activeProvider.name}</p>
              {models.map((model) => (
                <button
                  aria-checked={model.id === selectedModel}
                  className={model.id === selectedModel ? "is-selected" : ""}
                  key={model.id}
                  onClick={() => {
                    changeModel(model.id);
                    setModelOpen(() => false);
                  }}
                  role="menuitemradio"
                  type="button"
                >
                  <span>{model.name}</span>
                  {model.id === selectedModel && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {isSending ? (
        <button
          aria-label={isEnglish ? "Stop generating" : "Parar geração"}
          className="composer-stop"
          onClick={stopGeneration}
          title={isEnglish ? "Stop" : "Parar"}
          type="button"
        >
          <CompactIcon kind="stop" />
        </button>
      ) : (
        <button
          aria-label={isEnglish ? "Send message" : "Enviar mensagem"}
          className="composer-send"
          disabled={!draft.trim() || !activeProvider || !activeSessionId}
          title={isEnglish ? "Send message" : "Enviar mensagem"}
          type="submit"
        >
          <CompactIcon kind="send" />
        </button>
      )}
    </form>
  );
}

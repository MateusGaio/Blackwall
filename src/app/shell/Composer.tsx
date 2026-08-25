// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/shared/components/motion/Skeleton";
import { Button } from "@/shared/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/components/ui/popover";
import { cn } from "@/shared/lib/utils";
import type {
  ConnectedProvider,
  ProviderModel,
  UsageSummary,
  Workspace,
} from "../../shared/api/sidecar";
import { isSubmitShortcut } from "../composer";
import { CompactIcon } from "./CompactIcon";

type ComposerProps = {
  activeProvider: ConnectedProvider | null;
  activeSessionId: string | undefined;
  changeModel: (model: string) => Promise<void>;
  changePermissionMode: (mode: Workspace["permissionMode"]) => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  draft: string;
  isSending: boolean;
  isModelsLoading?: boolean;
  modelName: string;
  models: ProviderModel[];
  onAttachFile: (file: File) => void;
  onEditQueued?: () => void;
  onOpenProviders?: () => void;
  onOpenUsage: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  permissionError: string;
  queuedCount?: number;
  queuedPreview?: string | null;
  selectedModel: string;
  setDraft: (draft: string) => void;
  stopGeneration: () => void;
  streamingStatus: string;
  usageSummary: UsageSummary | null;
  workspace: Workspace | undefined;
};

function resizeComposer(target: HTMLTextAreaElement) {
  target.style.height = "auto";
  target.style.height = `${Math.min(target.scrollHeight, 180)}px`;
}

const menuItem =
  "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors duration-[120ms] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none aria-checked:bg-accent/60";

const popoverContent = "w-60 p-1";

/** Altura máxima do menu de modelos (comentário 7): cabe na viewport e rola. */
const modelListClass =
  "max-h-[min(18rem,50vh)] overflow-y-auto overscroll-contain [scrollbar-width:thin]";

/** Card flutuante estilo Claude: textarea expansível + rodapé único de controles. */
export function Composer({
  activeProvider,
  activeSessionId,
  changeModel,
  changePermissionMode,
  composerRef,
  draft,
  isModelsLoading = false,
  isSending,
  modelName,
  models,
  onAttachFile,
  onEditQueued,
  onOpenProviders,
  onOpenUsage,
  onSubmit,
  permissionError,
  queuedCount = 0,
  queuedPreview = null,
  selectedModel,
  setDraft,
  stopGeneration,
  streamingStatus,
  usageSummary,
  workspace,
}: ComposerProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [modelOpen, setModelOpen] = useState(false);
  const [permissionOpen, setPermissionOpen] = useState(false);
  // Troca assíncrona de modelo: busy bloqueia cliques repetidos; erro cai
  // inline abaixo da lista (sem rollback invisível).
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [modelError, setModelError] = useState("");
  const modelListRef = useRef<HTMLDivElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);

  const selectedStillLoading = isModelsLoading && models.length === 0;

  useEffect(() => {
    if (!modelOpen) return;
    // Item selecionado entra na viewport sem animação intrusiva.
    const frame = requestAnimationFrame(() => {
      modelListRef.current
        ?.querySelector<HTMLButtonElement>('[data-checked="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [modelOpen]);

  function focusModelAt(offset: number | "first" | "last") {
    const items = modelListRef.current?.querySelectorAll<HTMLButtonElement>("[data-model-item]");
    if (!items || items.length === 0) return;
    const current = Array.prototype.indexOf.call(items, document.activeElement);
    const nextIndex =
      offset === "first" ? 0 : offset === "last" ? items.length - 1 : current + offset;
    const bounded = Math.max(0, Math.min(items.length - 1, nextIndex));
    const target = items[bounded];
    if (!target) return;
    for (const item of items) item.tabIndex = -1;
    target.tabIndex = 0;
    target.focus();
    target.scrollIntoView({ block: "nearest" });
  }

  function handleModelListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number | "first" | "last"> = {
      ArrowDown: 1,
      ArrowUp: -1,
      End: "last",
      Home: "first",
    };
    const move = moves[event.key];
    if (move === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    focusModelAt(move);
  }

  async function chooseModel(model: ProviderModel) {
    if (pendingModelId) return;
    setPendingModelId(model.id);
    setModelError("");
    try {
      await changeModel(model.id);
      setModelOpen(false);
    } catch (reason) {
      setModelError(reason instanceof Error ? reason.message : t("chat.couldNotChangeTheModel"));
    } finally {
      setPendingModelId(null);
    }
  }

  const last = usageSummary?.lastRequest;
  const ctxLabel = useMemo(() => {
    if (!last || last.totalTokens <= 0) return null;
    const compact = new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 1,
      notation: "compact",
    });
    const percent =
      last.contextLimit && last.contextLimit > 0
        ? ` ${Math.min(100, Math.round((last.totalTokens / last.contextLimit) * 100))}%`
        : "";
    return `${t("chat.ctx")}${percent} ${compact.format(last.totalTokens)}`;
  }, [last, t]);

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
      className="relative z-10 rounded-2xl border border-neutral-800 bg-[#121215] transition-colors duration-150 focus-within:border-neutral-700"
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
      <textarea
        aria-label={t("composer.message")}
        className="max-h-[180px] min-h-[44px] w-full resize-none border-0 bg-transparent px-4 pt-3.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="chat-composer"
        disabled={!activeSessionId || isSending}
        onChange={(event) => {
          setDraft(event.target.value);
          resizeComposer(event.target);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t("composer.writeAMessage")}
        ref={composerRef}
        rows={2}
        value={draft}
      />
      {!selectedModel.trim() && (
        // Sem provedor/modelo escolhido: orienta e abre a seleção em vez de
        // deixar o botão de enviar silenciosamente desabilitado.
        <span className="mx-4 mb-1 w-fit" role="status">
          <button
            className="rounded px-0 text-left text-xs text-muted-foreground underline-offset-2 transition-colors duration-[120ms] hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
            onClick={() => setModelOpen(true)}
            type="button"
          >
            {t("chat.chooseModelHint")}
          </button>
        </span>
      )}
      <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
        <div className="flex min-w-0 items-center gap-0.5">
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
          {/* Segundo controle: central de provedores (selecionar/cadastrar). */}
          {onOpenProviders && (
            <Button
              aria-label={t("composer.providers")}
              className="gap-1.5 px-2"
              disabled={isSending}
              onClick={onOpenProviders}
              size="sm"
              title={t("composer.providers")}
              type="button"
              variant="ghost"
            >
              <CompactIcon kind="providers" />
              <span className="hidden text-xs md:inline">{t("composer.providers")}</span>
            </Button>
          )}
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
                  <svg
                    aria-hidden="true"
                    className="size-4 shrink-0"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
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
          {queuedCount > 0 && onEditQueued && (
            <button
              className="rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-[0.68rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onEditQueued}
              title={queuedPreview ?? undefined}
              type="button"
            >
              {t("chat.inQueue", { count: queuedCount })} · {t("chat.editQueued")}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {streamingStatus && (
            <span
              aria-live="polite"
              className="hidden font-mono text-[0.68rem] text-muted-foreground sm:inline"
            >
              {streamingStatus}
            </span>
          )}
          {ctxLabel && (
            <button
              aria-haspopup="dialog"
              className="rounded px-1.5 py-1 font-mono text-[0.68rem] text-muted-foreground transition-colors duration-[120ms] hover:text-foreground focus-visible:outline-none"
              onClick={onOpenUsage}
              title={t("chat.viewFullUsage")}
              type="button"
            >
              {ctxLabel}
            </button>
          )}
          {activeProvider && (
            <Popover
              onOpenChange={(next) => {
                setModelOpen(next);
                if (!next) {
                  // Retorno de foco determinístico ao trigger (#208).
                  const chip = chipRef.current;
                  requestAnimationFrame(() => chip?.focus());
                }
              }}
              open={modelOpen}
            >
              <PopoverTrigger asChild>
                {/* Somente o modelo ativo (comentário 6): provedor permanece
                interno para roteamento e é identificado apenas no popover. */}
                <Button
                  aria-label={`${t("chat.selectModel")}: ${modelName}`}
                  className="max-w-[22ch] gap-1 px-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground max-[420px]:max-w-[120px]"
                  data-testid="model-trigger"
                  ref={chipRef}
                  size="sm"
                  title={modelName}
                  type="button"
                  variant="ghost"
                >
                  {!selectedModel.trim() && (
                    <span className="text-muted-foreground">{t("chat.selectModel")}</span>
                  )}
                  <span className="min-w-0 truncate" data-model-trigger-label>
                    {modelName}
                  </span>
                  <span aria-hidden="true" className="[&_svg]:size-3 shrink-0">
                    <CompactIcon kind="chevron" />
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                aria-haspopup="listbox"
                className={popoverContent}
                role="menu"
              >
                {/* O provedor pode ser identificado aqui dentro — só não no trigger. */}
                <p className="px-2 pb-1 font-mono text-[0.68rem] tracking-wide text-muted-foreground uppercase">
                  {activeProvider.name}
                </p>
                {selectedStillLoading && (
                  <div aria-busy="true" className="grid gap-1 px-1 py-1">
                    <Skeleton className="h-7 w-full" />
                    <Skeleton className="h-7 w-4/5" />
                    <Skeleton className="h-7 w-3/5" />
                  </div>
                )}
                {!selectedStillLoading && models.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    {t("settings.thisProviderReturnedNoModels")}
                  </p>
                )}
                {models.length > 0 && (
                  <div
                    className={modelListClass}
                    data-testid="model-list"
                    onKeyDown={handleModelListKeyDown}
                    ref={modelListRef}
                    role="listbox"
                  >
                    {models.map((model) => {
                      const checked = model.id === selectedModel;
                      const busy = pendingModelId === model.id;
                      return (
                        <button
                          aria-selected={checked}
                          className={cn(menuItem, checked && "bg-accent")}
                          data-checked={checked || undefined}
                          data-model-item=""
                          disabled={pendingModelId !== null}
                          key={model.id}
                          onClick={() => void chooseModel(model)}
                          role="option"
                          tabIndex={checked ? 0 : -1}
                          title={model.name}
                          type="button"
                        >
                          <span className="min-w-0 truncate text-xs">{model.name}</span>
                          <span className="flex shrink-0 items-center gap-1">
                            {busy && (
                              <span
                                aria-hidden="true"
                                className="size-3 animate-spin rounded-full border border-muted-foreground border-t-transparent motion-reduce:animate-none"
                              />
                            )}
                            {checked && (
                              <span aria-hidden="true" className="text-xs text-muted-foreground">
                                ✓
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {pendingModelId && (
                  <p
                    aria-live="polite"
                    className="px-2 py-1 font-mono text-[0.68rem] text-muted-foreground"
                  >
                    {t("composer.switchingModel")}
                  </p>
                )}
                {modelError && (
                  <p className="px-2 py-1 text-xs text-destructive" role="alert">
                    {modelError}
                  </p>
                )}
              </PopoverContent>
            </Popover>
          )}
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
              disabled={
                !draft.trim() || !activeProvider || !activeSessionId || !selectedModel.trim()
              }
              size="icon-sm"
              title={t("composer.sendMessage")}
              type="submit"
              variant="secondary"
            >
              <CompactIcon kind="send" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

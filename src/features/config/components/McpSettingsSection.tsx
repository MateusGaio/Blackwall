// MIT License — Copyright (c) 2026 Mateus Gaio

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createMcpServer,
  deleteMcpExport,
  deleteMcpServer,
  disconnectMcpServer,
  getMcpExport,
  listMcpExportCalls,
  listMcpServers,
  type McpExport,
  type McpExportCall,
  type McpServer,
  type McpServerConfig,
  type McpServerInput,
  type McpTransportKind,
  mcpEndpointUrl,
  rotateMcpExportToken,
  setMcpServerTools,
  testMcpServer,
  updateMcpExport,
  updateMcpServer,
} from "../../../shared/api/sidecar";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { EnterExit } from "../../../shared/components/motion/EnterExit";
import { ProgressIndicator } from "../../../shared/components/motion/ProgressIndicator";
import { Skeleton } from "../../../shared/components/motion/Skeleton";
import { Button } from "../../../shared/components/ui/button";
import { Input } from "../../../shared/components/ui/input";
import { Textarea } from "../../../shared/components/ui/textarea";

type McpSettingsSectionProps = {
  activeWorkspaceId: string | null;
};

type ServerDraft = {
  allowPrivateNetwork: boolean;
  args: string;
  bearer: string;
  command: string;
  cwd: "isolated" | "workspace";
  envName: string;
  envValue: string;
  name: string;
  shareWorkspaceRoot: boolean;
  transport: McpTransportKind;
  url: string;
};

const emptyDraft: ServerDraft = {
  allowPrivateNetwork: false,
  args: "[]",
  bearer: "",
  command: "",
  cwd: "isolated",
  envName: "",
  envValue: "",
  name: "",
  shareWorkspaceRoot: false,
  transport: "stdio",
  url: "",
};

function message(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback;
}

function configFor(server: McpServer): McpServerConfig {
  return server.config;
}

function draftFor(server: McpServer): ServerDraft {
  const config = configFor(server);
  return {
    ...emptyDraft,
    allowPrivateNetwork: server.allowPrivateNetwork,
    args: "args" in config ? JSON.stringify(config.args) : "[]",
    command: "command" in config ? config.command : "",
    cwd: "cwd" in config ? config.cwd : "isolated",
    name: server.name,
    shareWorkspaceRoot: server.shareWorkspaceRoot,
    transport: server.transport,
    url: "url" in config ? config.url : "",
  };
}

function parseArguments(value: string): string[] {
  const parsed: unknown = JSON.parse(value || "[]");
  if (!Array.isArray(parsed) || parsed.some((argument) => typeof argument !== "string")) {
    throw new Error("MCP arguments must be a JSON array of strings.");
  }
  return parsed;
}

function statusLabel(state: McpServer["state"], t: (key: string) => string) {
  const labels: Record<McpServer["state"], string> = {
    connecting: t("settings.mcpStateConnecting"),
    disconnected: t("settings.mcpStateDisconnected"),
    disabled: t("settings.mcpStateDisabled"),
    error: t("settings.mcpStateError"),
    ready: t("settings.mcpStateReady"),
  };
  return labels[state];
}

/** Exportação read-only separada das conexões MCP que o Blackwall consome. */
function McpExportCard({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const [exportConfig, setExportConfig] = useState<McpExport | null>(null);
  const [calls, setCalls] = useState<McpExportCall[]>([]);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmAction, setConfirmAction] = useState<"delete" | "rotate" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await getMcpExport(workspaceId);
      const [nextCalls, nextEndpoint] = await Promise.all([
        next.id ? listMcpExportCalls(workspaceId).catch(() => []) : Promise.resolve([]),
        mcpEndpointUrl(next.endpointPath),
      ]);
      setExportConfig(next);
      setCalls(nextCalls);
      setEndpoint(nextEndpoint);
    } catch (reason) {
      setError(message(reason, t("settings.mcpExportCouldNotLoad")));
    } finally {
      setLoading(false);
    }
  }, [t, workspaceId]);

  useEffect(() => {
    void load();
    return () => setToken("");
  }, [load]);

  async function save(input: { enabled?: boolean; tools?: Array<"search_workspace"> }) {
    setBusy(true);
    setError("");
    try {
      const next = await updateMcpExport(workspaceId, input);
      setExportConfig(next);
      setEndpoint(await mcpEndpointUrl(next.endpointPath));
    } catch (reason) {
      setError(message(reason, t("settings.mcpExportCouldNotSave")));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    setBusy(true);
    setError("");
    try {
      const next = await rotateMcpExportToken(workspaceId);
      setExportConfig(next.export);
      setEndpoint(await mcpEndpointUrl(next.export.endpointPath));
      setToken(next.token);
    } catch (reason) {
      setError(message(reason, t("settings.mcpExportCouldNotRotate")));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await deleteMcpExport(workspaceId);
      setToken("");
      await load();
    } catch (reason) {
      setError(message(reason, t("settings.mcpExportCouldNotDelete")));
    } finally {
      setBusy(false);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError(t("settings.mcpExportCouldNotCopy"));
    }
  }

  if (loading) {
    return (
      <section className="grid gap-3" data-testid="mcp-export-skeleton">
        <Skeleton className="h-6 w-52" />
        <Skeleton className="h-52 rounded-[var(--radius-panel)]" />
      </section>
    );
  }
  const toolEnabled =
    exportConfig?.tools.some((tool) => tool.name === "search_workspace" && tool.enabled) ?? false;
  return (
    <EnterExit className="grid gap-3" show>
      <section
        className="grid gap-4 rounded-[var(--radius-panel)] border border-border bg-muted/20 p-4"
        aria-labelledby="mcp-export-heading"
      >
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium" id="mcp-export-heading">
              {t("settings.mcpExportTitle")}
            </h3>
            <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
              {exportConfig?.enabled
                ? t("settings.mcpExportActive")
                : t("settings.mcpExportDisabled")}
            </span>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.mcpExportLocalOnly")}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.mcpExportWarning")}
          </p>
        </div>
        <label className="flex items-start gap-2 text-xs leading-5">
          <input
            checked={toolEnabled}
            disabled={busy}
            onChange={(event) =>
              void save({ tools: event.target.checked ? ["search_workspace"] : [] })
            }
            type="checkbox"
          />
          <span>
            <span className="font-mono">search_workspace</span> —{" "}
            {t("settings.mcpExportSearchDescription")}
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs leading-5">
          <input
            checked={exportConfig?.enabled ?? false}
            disabled={busy || !exportConfig?.hasToken || !toolEnabled}
            onChange={(event) => void save({ enabled: event.target.checked })}
            type="checkbox"
          />
          <span>{t("settings.mcpExportEnable")}</span>
        </label>
        {endpoint && (
          <div className="grid gap-2 rounded-lg border border-border p-3">
            <p className="text-xs font-medium">{t("settings.mcpExportEndpoint")}</p>
            <div className="flex flex-wrap gap-2">
              <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">
                {endpoint}
              </code>
              <Button
                onClick={() => void copy(endpoint)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {t("settings.copy")}
              </Button>
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              exportConfig?.hasToken && exportConfig.enabled
                ? setConfirmAction("rotate")
                : void rotate()
            }
            size="sm"
            type="button"
            variant="secondary"
          >
            {exportConfig?.hasToken
              ? t("settings.mcpExportRotateToken")
              : t("settings.mcpExportGenerateToken")}
          </Button>
          {exportConfig?.id && (
            <Button
              disabled={busy}
              onClick={() => setConfirmAction("delete")}
              size="sm"
              type="button"
              variant="ghost"
            >
              {t("settings.mcpExportDelete")}
            </Button>
          )}
        </div>
        <EnterExit className="grid gap-2 rounded-lg border border-border p-3" show={Boolean(token)}>
          {token && (
            <>
              <p className="text-xs font-medium">{t("settings.mcpExportTokenOnce")}</p>
              <div className="flex flex-wrap gap-2">
                <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">
                  {token}
                </code>
                <Button
                  onClick={() => void copy(token)}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  {t("settings.copy")}
                </Button>
              </div>
            </>
          )}
        </EnterExit>
        {calls.length > 0 && (
          <div className="grid gap-1 border-t border-border pt-3">
            <p className="text-xs font-medium">{t("settings.mcpExportAudit")}</p>
            <ul className="grid gap-1 text-xs text-muted-foreground">
              {calls.slice(0, 5).map((call) => (
                <li key={`${call.createdAt}-${call.durationMs}`}>
                  {call.toolName} · {call.outcome} · {call.durationMs}ms
                  {call.errorCode ? ` · ${call.errorCode}` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {busy && <ProgressIndicator label={t("motion.progressBusy")} />}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </section>
      {confirmAction && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={
            confirmAction === "delete"
              ? t("settings.mcpExportDelete")
              : t("settings.mcpExportRotateToken")
          }
          description={
            confirmAction === "delete"
              ? t("settings.mcpExportDeleteDescription")
              : t("settings.mcpExportRotateDescription")
          }
          headingLabel={t("settings.confirmation")}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            const action = confirmAction;
            setConfirmAction(null);
            if (action === "delete") void remove();
            else void rotate();
          }}
          title={
            confirmAction === "delete"
              ? t("settings.mcpExportDeleteTitle")
              : t("settings.mcpExportRotateTitle")
          }
        />
      )}
    </EnterExit>
  );
}

/** Configuração local de servidores MCP, carregada apenas ao abrir esta seção. */
export function McpSettingsSection({ activeWorkspaceId }: McpSettingsSectionProps) {
  const { t } = useTranslation();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [draft, setDraft] = useState<ServerDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [serverToRemove, setServerToRemove] = useState<McpServer | null>(null);
  const [toolFilter, setToolFilter] = useState("");
  const [toolSelections, setToolSelections] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const keyboardInteraction = useRef(false);
  const [instantStateChange, setInstantStateChange] = useState(false);

  const loadServers = useCallback(async () => {
    if (!activeWorkspaceId) {
      setServers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await listMcpServers(activeWorkspaceId);
      setServers(next);
      setToolSelections(
        Object.fromEntries(
          next.map((server) => [
            server.id,
            server.tools.filter((tool) => tool.enabled).map((tool) => tool.remoteName),
          ]),
        ),
      );
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotLoad")));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId, t]);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  function updateDraft<Key extends keyof ServerDraft>(key: Key, value: ServerDraft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  /** Mudanças por teclado não devem atrasar o fluxo de preenchimento. */
  function markKeyboardInteraction() {
    keyboardInteraction.current = true;
  }

  function consumeInteractionMotion() {
    const instant = keyboardInteraction.current;
    keyboardInteraction.current = false;
    setInstantStateChange(instant);
    if (instant) requestAnimationFrame(() => setInstantStateChange(false));
  }

  function resetForm() {
    setDraft(emptyDraft);
    setEditingId(null);
    setError("");
    setStatus("");
  }

  function inputFromDraft(): McpServerInput {
    const config: McpServerConfig =
      draft.transport === "stdio"
        ? {
            args: parseArguments(draft.args),
            command: draft.command.trim(),
            cwd: draft.cwd,
          }
        : { url: draft.url.trim() };
    return {
      allowPrivateNetwork: draft.allowPrivateNetwork,
      bearer: draft.bearer.trim() || undefined,
      config,
      environment:
        draft.transport === "stdio" && draft.envName.trim()
          ? { [draft.envName.trim()]: draft.envValue || null }
          : undefined,
      name: draft.name.trim(),
      shareWorkspaceRoot: draft.shareWorkspaceRoot,
      transport: draft.transport,
    };
  }

  function replaceServer(server: McpServer) {
    setServers((current) => {
      const found = current.some((item) => item.id === server.id);
      return found
        ? current.map((item) => (item.id === server.id ? server : item))
        : [...current, server];
    });
    setToolSelections((current) => ({
      ...current,
      [server.id]: server.tools.filter((tool) => tool.enabled).map((tool) => tool.remoteName),
    }));
  }

  async function saveServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId) return;
    setBusyId(editingId ?? "new");
    setError("");
    setStatus("");
    try {
      const input = inputFromDraft();
      const saved = editingId
        ? await updateMcpServer(activeWorkspaceId, editingId, input)
        : await createMcpServer(activeWorkspaceId, input);
      replaceServer(saved);
      setStatus(t("settings.mcpServerSaved"));
      resetForm();
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotSave")));
    } finally {
      setBusyId(null);
    }
  }

  async function testServer(server: McpServer) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    setStatus("");
    try {
      const tested = await testMcpServer(activeWorkspaceId, server.id);
      replaceServer(tested);
      setStatus(t("settings.mcpCatalogueUpdated"));
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotTest")));
    } finally {
      setBusyId(null);
    }
  }

  async function setServerEnabled(server: McpServer, enabled: boolean) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    try {
      replaceServer(await updateMcpServer(activeWorkspaceId, server.id, { enabled }));
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotSave")));
    } finally {
      setBusyId(null);
    }
  }

  async function disconnectServer(server: McpServer) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    try {
      await disconnectMcpServer(activeWorkspaceId, server.id);
      await loadServers();
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotDisconnect")));
    } finally {
      setBusyId(null);
    }
  }

  async function saveTools(server: McpServer) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    try {
      const saved = await setMcpServerTools(
        activeWorkspaceId,
        server.id,
        toolSelections[server.id] ?? [],
      );
      replaceServer(saved);
      setStatus(t("settings.mcpToolsSaved"));
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotUpdateTools")));
    } finally {
      setBusyId(null);
    }
  }

  async function removeEnvironment(server: McpServer, name: string) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    try {
      const saved = await updateMcpServer(activeWorkspaceId, server.id, {
        allowPrivateNetwork: server.allowPrivateNetwork,
        config: configFor(server),
        environment: { [name]: null },
        name: server.name,
        shareWorkspaceRoot: server.shareWorkspaceRoot,
        transport: server.transport,
      });
      replaceServer(saved);
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotSave")));
    } finally {
      setBusyId(null);
    }
  }

  async function removeServer(server: McpServer) {
    if (!activeWorkspaceId) return;
    setBusyId(server.id);
    setError("");
    try {
      await deleteMcpServer(activeWorkspaceId, server.id);
      setRemovingId(server.id);
    } catch (reason) {
      setError(message(reason, t("settings.mcpCouldNotRemove")));
    } finally {
      setBusyId(null);
    }
  }

  function toggleTool(serverId: string, remoteName: string) {
    setToolSelections((current) => {
      const selected = new Set(current[serverId] ?? []);
      if (selected.has(remoteName)) selected.delete(remoteName);
      else selected.add(remoteName);
      return { ...current, [serverId]: [...selected] };
    });
  }

  if (!activeWorkspaceId) {
    return <p className="text-sm text-muted-foreground">{t("settings.mcpNoWorkspace")}</p>;
  }

  return (
    <div
      aria-busy={loading || busyId !== null}
      className="grid gap-6"
      data-testid="mcp-settings-section"
    >
      <McpExportCard workspaceId={activeWorkspaceId} />

      <div className="grid gap-1 border-t border-border pt-6">
        <h3 className="text-sm font-medium">{t("settings.mcpConnectTitle")}</h3>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("settings.mcpConnectDescription")}
        </p>
      </div>
      <section className="grid gap-3 rounded-[var(--radius-panel)] border border-border bg-muted/30 p-4">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium">
            {editingId ? t("settings.mcpEditServer") : t("settings.mcpAddServer")}
          </h3>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("settings.mcpAuthorityWarning")}
          </p>
        </div>
        <form className="grid gap-3" onSubmit={saveServer}>
          <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-server-name">
            {t("settings.mcpName")}
            <Input
              id="mcp-server-name"
              onChange={(event) => updateDraft("name", event.target.value)}
              required
              value={draft.name}
            />
          </label>
          <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-transport">
            {t("settings.mcpTransport")}
            <select
              className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              id="mcp-transport"
              onChange={(event) => {
                consumeInteractionMotion();
                updateDraft("transport", event.target.value as McpTransportKind);
              }}
              onKeyDown={markKeyboardInteraction}
              value={draft.transport}
            >
              <option value="stdio">{t("settings.mcpStdio")}</option>
              <option value="streamable-http">{t("settings.mcpStreamableHttp")}</option>
            </select>
          </label>
          <EnterExit
            className="grid gap-3"
            duration="base"
            instant={instantStateChange}
            offsetPx={4}
            show={draft.transport === "stdio"}
          >
            <fieldset className="grid gap-3 border-0 p-0" disabled={draft.transport !== "stdio"}>
              <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-command">
                {t("settings.mcpCommand")}
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  id="mcp-command"
                  onChange={(event) => updateDraft("command", event.target.value)}
                  required
                  spellCheck={false}
                  value={draft.command}
                />
              </label>
              <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-args">
                {t("settings.mcpArguments")}
                <Textarea
                  className="min-h-14 font-mono text-xs"
                  id="mcp-args"
                  onChange={(event) => updateDraft("args", event.target.value)}
                  spellCheck={false}
                  value={draft.args}
                />
              </label>
              <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-cwd">
                {t("settings.mcpWorkingDirectory")}
                <select
                  className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  id="mcp-cwd"
                  onChange={(event) => updateDraft("cwd", event.target.value as ServerDraft["cwd"])}
                  value={draft.cwd}
                >
                  <option value="isolated">{t("settings.mcpIsolatedDirectory")}</option>
                  <option value="workspace">{t("settings.mcpWorkspaceDirectory")}</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  checked={draft.shareWorkspaceRoot}
                  onChange={(event) => updateDraft("shareWorkspaceRoot", event.target.checked)}
                  type="checkbox"
                />
                {t("settings.mcpShareWorkspaceRoot")}
              </label>
              <div className="grid gap-2 rounded-lg border border-border p-3">
                <p className="text-xs font-medium">{t("settings.mcpEnvironment")}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label={t("settings.mcpEnvironmentName")}
                    onChange={(event) => updateDraft("envName", event.target.value)}
                    placeholder={t("settings.mcpEnvironmentName")}
                    value={draft.envName}
                  />
                  <Input
                    aria-label={t("settings.mcpEnvironmentValue")}
                    autoComplete="off"
                    onChange={(event) => updateDraft("envValue", event.target.value)}
                    placeholder={t("settings.mcpEnvironmentValue")}
                    type="password"
                    value={draft.envValue}
                  />
                </div>
              </div>
            </fieldset>
          </EnterExit>
          <EnterExit
            className="grid gap-3"
            duration="base"
            instant={instantStateChange}
            offsetPx={4}
            show={draft.transport === "streamable-http"}
          >
            <fieldset
              className="grid gap-3 border-0 p-0"
              disabled={draft.transport !== "streamable-http"}
            >
              <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-url">
                {t("settings.mcpUrl")}
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  id="mcp-url"
                  onChange={(event) => updateDraft("url", event.target.value)}
                  required
                  spellCheck={false}
                  type="url"
                  value={draft.url}
                />
              </label>
              <label className="flex items-start gap-2 text-xs leading-5">
                <input
                  checked={draft.allowPrivateNetwork}
                  onChange={(event) => {
                    consumeInteractionMotion();
                    updateDraft("allowPrivateNetwork", event.target.checked);
                  }}
                  onKeyDown={markKeyboardInteraction}
                  type="checkbox"
                />
                <span>{t("settings.mcpAllowPrivateNetwork")}</span>
              </label>
              <EnterExit
                duration="fast"
                instant={instantStateChange}
                offsetPx={2}
                show={draft.allowPrivateNetwork}
              >
                <p className="rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs leading-5 text-foreground">
                  {t("settings.mcpPrivateNetworkWarning")}
                </p>
              </EnterExit>
              <label className="grid gap-1 text-xs font-medium" htmlFor="mcp-bearer">
                {t("settings.mcpBearer")}
                <Input
                  autoComplete="off"
                  id="mcp-bearer"
                  onChange={(event) => updateDraft("bearer", event.target.value)}
                  placeholder={t("settings.mcpBearerWriteOnly")}
                  type="password"
                  value={draft.bearer}
                />
              </label>
            </fieldset>
          </EnterExit>
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={busyId !== null} size="sm" type="submit">
              {busyId === "new" || (editingId !== null && busyId === editingId)
                ? t("settings.saving")
                : editingId
                  ? t("settings.mcpUpdateServer")
                  : t("settings.mcpSaveServer")}
            </Button>
            {editingId && (
              <Button
                disabled={busyId !== null}
                onClick={resetForm}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("settings.cancel")}
              </Button>
            )}
          </div>
        </form>
      </section>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {busyId && <ProgressIndicator label={t("motion.progressBusy")} />}

      <section className="grid gap-3" aria-labelledby="mcp-servers-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium" id="mcp-servers-heading">
            {t("settings.mcpServers")}
          </h3>
          <span className="font-mono text-xs text-muted-foreground">{servers.length}/16</span>
        </div>
        {loading ? (
          <div className="grid gap-3">
            <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
            <Skeleton className="h-32 rounded-[var(--radius-panel)]" />
          </div>
        ) : servers.length === 0 ? (
          <p className="rounded-[var(--radius-panel)] border border-dashed border-border p-4 text-sm text-muted-foreground">
            {t("settings.mcpNoServers")}
          </p>
        ) : (
          <ul className="grid gap-3">
            {servers.map((server) => {
              const selected = toolSelections[server.id] ?? [];
              const filteredTools = server.tools.filter((tool) => {
                const needle = toolFilter.trim().toLocaleLowerCase();
                return (
                  !needle ||
                  `${tool.remoteName} ${tool.description}`.toLocaleLowerCase().includes(needle)
                );
              });
              const isBusy = busyId === server.id;
              return (
                <EnterExit
                  as="li"
                  className="list-none"
                  key={server.id}
                  onExited={() => {
                    if (removingId === server.id) {
                      setServers((current) => current.filter((item) => item.id !== server.id));
                      setRemovingId(null);
                    }
                  }}
                  show={removingId !== server.id}
                >
                  <article className="grid gap-3 rounded-[var(--radius-panel)] border border-border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h4 className="font-medium">{server.name}</h4>
                        <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">
                          {server.transport} · {statusLabel(server.state, t)}
                          {server.errorCode ? ` · ${server.errorCode}` : ""}
                        </p>
                      </div>
                      <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[0.65rem] text-muted-foreground">
                        {server.enabled ? t("settings.mcpEnabled") : t("settings.disabled")}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        disabled={isBusy}
                        onClick={() => void testServer(server)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {isBusy ? t("settings.mcpTesting") : t("settings.mcpTest")}
                      </Button>
                      <Button
                        disabled={isBusy || (!server.enabled && server.state !== "ready")}
                        onClick={() => void setServerEnabled(server, !server.enabled)}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        {server.enabled ? t("settings.mcpDisable") : t("settings.mcpEnable")}
                      </Button>
                      <Button
                        disabled={isBusy}
                        onClick={() => void disconnectServer(server)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("settings.mcpDisconnect")}
                      </Button>
                      <Button
                        disabled={isBusy}
                        onClick={() => {
                          setEditingId(server.id);
                          setDraft(draftFor(server));
                          setStatus("");
                          setError("");
                        }}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("settings.edit")}
                      </Button>
                      <Button
                        disabled={isBusy}
                        onClick={() => setServerToRemove(server)}
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        {t("settings.mcpDelete")}
                      </Button>
                    </div>
                    {server.transport === "stdio" && server.envNames.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{t("settings.mcpEnvironmentNames")}</span>
                        {server.envNames.map((name) => (
                          <button
                            className="rounded border border-border px-1.5 py-0.5 font-mono hover:bg-muted"
                            disabled={isBusy}
                            key={name}
                            onClick={() => void removeEnvironment(server, name)}
                            title={t("settings.mcpRemoveEnvironment")}
                            type="button"
                          >
                            {name} ×
                          </button>
                        ))}
                      </div>
                    )}
                    {server.tools.length > 0 && (
                      <div className="grid gap-2 border-t border-border pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-medium">{t("settings.mcpTools")}</p>
                          <span className="font-mono text-[0.7rem] text-muted-foreground">
                            {selected.length}/64
                          </span>
                        </div>
                        <Input
                          aria-label={t("settings.mcpSearchTools")}
                          onChange={(event) => setToolFilter(event.target.value)}
                          placeholder={t("settings.mcpSearchTools")}
                          value={toolFilter}
                        />
                        {filteredTools.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {t("settings.mcpNoTools")}
                          </p>
                        ) : (
                          <div className="grid max-h-56 gap-1 overflow-auto pr-1">
                            {filteredTools.map((tool) => (
                              <label
                                className="flex cursor-pointer items-start gap-2 rounded-md p-2 text-xs hover:bg-muted"
                                key={tool.remoteName}
                              >
                                <input
                                  checked={selected.includes(tool.remoteName)}
                                  disabled={isBusy || tool.state !== "ready"}
                                  onChange={() => toggleTool(server.id, tool.remoteName)}
                                  type="checkbox"
                                />
                                <span className="grid gap-0.5">
                                  <span className="font-mono text-foreground">
                                    {tool.remoteName}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {tool.description || t("settings.mcpNoDescription")}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t("settings.mcpDisabledByDefault")}
                        </p>
                        <Button
                          disabled={isBusy}
                          onClick={() => void saveTools(server)}
                          size="sm"
                          type="button"
                          variant="secondary"
                        >
                          {t("settings.mcpSaveTools")}
                        </Button>
                      </div>
                    )}
                  </article>
                </EnterExit>
              );
            })}
          </ul>
        )}
      </section>
      {serverToRemove && (
        <ConfirmDialog
          cancelLabel={t("settings.cancel")}
          confirmLabel={t("settings.mcpDelete")}
          description={t("settings.mcpRemoveDescription", { name: serverToRemove.name })}
          headingLabel={t("settings.confirmation")}
          onCancel={() => setServerToRemove(null)}
          onConfirm={() => {
            const server = serverToRemove;
            setServerToRemove(null);
            void removeServer(server);
          }}
          title={t("settings.mcpRemoveTitle", { name: serverToRemove.name })}
        />
      )}
    </div>
  );
}

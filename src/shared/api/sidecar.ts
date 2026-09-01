// MIT License — Copyright (c) 2026 Mateus Gaio
import i18n from "i18next";
import "../../i18n";
import { sidecarConfig } from "../../platform/runtime";

export type ToolCall = { arguments: string; id: string; name: string };

export type ConnectedProvider = {
  baseUrl: string;
  id: string;
  model: string;
  name: string;
  type: "openai-compatible" | "ollama";
};

export type UsageSource = "provider" | "local" | "manual";
export type UsageMetric = "requests" | "tokens" | "credits";
export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};
export type UsageWindow = {
  metric: UsageMetric;
  label: string;
  limit?: number;
  used?: number;
  remaining?: number;
  remainingPercent?: number;
  resetAt?: number;
  source: UsageSource;
};
export type UsageSummary = {
  /** Cumulative across every request in scope — a billing figure, not context occupancy. */
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
  };
  /** The most recent request alone — how much context the conversation currently occupies. */
  lastRequest?: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    contextLimit?: number;
  };
  windows: UsageWindow[];
  daily: Array<{
    date: string;
    providerId: string;
    modelId: string;
    requests: number;
    totalTokens: number;
  }>;
  byPurpose: Array<{
    purpose: "chat" | "compaction" | "memory_extract";
    requests: number;
    totalTokens: number;
  }>;
};

export type Profile = {
  avatarData: string | null;
  id: string;
  locale: string;
  name: string;
  soul: string;
};

export type MemorySettings = {
  automaticEnabled: boolean;
  candidateRetentionDays: number;
  disclosureAcceptedAt: number | null;
  disclosureVersion: string | null;
  extractorMode: string;
  maxDailyJobs: number;
  pausedReason: string | null;
  profileId: string;
  revisionRetentionDays: number;
};

export type ProfileMemory = {
  confidence: number;
  createdAt: number;
  evidenceCount: number;
  id: string;
  kind: string;
  lastSeenAt: number;
  pinned: boolean;
  reasonCode: string;
  revisionHash: string;
  statement: string;
  status: "organized" | "captured" | "archived";
  updatedAt: number;
};

export type MemoryActivity = {
  candidates: Array<{
    body: string;
    confidence: number;
    disposition: string;
    id: string;
    jobId: string;
    kind: string;
    reasonCode: string;
    scope: "profile" | "workspace" | "unassigned";
    title: string;
  }>;
  jobs: Array<{
    attempts: number;
    createdAt: number;
    errorCode: string | null;
    finishedAt: number | null;
    id: string;
    status: string;
    updatedAt: number;
  }>;
  limit: number;
  offset: number;
};

export type Workspace = {
  id: string;
  name: string;
  permissionMode: "ask" | "automatic" | "read-only";
  profileId: string;
  rootPath: string;
  soul: string;
};

export type McpTransportKind = "stdio" | "streamable-http";

export type McpServerConfig =
  | { args: string[]; command: string; cwd: "isolated" | "workspace" }
  | { url: string };

export type McpTool = {
  description: string;
  discoveredAt: number;
  enabled: boolean;
  errorCode: string | null;
  inputSchema: Record<string, unknown>;
  publicName: string;
  remoteName: string;
  state: "ready" | "removed" | "unsupported";
};

export type McpServer = {
  allowPrivateNetwork: boolean;
  config: McpServerConfig;
  enabled: boolean;
  envNames: string[];
  errorCode: string | null;
  hasBearer: boolean;
  id: string;
  name: string;
  shareWorkspaceRoot: boolean;
  slug: string;
  state: "disabled" | "disconnected" | "connecting" | "ready" | "error";
  tools: McpTool[];
  transport: McpTransportKind;
  workspaceId: string;
};

export type McpServerInput = {
  allowPrivateNetwork?: boolean;
  /** Write-only. A resposta nunca ecoa este campo. */
  bearer?: string | null;
  config: McpServerConfig;
  /** Valores são write-only; null remove uma variável configurada. */
  environment?: Record<string, string | null>;
  name: string;
  shareWorkspaceRoot?: boolean;
  transport: McpTransportKind;
};

export type McpExport = {
  enabled: boolean;
  endpointPath: string | null;
  hasToken: boolean;
  id: string | null;
  lastUsedAt: number | null;
  tools: Array<{ enabled: boolean; name: "search_workspace" }>;
  workspaceId: string;
};

export type McpExportCall = {
  createdAt: number;
  durationMs: number;
  errorCode: string | null;
  outcome: "success" | "error" | "timeout" | "rate_limited";
  toolName: "search_workspace";
};

export type VaultFile = {
  content: string;
  headings: string[];
  managed?: boolean;
  object?: {
    body?: string;
    createdAt?: string;
    id?: string;
    revisionId?: string;
    source?: string;
    sourceKind?: string;
    status?: string;
    title?: string;
    type?: string;
    updatedAt?: string;
  };
  path: string;
  title: string;
};

export type VaultGraph = {
  edges: Array<{ label?: string; source: string; target: string }>;
  files: VaultFile[];
  nodes: Array<{ id: string; label: string; path: string }>;
};

export type VaultNoteType = "Project" | "Event" | "Note" | "Topic";
export type VaultNoteStatus = "captured" | "organized" | "archived";

export type VaultNoteRelationTarget = {
  path: string;
  portentId: string;
  title: string;
};

export type VaultNoteSummary = {
  contentHash: string;
  createdAt?: string;
  diagnosticCount: number;
  managed: true;
  path: string;
  portentId: string;
  revisionId?: string;
  source: "blackwall";
  sourceKind?: string;
  status: VaultNoteStatus;
  title: string;
  type: VaultNoteType;
  updatedAt?: string;
};

export type VaultNoteDetail = VaultNoteSummary & {
  belongsTo: VaultNoteRelationTarget | null;
  body: string;
  relatedTo: VaultNoteRelationTarget[];
};

export type VaultNoteCreateInput = {
  belongsTo: string | null;
  body: string;
  relatedTo: string[];
  status: VaultNoteStatus;
  title: string;
  type: VaultNoteType;
};

export type VaultNotePatchInput = Partial<Omit<VaultNoteCreateInput, "belongsTo">> & {
  belongsTo?: string | null;
  expectedHash: string;
};

export type VaultNoteListResponse = {
  notes: VaultNoteSummary[];
  page: number;
  pageSize: number;
  total: number;
};

export type VaultDiagnostic = {
  code: string;
  message: string;
  path: string;
  target?: string;
};

export type VaultDiagnosticPage = {
  diagnostics: VaultDiagnostic[];
  page: number;
  pageSize: number;
  total: number;
};

export type DatafortSettings = {
  autoUpdateLinks: boolean;
  attachmentDirectory: string;
  dailyDirectory: string;
  dailyTemplatePath: string | null;
  explorerScope: "knowledge" | "all";
  externalMarkdownWriteEnabled: boolean;
  layout: Record<string, unknown>;
  newNoteDirectory: string;
  templateDirectory: string;
};

export type DatafortTreeEntry = {
  fileId?: string;
  kind: "directory" | "file";
  managed: boolean;
  name: string;
  path: string;
  writable: boolean;
};

export type DatafortTree = {
  entries: DatafortTreeEntry[];
  limited: boolean;
  settings: DatafortSettings;
};

export type DatafortDocument = {
  content: string;
  contentHash: string;
  fileId: string;
  managed: boolean;
  mtime: number;
  path: string;
  portentId?: string;
  writable: boolean;
};

export type DatafortTrashEntry = {
  contentHash: string;
  deletedAt: number;
  entryId: string;
  fileId: string;
  managed: boolean;
  originalPath: string;
  portentId?: string;
};

export class SidecarApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errorCode?: string,
    readonly currentHash?: string,
  ) {
    super(message);
    this.name = "SidecarApiError";
  }
}

export type Session = {
  createdAt: number;
  id: string;
  profileId: string | null;
  selectedModel: string | null;
  selectedProviderId: string | null;
  title: string;
  updatedAt: number;
  workspaceId: string | null;
};

export type SessionSummary = Session & {
  workspaceName: string | null;
};

export type StoredMessage = ChatMessage & {
  createdAt: number;
  isSummary: boolean;
  model: string | null;
  providerId: string | null;
  sequence: number;
  status: string;
};

export type AppState = {
  activeProfileId: string | null;
  activeSessionId: string | null;
  activeWorkspaceId: string | null;
  messages: StoredMessage[];
  profiles: Profile[];
  recentSessions: SessionSummary[];
  sessions: Session[];
  workspaces: Workspace[];
};

type WorkspaceFile = {
  content: string;
  relativePath: string;
};

type BootstrapInput = {
  locale: string;
  permissionMode?: "ask" | "automatic" | "read-only";
  profileName: string;
  profileSoul: string;
  workspaceName: string;
  workspaceRootPath: string;
  workspaceSoul: string;
  workspaceFiles?: WorkspaceFile[];
  workspaceMode?: "none" | "workspace";
};

type ProviderInput = Omit<ConnectedProvider, "id" | "type"> & {
  apiKey?: string;
  id?: string;
  type?: ConnectedProvider["type"];
};
export type ChatMessage = {
  content: string;
  id: string;
  isSummary?: boolean;
  role: "assistant" | "system" | "tool" | "user";
  toolCallId?: string;
  toolCalls?: ToolCall[];
  toolName?: string;
};

export type WorkspaceToolName =
  | "apply_patch"
  | "bash"
  | "create_or_update_file"
  | "create_vault_note"
  | "execute_command"
  | "list_directory"
  | "read_file"
  | "search_text"
  | "search_workspace";

export type WorkspaceSearchCitation =
  | {
      chunkIndex: number;
      contentHash: string;
      excerpt: string;
      objectId: string;
      path: string;
      source: "vault";
      title: string;
    }
  | {
      attachmentId: string;
      chunkIndex: number;
      contentHash: string;
      excerpt: string;
      filename: string;
      source: "attachment";
    };

export type WorkspaceSearchResponse = {
  mode: "hybrid" | "lexical";
  results: Array<{ citation: WorkspaceSearchCitation }>;
  semanticUnavailable?: string;
};

export type WorkspaceTreeEntry = {
  kind: "directory" | "file";
  name: string;
  path: string;
  size: number | null;
};

export type WorkspaceFileTree = {
  entries: WorkspaceTreeEntry[];
  limited: boolean;
  path: string;
};

export type WorkspaceFilePreview = {
  content: string;
  kind: "code" | "markdown" | "text";
  path: string;
  size: number;
};

export type SessionArtifact = {
  firstSeenAt: number;
  lastSeenAt: number;
  operation: "created" | "modified" | "deleted";
  path: string;
};

export type WorkspaceToolApproval = {
  args: Record<string, unknown>;
  id: string;
  remoteName?: string;
  requestId: string;
  serverId?: string;
  serverName?: string;
  sessionId: string | null;
  tool: string;
  workspaceId: string;
};

export type WorkspaceToolDecision = "allow_once" | "allow_session" | "deny";

export type Attachment = {
  byteSize: number;
  createdAt?: number;
  filename: string;
  id: string;
  status: string;
};

type AttachmentSearchResult = {
  attachmentId: string;
  chunkIndex: number;
  content: string;
  filename: string;
};

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const config = await sidecarConfig();
  const baseUrl = config.sidecar_url;
  if (!baseUrl) {
    throw new Error(i18n.t("errors.sidecarDesktopOnly"));
  }
  const headers = new Headers(init.headers);
  if (config.sidecar_token) headers.set("authorization", `Bearer ${config.sidecar_token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new Error(i18n.t("errors.sidecarUnreachable"));
  }
  const body = (await response.json()) as T & {
    currentHash?: string;
    error?: string;
    errorCode?: string;
  };
  if (!response.ok)
    throw new SidecarApiError(
      body.error ?? i18n.t("errors.localActionFailed"),
      response.status,
      body.errorCode,
      body.currentHash,
    );
  return body;
}

async function requestBytes(
  path: string,
  init: RequestInit,
): Promise<{ bytes: Uint8Array; response: Response }> {
  const config = await sidecarConfig();
  const baseUrl = config.sidecar_url;
  if (!baseUrl) throw new Error(i18n.t("errors.sidecarDesktopOnly"));
  const headers = new Headers(init.headers);
  if (config.sidecar_token) headers.set("authorization", `Bearer ${config.sidecar_token}`);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  } catch {
    throw new Error(i18n.t("errors.sidecarUnreachable"));
  }
  if (!response.ok) {
    let message = i18n.t("errors.localActionFailed");
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error ?? message;
    } catch {
      // Respostas binárias com erro não têm corpo JSON obrigatório.
    }
    throw new Error(message);
  }
  return { bytes: new Uint8Array(await response.arrayBuffer()), response };
}

export async function connectProvider(input: ProviderInput): Promise<ConnectedProvider> {
  const response = await request<{ provider: ConnectedProvider }>("/v1/providers", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.provider;
}

export async function testProvider(input: Omit<ProviderInput, "id">): Promise<void> {
  await request("/v1/providers/test", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function updateProvider(
  id: string,
  input: Omit<ProviderInput, "id">,
): Promise<ConnectedProvider> {
  const response = await request<{ provider: ConnectedProvider }>(`/v1/providers/${id}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return response.provider;
}

export async function deleteProvider(id: string): Promise<void> {
  await request(`/v1/providers/${id}`, { method: "DELETE" });
}

export type ProviderModel = {
  capabilities: string[];
  id: string;
  name: string;
  protocolPreference?: "auto" | "openai-chat" | "openai-responses";
  resolvedProtocol?: "openai-chat" | "openai-responses" | "ollama-chat";
  toolCheckedAt?: number;
  toolProbeErrorCode?: string;
  toolSupport?: "unknown" | "native" | "unsupported" | "probe-error";
  toolSupportSource?: "metadata" | "probe" | "manual";
  toolMode?: "auto" | "compatibility" | "disabled";
  parallelToolCalls?: "auto" | "enabled" | "disabled";
};

export async function discoverProviderModels(
  input: Omit<ProviderInput, "model">,
): Promise<ProviderModel[]> {
  const response = await request<{ models: ProviderModel[] }>("/v1/providers/models", {
    body: JSON.stringify({ ...input, model: "discovery" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.models;
}

export async function listStoredProviderModels(providerId: string): Promise<ProviderModel[]> {
  const response = await request<{ models: ProviderModel[] }>(
    `/v1/providers/${providerId}/models`,
    { method: "GET" },
  );
  return response.models;
}

export async function setProviderModelToolMode(
  providerId: string,
  modelId: string,
  toolMode: ProviderModel["toolMode"],
): Promise<void> {
  await request(
    `/v1/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/tool-mode`,
    {
      body: JSON.stringify({ toolMode: toolMode ?? "auto" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function setProviderModelParallelToolCalls(
  providerId: string,
  modelId: string,
  parallelToolCalls: ProviderModel["parallelToolCalls"],
): Promise<void> {
  await request(
    `/v1/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/parallel-tool-calls`,
    {
      body: JSON.stringify({ parallelToolCalls: parallelToolCalls ?? "auto" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function setProviderModelProtocol(
  providerId: string,
  modelId: string,
  protocolPreference: NonNullable<ProviderModel["protocolPreference"]>,
): Promise<void> {
  await request(
    `/v1/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/protocol`,
    {
      body: JSON.stringify({ protocolPreference }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function probeProviderModel(
  providerId: string,
  modelId: string,
  protocol?: ProviderModel["resolvedProtocol"],
): Promise<ProviderModel> {
  const response = await request<{ model: ProviderModel }>(
    `/v1/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/probe`,
    {
      body: JSON.stringify(protocol ? { protocol } : {}),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.model;
}

export async function setSessionModel(
  sessionId: string,
  model: string,
  providerId: string,
): Promise<Session> {
  const response = await request<{ session: Session }>(`/v1/sessions/${sessionId}/model`, {
    body: JSON.stringify({ model, providerId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.session;
}

export async function getAppState(): Promise<AppState> {
  return request("/v1/state", { method: "GET" });
}

export async function selectProfile(profileId: string): Promise<AppState> {
  return request("/v1/profile/select", {
    body: JSON.stringify({ profileId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function signOutProfile(): Promise<AppState> {
  return request("/v1/profile/sign-out", {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function bootstrapApp(input: BootstrapInput): Promise<AppState> {
  return request("/v1/bootstrap", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function updateProfile(
  profileId: string,
  input: { avatarData?: string | null; locale?: string; name?: string; soul?: string },
): Promise<Profile> {
  const response = await request<{ profile: Profile }>(`/v1/profiles/${profileId}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return response.profile;
}

export async function getMemorySettings(profileId: string): Promise<MemorySettings> {
  const response = await request<{ settings: MemorySettings }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/memory/settings`,
    { method: "GET" },
  );
  return response.settings;
}

export async function updateMemorySettings(
  profileId: string,
  input: {
    acceptDisclosure?: boolean;
    automaticEnabled: boolean;
    disclosureVersion?: string;
    maxDailyJobs?: number;
  },
): Promise<MemorySettings> {
  const response = await request<{ settings: MemorySettings }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/memory/settings`,
    { body: JSON.stringify(input), headers: { "content-type": "application/json" }, method: "PUT" },
  );
  return response.settings;
}

export async function listProfileMemories(
  profileId: string,
  status?: string,
): Promise<{ items: ProfileMemory[]; total: number }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  const response = await request<{ memories: { items: ProfileMemory[]; total: number } }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/memories${query}`,
    { method: "GET" },
  );
  return response.memories;
}

export async function updateProfileMemory(
  profileId: string,
  memoryId: string,
  input: {
    expectedHash: string;
    pinned?: boolean;
    statement?: string;
    status?: ProfileMemory["status"];
  },
): Promise<ProfileMemory> {
  const response = await request<{ memory: ProfileMemory }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/memories/${encodeURIComponent(memoryId)}`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  return response.memory;
}

export async function deleteProfileMemory(
  profileId: string,
  memoryId: string,
  expectedHash: string,
): Promise<void> {
  await request(
    `/v1/profiles/${encodeURIComponent(profileId)}/memories/${encodeURIComponent(memoryId)}`,
    {
      body: JSON.stringify({ confirm: true, expectedHash }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    },
  );
}

export async function getMemoryActivity(profileId: string): Promise<MemoryActivity> {
  return request<MemoryActivity>(`/v1/profiles/${encodeURIComponent(profileId)}/memory/activity`, {
    method: "GET",
  });
}

export async function retryMemoryJob(profileId: string, jobId: string): Promise<void> {
  await request(
    `/v1/profiles/${encodeURIComponent(profileId)}/memory/jobs/${encodeURIComponent(jobId)}/retry`,
    { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
  );
}

export async function approveMemoryCandidate(
  profileId: string,
  candidateId: string,
): Promise<void> {
  await request(
    `/v1/profiles/${encodeURIComponent(profileId)}/memory/candidates/${encodeURIComponent(candidateId)}/approve`,
    { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
  );
}

export async function discardMemoryCandidate(
  profileId: string,
  candidateId: string,
): Promise<void> {
  await request(
    `/v1/profiles/${encodeURIComponent(profileId)}/memory/candidates/${encodeURIComponent(candidateId)}/discard`,
    { body: "{}", headers: { "content-type": "application/json" }, method: "POST" },
  );
}

export async function deleteProfile(profileId: string): Promise<AppState> {
  return request(`/v1/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
}

export async function listProviders(): Promise<ConnectedProvider[]> {
  const response = await request<{ providers: ConnectedProvider[] }>("/v1/providers", {
    method: "GET",
  });
  return response.providers;
}

export async function createSession(
  workspaceId: string | null,
  title?: string,
  profileId?: string | null,
): Promise<Session> {
  const response = await request<{ session: Session }>("/v1/sessions", {
    body: JSON.stringify({ profileId, title, workspaceId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.session;
}

export async function createWorkspace(input: {
  name: string;
  permissionMode?: Workspace["permissionMode"];
  profileId: string;
  rootPath: string;
  soul: string;
  workspaceFiles?: WorkspaceFile[];
}): Promise<Workspace> {
  const response = await request<{ workspace: Workspace }>("/v1/workspaces", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.workspace;
}

export async function setWorkspacePermissionMode(
  workspaceId: string,
  mode: Workspace["permissionMode"],
): Promise<Workspace> {
  const response = await request<{ workspace: Workspace }>(
    `/v1/workspaces/${workspaceId}/permission-mode`,
    {
      body: JSON.stringify({ mode }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.workspace;
}

export async function setWorkspaceSoul(workspaceId: string, soul: string): Promise<Workspace> {
  const response = await request<{ workspace: Workspace }>(`/v1/workspaces/${workspaceId}/soul`, {
    body: JSON.stringify({ soul }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return response.workspace;
}

export async function listMcpServers(workspaceId: string): Promise<McpServer[]> {
  const response = await request<{ servers: McpServer[] }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers`,
    { method: "GET" },
  );
  return response.servers;
}

export async function createMcpServer(
  workspaceId: string,
  input: McpServerInput,
): Promise<McpServer> {
  const response = await request<{ server: McpServer }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.server;
}

export async function updateMcpServer(
  workspaceId: string,
  serverId: string,
  input: McpServerInput | { enabled: boolean },
): Promise<McpServer> {
  const response = await request<{ server: McpServer }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers/${encodeURIComponent(serverId)}`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );
  return response.server;
}

export async function deleteMcpServer(workspaceId: string, serverId: string): Promise<void> {
  await request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers/${encodeURIComponent(serverId)}`,
    { method: "DELETE" },
  );
}

export async function testMcpServer(workspaceId: string, serverId: string): Promise<McpServer> {
  const response = await request<{ server: McpServer }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers/${encodeURIComponent(serverId)}/test`,
    {
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.server;
}

export async function setMcpServerTools(
  workspaceId: string,
  serverId: string,
  enabled: string[],
): Promise<McpServer> {
  const response = await request<{ server: McpServer }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers/${encodeURIComponent(serverId)}/tools`,
    {
      body: JSON.stringify({ enabled }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );
  return response.server;
}

export async function disconnectMcpServer(workspaceId: string, serverId: string): Promise<void> {
  await request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/servers/${encodeURIComponent(serverId)}/disconnect`,
    {
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

export async function getMcpExport(workspaceId: string): Promise<McpExport> {
  const response = await request<{ export: McpExport }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/export`,
    { method: "GET" },
  );
  return response.export;
}

export async function updateMcpExport(
  workspaceId: string,
  input: { enabled?: boolean; tools?: Array<"search_workspace"> },
): Promise<McpExport> {
  const response = await request<{ export: McpExport }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/export`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PUT",
    },
  );
  return response.export;
}

export async function rotateMcpExportToken(
  workspaceId: string,
): Promise<{ export: McpExport; token: string }> {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/export/token/rotate`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function listMcpExportCalls(workspaceId: string): Promise<McpExportCall[]> {
  const response = await request<{ calls: McpExportCall[] }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/export/calls`,
    { method: "GET" },
  );
  return response.calls;
}

export async function deleteMcpExport(workspaceId: string): Promise<void> {
  await request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/mcp/export`, {
    method: "DELETE",
  });
}

export async function mcpEndpointUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const config = await sidecarConfig();
  return config.sidecar_url ? `${config.sidecar_url}${path}` : null;
}

export async function selectSession(sessionId: string): Promise<AppState> {
  return request(`/v1/sessions/${sessionId}/select`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function selectWorkspace(workspaceId: string): Promise<AppState> {
  return request(`/v1/workspaces/${workspaceId}/select`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function getVault(workspaceId: string): Promise<VaultGraph> {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/vault`, { method: "GET" });
}

export async function getDatafortSettings(workspaceId: string): Promise<DatafortSettings> {
  const response = await request<{ settings: DatafortSettings }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/settings`,
    { method: "GET" },
  );
  return response.settings;
}

export async function patchDatafortSettings(
  workspaceId: string,
  input: Partial<Omit<DatafortSettings, "layout">> & { layout?: Record<string, unknown> },
): Promise<DatafortSettings> {
  const response = await request<{ settings: DatafortSettings }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/settings`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  return response.settings;
}

export async function getDatafortTree(workspaceId: string): Promise<DatafortTree> {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/tree`, {
    method: "GET",
  });
}

export async function listDatafortDocuments(
  workspaceId: string,
  path?: string,
): Promise<DatafortDocument[]> {
  const suffix = path ? `?path=${encodeURIComponent(path)}` : "";
  const response = await request<{ documents: DatafortDocument[] }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/documents${suffix}`,
    { method: "GET" },
  );
  return response.documents;
}

export async function createDatafortDocument(
  workspaceId: string,
  input: { content?: string; directory?: string; path?: string; title: string },
): Promise<DatafortDocument> {
  const response = await request<{ document: DatafortDocument }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/documents`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.document;
}

export async function updateDatafortDocument(
  workspaceId: string,
  input: { content: string; expectedHash: string; fileId: string; path: string },
): Promise<DatafortDocument> {
  const response = await request<{ document: DatafortDocument }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/documents`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
  return response.document;
}

export async function moveDatafortEntry(
  workspaceId: string,
  input: { expectedHash: string; sourcePath: string; targetPath: string },
) {
  return request<{
    filesUpdated: number;
    linksUpdated: number;
    sourcePath: string;
    targetPath: string;
  }>(`/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/entries/move`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function deleteDatafortEntry(
  workspaceId: string,
  input: { expectedHash: string; path: string },
) {
  return request<{ entryId: string; path: string }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/entries`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    },
  );
}

export async function listDatafortTrash(workspaceId: string): Promise<DatafortTrashEntry[]> {
  const response = await request<{ entries: DatafortTrashEntry[] }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/trash`,
    { method: "GET" },
  );
  return response.entries;
}

export async function restoreDatafortTrash(workspaceId: string, entryId: string, path?: string) {
  return request<{ path: string; restored: true }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/trash/restore`,
    {
      body: JSON.stringify({ entryId, ...(path ? { path } : {}) }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

export async function permanentlyDeleteDatafortTrash(workspaceId: string, entryId: string) {
  return request<{ deleted: true }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/trash/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
}

export async function saveDatafortDraft(
  workspaceId: string,
  input: { content: string; fileId: string; path: string },
) {
  return request<{ contentHash: string; fileId: string; path: string; updatedAt: number }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/drafts`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

export async function getDatafortDraft(workspaceId: string, fileId: string) {
  const response = await request<{
    draft: {
      content: string;
      contentHash: string;
      fileId: string;
      path: string;
      updatedAt: number;
    } | null;
  }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/drafts/${encodeURIComponent(fileId)}`,
    { method: "GET" },
  );
  return response.draft;
}

export async function deleteDatafortDraft(workspaceId: string, fileId: string) {
  return request<{ deleted: true }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/datafort/drafts/${encodeURIComponent(fileId)}`,
    { method: "DELETE" },
  );
}

export async function listVaultNotes(
  workspaceId: string,
  options: {
    hasDiagnostic?: boolean;
    page?: number;
    pageSize?: number;
    status?: VaultNoteStatus;
    type?: VaultNoteType;
  } = {},
): Promise<VaultNoteListResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options))
    if (value !== undefined) params.set(key, String(value));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/notes${suffix}`, {
    method: "GET",
  });
}

export async function getVaultNote(
  workspaceId: string,
  portentId: string,
): Promise<VaultNoteDetail> {
  const response = await request<{ note: VaultNoteDetail }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/notes/${encodeURIComponent(portentId)}`,
    { method: "GET" },
  );
  return response.note;
}

export async function createVaultNote(
  workspaceId: string,
  input: VaultNoteCreateInput,
): Promise<{ note: VaultNoteDetail; operation: "create"; revisionId: string }> {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/notes`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function patchVaultNote(
  workspaceId: string,
  portentId: string,
  input: VaultNotePatchInput,
): Promise<{
  note: VaultNoteDetail;
  operation: "update" | "archive" | "restore";
  revisionId: string;
}> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/notes/${encodeURIComponent(portentId)}`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

export async function deleteVaultNote(
  workspaceId: string,
  portentId: string,
  expectedHash: string,
): Promise<{ deleted: true; operation: "delete"; revisionId: string }> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/notes/${encodeURIComponent(portentId)}`,
    {
      body: JSON.stringify({ expectedHash }),
      headers: { "content-type": "application/json" },
      method: "DELETE",
    },
  );
}

export async function listVaultDiagnostics(
  workspaceId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<VaultDiagnosticPage> {
  const params = new URLSearchParams();
  if (options.page !== undefined) params.set("page", String(options.page));
  if (options.pageSize !== undefined) params.set("pageSize", String(options.pageSize));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/vault/diagnostics${suffix}`, {
    method: "GET",
  });
}

export async function searchWorkspace(
  workspaceId: string,
  query: string,
  limit = 20,
  options: { includeLifecycle?: boolean } = {},
): Promise<WorkspaceSearchResponse> {
  return request(`/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, {
    body: JSON.stringify({ includeLifecycle: options.includeLifecycle === true, limit, query }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function getWorkspaceFileTree(
  workspaceId: string,
  path = ".",
): Promise<WorkspaceFileTree> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/tree?path=${encodeURIComponent(path)}`,
    { method: "GET" },
  );
}

export async function getWorkspaceFileContent(
  workspaceId: string,
  path: string,
): Promise<WorkspaceFilePreview> {
  return request(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`,
    { method: "GET" },
  );
}

export async function getWorkspaceFilePdf(workspaceId: string, path: string): Promise<Uint8Array> {
  const result = await requestBytes(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/files/pdf?path=${encodeURIComponent(path)}`,
    { method: "GET" },
  );
  return result.bytes;
}

export async function getSessionArtifacts(
  workspaceId: string,
  sessionId: string,
): Promise<SessionArtifact[]> {
  const response = await request<{ artifacts: SessionArtifact[] }>(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/artifacts`,
    { method: "GET" },
  );
  return response.artifacts;
}

export async function getAttachmentContent(
  workspaceId: string,
  attachmentId: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const result = await requestBytes(
    `/v1/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
    { method: "GET" },
  );
  return { bytes: result.bytes, contentType: result.response.headers.get("content-type") ?? "" };
}

export async function undoVaultRevision(workspaceId: string, revisionId: string) {
  return request<{ revisionId: string; undone: boolean }>(
    `/v1/workspaces/${workspaceId}/vault/revisions/${encodeURIComponent(revisionId)}/undo`,
    { method: "POST" },
  );
}

export async function renameSession(sessionId: string, title: string): Promise<Session> {
  const response = await request<{ session: Session }>(`/v1/sessions/${sessionId}`, {
    body: JSON.stringify({ title }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  return response.session;
}

export async function deleteSession(sessionId: string): Promise<void> {
  await request(`/v1/sessions/${sessionId}`, { method: "DELETE" });
}

export async function persistMessage(
  sessionId: string,
  message: {
    content: string;
    model?: string | null;
    providerId?: string | null;
    role: StoredMessage["role"];
    status?: string;
    toolCallId?: string | null;
    toolCalls?: ToolCall[] | null;
    toolName?: string | null;
  },
): Promise<StoredMessage> {
  const response = await request<{ message: StoredMessage }>(`/v1/sessions/${sessionId}/messages`, {
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.message;
}

export async function editSessionMessage(
  sessionId: string,
  messageId: string,
  content: string,
): Promise<StoredMessage[]> {
  const response = await request<{ messages: StoredMessage[] }>(
    `/v1/sessions/${sessionId}/messages/${messageId}/edit`,
    {
      body: JSON.stringify({ content }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  return response.messages;
}

export async function regenerateSession(sessionId: string): Promise<StoredMessage[]> {
  const response = await request<{ messages: StoredMessage[] }>(
    `/v1/sessions/${sessionId}/regenerate`,
    { method: "POST" },
  );
  return response.messages;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function uploadAttachment(
  file: File,
  workspaceId: string,
  sessionId?: string,
): Promise<Attachment> {
  const contentBase64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
  const response = await request<{ attachment: Attachment }>("/v1/attachments", {
    body: JSON.stringify({
      contentBase64,
      filename: file.name,
      mimeType: file.type || "text/plain",
      sessionId: sessionId ?? null,
      workspaceId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.attachment;
}

export async function listAttachments(
  workspaceId: string,
  sessionId?: string,
): Promise<Attachment[]> {
  const response = await request<{ attachments: Attachment[] }>(
    `/v1/attachments?workspaceId=${encodeURIComponent(workspaceId)}&sessionId=${encodeURIComponent(sessionId ?? "")}`,
    { method: "GET" },
  );
  return response.attachments;
}

export async function searchAttachments(
  workspaceId: string,
  query: string,
): Promise<AttachmentSearchResult[]> {
  const response = await request<{ results: AttachmentSearchResult[] }>(
    `/v1/attachments/search?workspaceId=${encodeURIComponent(workspaceId)}&q=${encodeURIComponent(query)}`,
    { method: "GET" },
  );
  return response.results;
}

export async function removeAttachment(attachmentId: string): Promise<void> {
  await request(`/v1/attachments/${encodeURIComponent(attachmentId)}`, { method: "DELETE" });
}

export async function getUsageSummary(
  filters: {
    profileId?: string;
    providerId?: string;
    modelId?: string;
    sessionId?: string;
    from?: number;
    to?: number;
  } = {},
): Promise<UsageSummary> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return request<UsageSummary>(`/v1/usage/summary?${query.toString()}`, { method: "GET" });
}

export async function getProviderUsage(
  providerId: string,
  filters: Omit<Parameters<typeof getUsageSummary>[0], "providerId"> = {},
): Promise<UsageSummary> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return request<UsageSummary>(
    `/v1/providers/${encodeURIComponent(providerId)}/usage?${query.toString()}`,
    { method: "GET" },
  );
}

export async function setProviderUsageLimits(
  providerId: string,
  limits: Array<{ metric: UsageMetric; label: string; limit: number; windowSeconds: number }>,
): Promise<void> {
  await request(`/v1/providers/${encodeURIComponent(providerId)}/usage-limits`, {
    body: JSON.stringify({ limits }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

export async function clearUsageHistory(): Promise<void> {
  await request("/v1/usage/history", { method: "DELETE" });
}

export type StreamResult = {
  content: string;
  error?: string;
  failed?: boolean;
  persisted?: boolean;
  provider: ConnectedProvider | null;
  stopped?: boolean;
  toolCalls?: ToolCall[];
  usage?: { tokens?: TokenUsage; windows?: UsageWindow[] };
};

export type StreamHandlers = {
  onDelta: (delta: string) => void;
  /** Novo candidato começou após falha: descarta parcial ANTERIOR. */
  onAttemptStarted?: () => void;
  onCompacting?: () => void;
  onApproval?: (
    approval: WorkspaceToolApproval,
    resolve: (decision: WorkspaceToolDecision) => void,
  ) => void;
  /** Card resolvido sem o botão (troca de modo/stop): remove o card. */
  onApprovalResolved?: (event: { requestId?: string; status?: string }) => void;
  onToolCompleted?: (result: unknown, callId?: string) => void;
  onToolStarted?: (tool: string, args: Record<string, unknown>, callId?: string) => void;
  onToolFailed?: (
    message: string,
    callId?: string,
    detail?: { code?: string; result?: unknown },
  ) => void;
  onRetry?: (message: string) => void;
  onUsage?: (usage: {
    providerId?: string;
    model?: string;
    tokens?: TokenUsage;
    windows?: UsageWindow[];
  }) => void;
};

export function isStreamEventForRequest(
  eventRequestId: string | undefined,
  requestId: string,
): boolean {
  return (
    !eventRequestId || eventRequestId === requestId || eventRequestId.startsWith(`${requestId}:`)
  );
}

type ActiveStream = {
  done: Promise<StreamResult>;
  stop: () => void;
};

export async function streamMessage(
  providerId: string,
  messages: ChatMessage[],
  model: string | undefined,
  workspaceId: string,
  handlers: StreamHandlers,
  profileId?: string,
  sessionId?: string,
): Promise<ActiveStream> {
  const config = await sidecarConfig();
  const baseUrl = config.sidecar_url;
  if (!baseUrl) throw new Error("O sidecar local não está disponível.");
  const protocols = config.sidecar_token ? ["blackwall.v1", config.sidecar_token] : undefined;
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws"), protocols);
  const requestId = crypto.randomUUID();
  let content = "";
  let resolveDone: (result: StreamResult) => void = () => undefined;
  let rejectDone: (reason: Error) => void = () => undefined;
  const done = new Promise<StreamResult>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const active: ActiveStream = {
    done,
    stop: () => {
      // Em CONNECTING/CLOSED o send lança InvalidStateError síncrono; o
      // fechamento do socket já resolve a promise por error/close.
      if (socket.readyState === WebSocket.OPEN)
        socket.send(JSON.stringify({ requestId, type: "chat.stop" }));
    },
  };
  socket.addEventListener("open", () => {
    socket.send(
      JSON.stringify({
        messages,
        model,
        profileId,
        providerId,
        requestId,
        sessionId,
        type: "chat.start",
        workspaceId: workspaceId === "default" ? undefined : workspaceId,
      }),
    );
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as {
      content?: string;
      delta?: string;
      message?: string;
      provider?: ConnectedProvider;
      persisted?: boolean;
      requestId?: string;
      args?: Record<string, unknown>;
      callId?: string;
      id?: string;
      result?: unknown;
      sessionId?: string;
      tool?: string;
      remoteName?: string;
      serverId?: string;
      serverName?: string;
      type?: string;
      providerId?: string;
      model?: string;
      tokens?: TokenUsage;
      windows?: UsageWindow[];
    };
    // A socket normally carries one request, but keeping the guard here makes
    // multiplexed/late events harmless when the user changes sessions.
    if (!isStreamEventForRequest(message.requestId, requestId)) return;
    if (message.type === "chat.delta" && message.delta) {
      content += message.delta;
      handlers.onDelta(message.delta);
    }
    if (message.type === "chat.compacting") handlers.onCompacting?.();
    if (message.type === "chat.attempt.started") {
      handlers.onAttemptStarted?.();
    }
    if (message.type === "chat.retrying")
      handlers.onRetry?.(message.message ?? i18n.t("errors.retrying"));
    if (message.type === "usage.updated")
      handlers.onUsage?.({
        model: message.model,
        providerId: message.providerId,
        tokens: message.tokens,
        windows: message.windows,
      });
    if (message.type === "tool.started" && message.tool)
      handlers.onToolStarted?.(message.tool, message.args ?? {}, message.callId);
    if (message.type === "approval.requested" && message.tool && handlers.onApproval) {
      handlers.onApproval(
        {
          args: message.args ?? {},
          id: message.id ?? crypto.randomUUID(),
          remoteName: message.remoteName,
          requestId: message.requestId ?? requestId,
          serverId: message.serverId,
          serverName: message.serverName,
          sessionId: message.sessionId ?? sessionId ?? null,
          tool: message.tool,
          workspaceId,
        },
        (decision) => {
          if (socket.readyState === WebSocket.OPEN)
            socket.send(
              JSON.stringify({
                decision,
                requestId: message.requestId ?? requestId,
                type: "approval.resolve",
              }),
            );
        },
      );
    }
    if (message.type === "approval.resolved") {
      // Resolução vinda do sidecar (transição de modo/stop): o card some
      // mesmo sem clique — sem órfãos.
      handlers.onApprovalResolved?.({
        requestId: message.requestId,
        status: (message as { status?: string }).status,
      });
    }
    if (message.type === "tool.completed") {
      handlers.onToolCompleted?.(message.result, message.callId);
    }
    if (message.type === "tool.failed") {
      const detail = message.result as
        | { code?: string; error?: { code?: string; message?: string } }
        | undefined;
      handlers.onToolFailed?.(
        detail?.error?.message ?? message.message ?? "A ferramenta falhou.",
        message.callId,
        { code: detail?.code ?? detail?.error?.code, result: message.result },
      );
    }
    if (message.type === "chat.completed") {
      resolveDone({
        content: message.content ?? content,
        persisted: message.persisted,
        provider: message.provider ?? null,
        toolCalls: [],
        usage: { tokens: message.tokens, windows: message.windows },
      });
      socket.close();
    }
    if (message.type === "chat.stopped") {
      resolveDone({
        content: message.content ?? content,
        persisted: message.persisted,
        provider: null,
        stopped: true,
      });
      socket.close();
    }
    if (message.type === "chat.failed") {
      resolveDone({
        content: message.content ?? content,
        error: message.message ?? i18n.t("errors.noProviderResponse"),
        failed: true,
        persisted: message.persisted,
        provider: message.provider ?? null,
      });
      socket.close();
    }
  });
  socket.addEventListener("error", () =>
    rejectDone(new Error(i18n.t("errors.connectionInterrupted"))),
  );
  socket.addEventListener("close", () => {
    // Fechamento limpo sem evento terminal (completed/stopped/failed): sem
    // este guard a promise `done` fica pendurada e o store trava em
    // isRunning/runLocked para sempre. Se já resolveu, é no-op.
    rejectDone(new Error(i18n.t("errors.connectionClosedEarly")));
  });
  return active;
}

// MIT License — Copyright (c) 2026 Mateus Gaio
import { sidecarUrl } from "../../platform/runtime";

export type ToolCall = { arguments: string; id: string; name: WorkspaceToolName };

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
};

export type Profile = {
  avatarData: string | null;
  id: string;
  locale: string;
  name: string;
  soul: string;
};

export type Workspace = {
  id: string;
  name: string;
  permissionMode: "ask" | "automatic" | "read-only";
  profileId: string;
  rootPath: string;
  soul: string;
};

export type VaultFile = {
  content: string;
  headings: string[];
  path: string;
  title: string;
};

export type VaultGraph = {
  edges: Array<{ label?: string; source: string; target: string }>;
  files: VaultFile[];
  nodes: Array<{ id: string; label: string; path: string }>;
};

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
  profileId?: string;
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
  | "create_or_update_file"
  | "execute_command"
  | "list_directory"
  | "read_file"
  | "search_text";

export type WorkspaceToolApproval = {
  args: Record<string, unknown>;
  id: string;
  requestId: string;
  sessionId: string | null;
  tool: WorkspaceToolName;
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
  const baseUrl = await sidecarUrl();
  if (!baseUrl) {
    throw new Error("Abra o Blackwall pelo app desktop para conectar um provedor local.");
  }
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new Error(
      "Não foi possível acessar o serviço local do Blackwall. Reinicie o app e tente novamente.",
    );
  }
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Não foi possível concluir a ação local.");
  return body;
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

export async function deleteProvider(id: string, profileId?: string): Promise<void> {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  await request(`/v1/providers/${id}${query}`, { method: "DELETE" });
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

export async function listStoredProviderModels(
  providerId: string,
  profileId?: string,
): Promise<ProviderModel[]> {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const response = await request<{ models: ProviderModel[] }>(
    `/v1/providers/${providerId}/models${query}`,
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

export async function deleteProfile(profileId: string): Promise<AppState> {
  return request(`/v1/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
}

export async function listProviders(profileId?: string): Promise<ConnectedProvider[]> {
  const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
  const response = await request<{ providers: ConnectedProvider[] }>(`/v1/providers${query}`, {
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
  return request(`/v1/workspaces/${workspaceId}/vault`, { method: "GET" });
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
  onCompacting?: () => void;
  onApproval?: (
    approval: WorkspaceToolApproval,
    resolve: (decision: WorkspaceToolDecision) => void,
  ) => void;
  onToolCompleted?: (result: unknown, callId?: string) => void;
  onToolStarted?: (tool: WorkspaceToolName, args: Record<string, unknown>, callId?: string) => void;
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
  const baseUrl = await sidecarUrl();
  if (!baseUrl) throw new Error("O sidecar local não está disponível.");
  const socket = new WebSocket(baseUrl.replace(/^http/, "ws"));
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
    stop: () => socket.send(JSON.stringify({ requestId, type: "chat.stop" })),
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
      tool?: WorkspaceToolName;
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
    if (message.type === "chat.retrying")
      handlers.onRetry?.(message.message ?? "Tentando novamente…");
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
          requestId: message.requestId ?? requestId,
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
    if (message.type === "tool.completed") {
      handlers.onToolCompleted?.(message.result, message.callId);
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
        error: message.message ?? "Não foi possível obter resposta.",
        failed: true,
        persisted: message.persisted,
        provider: message.provider ?? null,
      });
      socket.close();
    }
  });
  socket.addEventListener("error", () =>
    rejectDone(new Error("A conexão local foi interrompida.")),
  );
  return active;
}

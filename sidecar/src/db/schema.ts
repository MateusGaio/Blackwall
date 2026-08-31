// MIT License — Copyright (c) 2026 Mateus Gaio
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const profiles = sqliteTable("profiles", {
  avatarData: text("avatar_data"),
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  locale: text("locale").notNull().default("pt-BR"),
  soul: text("soul").notNull(),
  ...timestamps,
});

export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    profileId: text("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    soul: text("soul").notNull(),
    permissionMode: text("permission_mode").notNull().default("ask"),
    lastOpenedAt: integer("last_opened_at").notNull(),
    ...timestamps,
  },
  (table) => ({
    profileName: uniqueIndex("workspaces_profile_name").on(table.profileId, table.name),
  }),
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => profiles.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  selectedProviderId: text("selected_provider_id"),
  selectedModel: text("selected_model"),
  ...timestamps,
});

export const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("openai-compatible"),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  status: text("status").notNull().default("unknown"),
  ...timestamps,
});

/** Configuração não secreta de um servidor MCP, sempre limitada a um workspace. */
export const mcpServers = sqliteTable(
  "mcp_servers",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    transport: text("transport").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    configJson: text("config_json").notNull(),
    shareWorkspaceRoot: integer("share_workspace_root", { mode: "boolean" })
      .notNull()
      .default(false),
    allowPrivateNetwork: integer("allow_private_network", { mode: "boolean" })
      .notNull()
      .default(false),
    state: text("state").notNull().default("disabled"),
    errorCode: text("error_code"),
    ...timestamps,
  },
  (table) => ({
    workspaceSlug: uniqueIndex("mcp_servers_workspace_slug").on(table.workspaceId, table.slug),
  }),
);

/** Metadados de segredos MCP; os valores ficam exclusivamente em secrets.enc. */
export const mcpServerSecrets = sqliteTable(
  "mcp_server_secrets",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull().default(""),
    secretRef: text("secret_ref").notNull(),
    ...timestamps,
  },
  (table) => ({
    serverKindName: uniqueIndex("mcp_server_secrets_server_kind_name").on(
      table.serverId,
      table.kind,
      table.name,
    ),
  }),
);

/** Catálogo descoberto de ferramentas MCP. Nunca anuncia uma tool desabilitada. */
export const mcpTools = sqliteTable(
  "mcp_tools",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    remoteName: text("remote_name").notNull(),
    publicName: text("public_name").notNull(),
    description: text("description").notNull().default(""),
    inputSchema: text("input_schema").notNull().default("{}"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    state: text("state").notNull().default("ready"),
    errorCode: text("error_code"),
    discoveredAt: integer("discovered_at").notNull(),
    ...timestamps,
  },
  (table) => ({
    publicName: uniqueIndex("mcp_tools_public_name").on(table.publicName),
    serverRemoteName: uniqueIndex("mcp_tools_server_remote_name").on(
      table.serverId,
      table.remoteName,
    ),
  }),
);

/** Exportação MCP local por workspace; o token nunca é persistido no SQLite. */
export const mcpExports = sqliteTable(
  "mcp_exports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    lastUsedAt: integer("last_used_at"),
    ...timestamps,
  },
  (table) => ({
    workspace: uniqueIndex("mcp_exports_workspace").on(table.workspaceId),
  }),
);

/** Allowlist mínima do servidor MCP local. Nenhuma ferramenta nasce ativa. */
export const mcpExportTools = sqliteTable(
  "mcp_export_tools",
  {
    exportId: text("export_id")
      .notNull()
      .references(() => mcpExports.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => ({
    primary: primaryKey({ columns: [table.exportId, table.toolName] }),
  }),
);

/** Auditoria técnica limitada; nunca guarda argumentos, conteúdo ou segredos. */
export const mcpExportCalls = sqliteTable(
  "mcp_export_calls",
  {
    id: text("id").primaryKey(),
    exportId: text("export_id")
      .notNull()
      .references(() => mcpExports.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    durationMs: integer("duration_ms").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => ({
    exportCreated: uniqueIndex("mcp_export_calls_export_created").on(
      table.exportId,
      table.createdAt,
    ),
  }),
);

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: text("capabilities").notNull().default("[]"),
    contextLimit: integer("context_limit"),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    protocolPreference: text("protocol_preference").notNull().default("auto"),
    resolvedProtocol: text("resolved_protocol"),
    toolSupport: text("tool_support").notNull().default("unknown"),
    toolSupportSource: text("tool_support_source"),
    toolCheckedAt: integer("tool_checked_at"),
    toolProbeErrorCode: text("tool_probe_error_code"),
    toolMode: text("tool_mode").notNull().default("auto"),
    parallelToolCalls: text("parallel_tool_calls").notNull().default("auto"),
    outputReserve: integer("output_reserve"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    providerModel: uniqueIndex("models_provider_model").on(table.providerId, table.modelId),
  }),
);

export const routerEntries = sqliteTable("router_entries", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  providerId: text("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  position: integer("position").notNull(),
  ...timestamps,
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  isSummary: integer("is_summary", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("complete"),
  providerId: text("provider_id"),
  model: text("model"),
  toolCalls: text("tool_calls"),
  toolName: text("tool_name"),
  toolCallId: text("tool_call_id"),
  sequence: integer("sequence").notNull(),
  ...timestamps,
});

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  storedPath: text("stored_path").notNull(),
  mimeType: text("mime_type").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status").notNull().default("pending"),
  ...timestamps,
});

export const approvals = sqliteTable("approvals", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => sessions.id, { onDelete: "set null" }),
  requestId: text("request_id").notNull(),
  tool: text("tool").notNull(),
  payload: text("payload").notNull(),
  status: text("status").notNull().default("pending"),
  scope: text("scope").notNull().default("once"),
  createdAt: integer("created_at").notNull(),
  resolvedAt: integer("resolved_at"),
});

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const providerUsageEvents = sqliteTable(
  "provider_usage_events",
  {
    requestId: text("request_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    sessionId: text("session_id"),
    profileId: text("profile_id").notNull().default(""),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    status: text("status").notNull().default("completed"),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    windowsJson: text("windows_json").notNull().default("[]"),
    observedAt: integer("observed_at").notNull(),
  },
  (table) => ({
    requestAttempt: uniqueIndex("provider_usage_request_attempt").on(
      table.requestId,
      table.attemptId,
    ),
  }),
);

export const providerUsageDaily = sqliteTable(
  "provider_usage_daily",
  {
    profileId: text("profile_id").notNull().default(""),
    providerId: text("provider_id").notNull(),
    modelId: text("model_id").notNull(),
    dateKey: text("date_key").notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    profileProviderModelDay: uniqueIndex("provider_usage_daily_key").on(
      table.profileId,
      table.providerId,
      table.modelId,
      table.dateKey,
    ),
  }),
);

export const providerUsageLimits = sqliteTable("provider_usage_limits", {
  id: text("id").primaryKey(),
  providerId: text("provider_id").notNull(),
  metric: text("metric").notNull(),
  label: text("label").notNull(),
  limitValue: integer("limit_value").notNull(),
  windowSeconds: integer("window_seconds").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatRuns = sqliteTable("chat_runs", {
  requestId: text("request_id").primaryKey(),
  sessionId: text("session_id"),
  workspaceId: text("workspace_id"),
  profileId: text("profile_id"),
  state: text("state").notNull().default("idle"),
  terminal: text("terminal"),
  terminalEventSequence: integer("terminal_event_sequence"),
  finishReason: text("finish_reason"),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatSteps = sqliteTable("chat_steps", {
  stepId: text("step_id").primaryKey(),
  requestId: text("request_id").notNull(),
  round: integer("round").notNull(),
  providerId: text("provider_id"),
  modelId: text("model_id"),
  attempt: integer("attempt").notNull().default(0),
  status: text("status").notNull().default("pending"),
  finishReason: text("finish_reason"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatToolCalls = sqliteTable("chat_tool_calls", {
  callId: text("call_id").primaryKey(),
  requestId: text("request_id").notNull(),
  stepId: text("step_id").notNull(),
  sequence: integer("sequence").notNull(),
  tool: text("tool").notNull(),
  argumentsJson: text("arguments_json").notNull(),
  status: text("status").notNull().default("pending"),
  outcomeJson: text("outcome_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatRunEvents = sqliteTable("chat_run_events", {
  requestId: text("request_id").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  payloadJson: text("payload_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const workspaceVaultSettings = sqliteTable("workspace_vault_settings", {
  workspaceId: text("workspace_id").primaryKey(),
  managedPath: text("managed_path").notNull(),
  formatVersion: integer("format_version").notNull().default(1),
  ...timestamps,
});

export const workspaceEmbeddingConfigs = sqliteTable("workspace_embedding_configs", {
  workspaceId: text("workspace_id").primaryKey(),
  providerKind: text("provider_kind").notNull(),
  url: text("url").notNull(),
  model: text("model").notNull(),
  dimension: integer("dimension"),
  state: text("state").notNull().default("stale"),
  errorCode: text("error_code"),
  ...timestamps,
});

export const workspaceEmbeddingStates = sqliteTable(
  "workspace_embedding_states",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    state: text("state").notNull().default("unconfigured"),
    errorCode: text("error_code"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    workspaceSource: primaryKey({ columns: [table.workspaceId, table.source] }),
  }),
);

export const sessionArtifacts = sqliteTable(
  "session_artifacts",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    operation: text("operation").notNull(),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => ({
    sessionPath: uniqueIndex("session_artifacts_session_path").on(
      table.sessionId,
      table.workspaceId,
      table.path,
    ),
  }),
);

export const vaultObjects = sqliteTable("vault_objects", {
  rowId: text("row_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  portentId: text("portent_id"),
  path: text("path").notNull(),
  title: text("title").notNull(),
  type: text("type"),
  status: text("status"),
  contentHash: text("content_hash").notNull(),
  sourceMtime: integer("source_mtime").notNull(),
  managed: integer("managed", { mode: "boolean" }).notNull().default(false),
  body: text("body").notNull().default(""),
  sourceContent: text("source_content").notNull().default(""),
  ...timestamps,
});

export const vaultRelations = sqliteTable("vault_relations", {
  relationId: text("relation_id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  sourceObjectId: text("source_object_id").notNull(),
  kind: text("kind").notNull(),
  targetRef: text("target_ref").notNull(),
  targetObjectId: text("target_object_id"),
  resolution: text("resolution").notNull(),
});

export const memoryCaptureJobs = sqliteTable("memory_capture_jobs", {
  id: text("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull(),
  profileId: text("profile_id").notNull(),
  workspaceId: text("workspace_id"),
  sessionId: text("session_id"),
  requestId: text("request_id").notNull(),
  turnMessageId: text("turn_message_id").notNull(),
  sourceRevisionHash: text("source_revision_hash").notNull(),
  trigger: text("trigger").notNull(),
  priority: integer("priority").notNull().default(0),
  inputJson: text("input_json").notNull().default("{}"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: integer("available_at").notNull(),
  lockedAt: integer("locked_at"),
  errorCode: text("error_code"),
  cancelReason: text("cancel_reason"),
  pipelineVersion: text("pipeline_version").notNull().default("v1"),
  ...timestamps,
});

export const memoryCandidates = sqliteTable("memory_candidates", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  scope: text("scope").notNull(),
  kind: text("kind").notNull(),
  proposedType: text("proposed_type"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  confidence: text("confidence").notNull(),
  reasonCode: text("reason_code").notNull(),
  occurrenceCount: integer("occurrence_count").notNull().default(1),
  disposition: text("disposition").notNull().default("pending"),
  expiresAt: integer("expires_at"),
  ...timestamps,
});

export const profileMemories = sqliteTable("profile_memories", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull(),
  kind: text("kind").notNull(),
  slotKey: text("slot_key").notNull(),
  value: text("value").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  statement: text("statement").notNull(),
  status: text("status").notNull().default("captured"),
  confidence: text("confidence").notNull(),
  evidenceCount: integer("evidence_count").notNull().default(1),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  firstSeenAt: integer("first_seen_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
  expiresAt: integer("expires_at"),
  supersededBy: text("superseded_by"),
  ...timestamps,
});

export const profileMemorySettings = sqliteTable("profile_memory_settings", {
  profileId: text("profile_id").primaryKey(),
  automaticEnabled: integer("automatic_enabled", { mode: "boolean" }).notNull().default(false),
  extractorMode: text("extractor_mode").notNull().default("same_session_model"),
  maxDailyJobs: integer("max_daily_jobs").notNull().default(100),
  candidateRetentionDays: integer("candidate_retention_days").notNull().default(30),
  revisionRetentionDays: integer("revision_retention_days").notNull().default(90),
  ...timestamps,
});

export const schema = {
  profiles,
  workspaces,
  sessions,
  providers,
  mcpServers,
  mcpServerSecrets,
  mcpTools,
  mcpExports,
  mcpExportTools,
  mcpExportCalls,
  models,
  routerEntries,
  messages,
  attachments,
  approvals,
  appSettings,
  providerUsageEvents,
  providerUsageDaily,
  providerUsageLimits,
  chatRuns,
  chatSteps,
  chatToolCalls,
  chatRunEvents,
  workspaceVaultSettings,
  workspaceEmbeddingConfigs,
  workspaceEmbeddingStates,
  sessionArtifacts,
  vaultObjects,
  vaultRelations,
  memoryCaptureJobs,
  memoryCandidates,
  profileMemories,
  profileMemorySettings,
};

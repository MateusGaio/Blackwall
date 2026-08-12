// MIT License — Copyright (c) 2026 Mateus Gaio
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
};

export const profiles = sqliteTable("profiles", {
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
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  selectedProviderId: text("selected_provider_id"),
  selectedModel: text("selected_model"),
  ...timestamps,
});

const providers = sqliteTable("providers", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("openai-compatible"),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  status: text("status").notNull().default("unknown"),
  ...timestamps,
});

const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: text("capabilities").notNull().default("[]"),
    available: integer("available", { mode: "boolean" }).notNull().default(true),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => ({
    providerModel: uniqueIndex("models_provider_model").on(table.providerId, table.modelId),
  }),
);

const routerEntries = sqliteTable("router_entries", {
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
  status: text("status").notNull().default("complete"),
  providerId: text("provider_id"),
  model: text("model"),
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

const approvals = sqliteTable("approvals", {
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

export const schema = {
  profiles,
  workspaces,
  sessions,
  providers,
  models,
  routerEntries,
  messages,
  attachments,
  approvals,
  appSettings,
};

// MIT License — Copyright (c) 2026 Mateus Gaio
import type Database from "better-sqlite3";

const migration = `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'pt-BR',
  soul TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL,
  soul TEXT NOT NULL,
  permission_mode TEXT NOT NULL DEFAULT 'ask',
  last_opened_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(profile_id, name)
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL DEFAULT 'openai-compatible',
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  selected_provider_id TEXT,
  selected_model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities TEXT NOT NULL DEFAULT '[]',
  available INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, model_id)
);
CREATE TABLE IF NOT EXISTS router_entries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  provider_id TEXT,
  model TEXT,
  sequence INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  scope TEXT NOT NULL DEFAULT 'once',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS _migrations (
  id INTEGER PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS attachments_fts USING fts5(
  attachment_id UNINDEXED,
  chunk_index UNINDEXED,
  content,
  tokenize = 'unicode61'
);
CREATE INDEX IF NOT EXISTS messages_session_sequence ON messages(session_id, sequence);
CREATE INDEX IF NOT EXISTS sessions_workspace_updated ON sessions(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS attachments_workspace_created ON attachments(workspace_id, created_at DESC);
`;

export function applyMigrations(client: Database.Database) {
  client.pragma("foreign_keys = ON");
  client.pragma("journal_mode = WAL");
  client.pragma("busy_timeout = 5000");
  client.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY NOT NULL, applied_at INTEGER NOT NULL)",
  );
  const applied = client.prepare("SELECT id FROM _migrations WHERE id = 1").get();
  if (!applied) {
    const transaction = client.transaction(() => {
      client.exec(migration);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(1, Date.now());
    });
    transaction();
  }

  const nullableWorkspace = client.prepare("SELECT id FROM _migrations WHERE id = 2").get();
  if (!nullableWorkspace) {
    client.pragma("foreign_keys = OFF");
    client.exec(`
      CREATE TABLE sessions_v2 (
        id TEXT PRIMARY KEY NOT NULL,
        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        selected_provider_id TEXT,
        selected_model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO sessions_v2 (id, workspace_id, title, selected_provider_id, selected_model, created_at, updated_at)
        SELECT id, workspace_id, title, selected_provider_id, selected_model, created_at, updated_at FROM sessions;
      DROP TABLE sessions;
      ALTER TABLE sessions_v2 RENAME TO sessions;
      CREATE INDEX IF NOT EXISTS sessions_workspace_updated ON sessions(workspace_id, updated_at DESC);
    `);
    client.pragma("foreign_keys = ON");
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(2, Date.now());
  }

  const profileColumn = client.prepare("SELECT id FROM _migrations WHERE id = 3").get();
  if (!profileColumn) {
    client.exec(
      "ALTER TABLE sessions ADD COLUMN profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE",
    );
    client.exec(`
      UPDATE sessions
      SET profile_id = (
        SELECT profile_id FROM workspaces WHERE workspaces.id = sessions.workspace_id
      )
      WHERE profile_id IS NULL AND workspace_id IS NOT NULL;
      UPDATE sessions
      SET profile_id = (
        SELECT value FROM app_settings WHERE key = 'active_profile_id'
      )
      WHERE profile_id IS NULL;
      UPDATE sessions
      SET profile_id = (SELECT id FROM profiles ORDER BY updated_at DESC LIMIT 1)
      WHERE profile_id IS NULL;
    `);
    client.exec(
      "CREATE INDEX IF NOT EXISTS sessions_profile_updated ON sessions(profile_id, updated_at DESC)",
    );
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(3, Date.now());
  }

  const avatarColumn = client.prepare("SELECT id FROM _migrations WHERE id = 4").get();
  if (!avatarColumn) {
    client.exec("ALTER TABLE profiles ADD COLUMN avatar_data TEXT");
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(4, Date.now());
  }

  const toolCallingColumns = client.prepare("SELECT id FROM _migrations WHERE id = 5").get();
  if (!toolCallingColumns) {
    const columns = (table: string) =>
      new Set(
        (client.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
    const modelColumns = columns("models");
    const messageColumns = columns("messages");
    if (!modelColumns.has("tool_mode"))
      client.exec("ALTER TABLE models ADD COLUMN tool_mode TEXT NOT NULL DEFAULT 'auto'");
    if (!messageColumns.has("tool_calls"))
      client.exec("ALTER TABLE messages ADD COLUMN tool_calls TEXT");
    if (!messageColumns.has("tool_name"))
      client.exec("ALTER TABLE messages ADD COLUMN tool_name TEXT");
    if (!messageColumns.has("tool_call_id"))
      client.exec("ALTER TABLE messages ADD COLUMN tool_call_id TEXT");
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(5, Date.now());
  }

  const providerCapabilities = client.prepare("SELECT id FROM _migrations WHERE id = 6").get();
  if (!providerCapabilities) {
    const columns = new Set(
      (client.prepare("PRAGMA table_info(models)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    const additions: Array<[string, string]> = [
      ["protocol_preference", "TEXT NOT NULL DEFAULT 'auto'"],
      ["resolved_protocol", "TEXT"],
      ["tool_support", "TEXT NOT NULL DEFAULT 'unknown'"],
      ["tool_support_source", "TEXT"],
      ["tool_checked_at", "INTEGER"],
      ["tool_probe_error_code", "TEXT"],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) client.exec(`ALTER TABLE models ADD COLUMN ${name} ${definition}`);
    }
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(6, Date.now());
  }

  const usageTables = client.prepare("SELECT id FROM _migrations WHERE id = 7").get();
  if (!usageTables) {
    client.exec(`
      CREATE TABLE IF NOT EXISTS provider_usage_events (
        request_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        session_id TEXT,
        profile_id TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'completed',
        error_code TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_input_tokens INTEGER,
        reasoning_tokens INTEGER,
        total_tokens INTEGER,
        windows_json TEXT NOT NULL DEFAULT '[]',
        observed_at INTEGER NOT NULL,
        UNIQUE(request_id, attempt_id)
      );
      CREATE TABLE IF NOT EXISTS provider_usage_daily (
        profile_id TEXT NOT NULL DEFAULT '',
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(profile_id, provider_id, model_id, date_key)
      );
      CREATE TABLE IF NOT EXISTS provider_usage_limits (
        id TEXT PRIMARY KEY NOT NULL,
        provider_id TEXT NOT NULL,
        metric TEXT NOT NULL,
        label TEXT NOT NULL,
        limit_value INTEGER NOT NULL,
        window_seconds INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS provider_usage_events_provider_observed
        ON provider_usage_events(provider_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS provider_usage_events_session_observed
        ON provider_usage_events(session_id, observed_at DESC);
      CREATE INDEX IF NOT EXISTS provider_usage_daily_provider_date
        ON provider_usage_daily(provider_id, date_key DESC);
    `);
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(7, Date.now());
  }

  const modelContextBudget = client.prepare("SELECT id FROM _migrations WHERE id = 8").get();
  if (!modelContextBudget) {
    const columns = new Set(
      (client.prepare("PRAGMA table_info(models)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    const additions: Array<[string, string]> = [
      ["context_limit", "INTEGER"],
      ["output_reserve", "INTEGER"],
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) client.exec(`ALTER TABLE models ADD COLUMN ${name} ${definition}`);
    }
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(8, Date.now());
  }

  const modelParallelToolCalls = client.prepare("SELECT id FROM _migrations WHERE id = 9").get();
  if (!modelParallelToolCalls) {
    const columns = new Set(
      (client.prepare("PRAGMA table_info(models)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    if (!columns.has("parallel_tool_calls"))
      client.exec("ALTER TABLE models ADD COLUMN parallel_tool_calls TEXT NOT NULL DEFAULT 'auto'");
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(9, Date.now());
  }

  const messageSummary = client.prepare("SELECT id FROM _migrations WHERE id = 10").get();
  if (!messageSummary) {
    const columns = new Set(
      (client.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    );
    if (!columns.has("is_summary"))
      client.exec("ALTER TABLE messages ADD COLUMN is_summary INTEGER NOT NULL DEFAULT 0");
    client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(10, Date.now());
  }
}

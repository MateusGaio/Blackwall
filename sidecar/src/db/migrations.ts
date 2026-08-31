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

  const sessionRuns = client.prepare("SELECT id FROM _migrations WHERE id = 11").get();
  if (!sessionRuns) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS chat_runs (
          request_id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
          profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
          state TEXT NOT NULL DEFAULT 'idle',
          terminal TEXT,
          terminal_event_sequence INTEGER,
          finish_reason TEXT,
          started_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_steps (
          step_id TEXT PRIMARY KEY NOT NULL,
          request_id TEXT NOT NULL REFERENCES chat_runs(request_id) ON DELETE CASCADE,
          round INTEGER NOT NULL,
          provider_id TEXT,
          model_id TEXT,
          attempt INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          finish_reason TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS chat_tool_calls (
          call_id TEXT PRIMARY KEY NOT NULL,
          request_id TEXT NOT NULL REFERENCES chat_runs(request_id) ON DELETE CASCADE,
          step_id TEXT NOT NULL REFERENCES chat_steps(step_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          tool TEXT NOT NULL,
          arguments_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          outcome_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(request_id, sequence)
        );
        CREATE TABLE IF NOT EXISTS chat_run_events (
          request_id TEXT NOT NULL REFERENCES chat_runs(request_id) ON DELETE CASCADE,
          sequence INTEGER NOT NULL,
          type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY(request_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS chat_runs_session_state ON chat_runs(session_id, state, updated_at DESC);
        CREATE INDEX IF NOT EXISTS chat_steps_request_round ON chat_steps(request_id, round, attempt);
        CREATE INDEX IF NOT EXISTS chat_tool_calls_request_sequence ON chat_tool_calls(request_id, sequence);
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(11, Date.now());
    });
    transaction();
  }

  const vaultIndex = client.prepare("SELECT id FROM _migrations WHERE id = 12").get();
  if (!vaultIndex) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS workspace_vault_settings (
          workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          managed_path TEXT NOT NULL,
          format_version INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS vault_objects (
          row_id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          portent_id TEXT,
          path TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT,
          status TEXT,
          content_hash TEXT NOT NULL,
          source_mtime INTEGER NOT NULL,
          managed INTEGER NOT NULL DEFAULT 0,
          body TEXT NOT NULL DEFAULT '',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(workspace_id, path)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS vault_objects_workspace_portent
          ON vault_objects(workspace_id, portent_id) WHERE portent_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS vault_objects_workspace_updated
          ON vault_objects(workspace_id, updated_at DESC);
        CREATE TABLE IF NOT EXISTS vault_relations (
          relation_id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          source_object_id TEXT NOT NULL REFERENCES vault_objects(row_id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          target_object_id TEXT REFERENCES vault_objects(row_id) ON DELETE SET NULL,
          resolution TEXT NOT NULL,
          UNIQUE(workspace_id, source_object_id, kind, target_ref)
        );
        CREATE INDEX IF NOT EXISTS vault_relations_workspace_source
          ON vault_relations(workspace_id, source_object_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS vault_objects_fts USING fts5(
          object_id UNINDEXED,
          workspace_id UNINDEXED,
          title,
          body,
          tokenize = 'unicode61'
        );
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(12, Date.now());
    });
    transaction();
  }

  const memoryTables = client.prepare("SELECT id FROM _migrations WHERE id = 13").get();
  if (!memoryTables) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS memory_capture_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          idempotency_key TEXT NOT NULL UNIQUE,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          request_id TEXT NOT NULL,
          turn_message_id TEXT NOT NULL,
          source_revision_hash TEXT NOT NULL,
          trigger TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          input_json TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'pending',
          attempts INTEGER NOT NULL DEFAULT 0,
          available_at INTEGER NOT NULL,
          locked_at INTEGER,
          error_code TEXT,
          cancel_reason TEXT,
          pipeline_version TEXT NOT NULL DEFAULT 'v1',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS memory_capture_jobs_ready
          ON memory_capture_jobs(status, available_at, priority DESC);
        CREATE TABLE IF NOT EXISTS memory_candidates (
          id TEXT PRIMARY KEY NOT NULL,
          job_id TEXT NOT NULL REFERENCES memory_capture_jobs(id) ON DELETE CASCADE,
          scope TEXT NOT NULL,
          kind TEXT NOT NULL,
          proposed_type TEXT,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          normalized_key TEXT NOT NULL,
          confidence REAL NOT NULL,
          reason_code TEXT NOT NULL,
          occurrence_count INTEGER NOT NULL DEFAULT 1,
          disposition TEXT NOT NULL DEFAULT 'pending',
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS memory_candidates_dedupe
          ON memory_candidates(scope, normalized_key, disposition);
        CREATE TABLE IF NOT EXISTS profile_memories (
          id TEXT PRIMARY KEY NOT NULL,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          kind TEXT NOT NULL,
          slot_key TEXT NOT NULL,
          value TEXT NOT NULL,
          normalized_key TEXT NOT NULL,
          statement TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'captured',
          confidence REAL NOT NULL,
          evidence_count INTEGER NOT NULL DEFAULT 1,
          pinned INTEGER NOT NULL DEFAULT 0,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          expires_at INTEGER,
          superseded_by TEXT REFERENCES profile_memories(id) ON DELETE SET NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS profile_memories_active_slot
          ON profile_memories(profile_id, slot_key) WHERE status != 'archived';
        CREATE TABLE IF NOT EXISTS profile_memory_settings (
          profile_id TEXT PRIMARY KEY NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          automatic_enabled INTEGER NOT NULL DEFAULT 0,
          extractor_mode TEXT NOT NULL DEFAULT 'same_session_model',
          max_daily_jobs INTEGER NOT NULL DEFAULT 100,
          candidate_retention_days INTEGER NOT NULL DEFAULT 30,
          revision_retention_days INTEGER NOT NULL DEFAULT 90,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memory_evidence (
          id TEXT PRIMARY KEY NOT NULL,
          profile_memory_id TEXT REFERENCES profile_memories(id) ON DELETE CASCADE,
          candidate_id TEXT REFERENCES memory_candidates(id) ON DELETE CASCADE,
          vault_object_row_id TEXT REFERENCES vault_objects(row_id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
          request_id TEXT NOT NULL,
          source_role TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          source_revision_hash TEXT NOT NULL,
          origin TEXT NOT NULL,
          observed_at INTEGER NOT NULL,
          CHECK ((profile_memory_id IS NOT NULL) + (candidate_id IS NOT NULL) + (vault_object_row_id IS NOT NULL) = 1)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence_candidate_key
          ON memory_evidence(candidate_id, message_id, source_revision_hash, origin)
          WHERE candidate_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS memory_evidence_memory_key
          ON memory_evidence(profile_memory_id, message_id, source_revision_hash, origin)
          WHERE profile_memory_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS memory_revisions (
          id TEXT PRIMARY KEY NOT NULL,
          job_id TEXT REFERENCES memory_capture_jobs(id) ON DELETE SET NULL,
          profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
          workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
          target_kind TEXT NOT NULL,
          vault_object_row_id TEXT REFERENCES vault_objects(row_id) ON DELETE CASCADE,
          profile_memory_id TEXT REFERENCES profile_memories(id) ON DELETE CASCADE,
          path TEXT,
          operation TEXT NOT NULL,
          before_hash TEXT,
          after_hash TEXT,
          before_blob TEXT,
          after_blob TEXT,
          expected_hash TEXT,
          actor TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'prepared',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          CHECK ((target_kind = 'vault_object' AND vault_object_row_id IS NOT NULL AND profile_memory_id IS NULL)
            OR (target_kind = 'profile_memory' AND profile_memory_id IS NOT NULL AND vault_object_row_id IS NULL))
        );
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(13, Date.now());
    });
    transaction();
  }

  const vaultRevisions = client.prepare("SELECT id FROM _migrations WHERE id = 14").get();
  if (!vaultRevisions) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS vault_revisions (
          revision_id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          note_id TEXT NOT NULL,
          path TEXT NOT NULL,
          title TEXT NOT NULL,
          type TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'prepared',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          undone_at INTEGER,
          UNIQUE(workspace_id, note_id),
          CHECK (state IN ('prepared', 'committed', 'undone'))
        );
        CREATE INDEX IF NOT EXISTS vault_revisions_workspace_created
          ON vault_revisions(workspace_id, created_at DESC);
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(14, Date.now());
    });
    transaction();
  }

  const vaultSourceContent = client.prepare("SELECT id FROM _migrations WHERE id = 15").get();
  if (!vaultSourceContent) {
    const transaction = client.transaction(() => {
      const columns = new Set(
        (client.prepare("PRAGMA table_info(vault_objects)").all() as Array<{ name: string }>).map(
          (column) => column.name,
        ),
      );
      if (!columns.has("source_content")) {
        client.exec("ALTER TABLE vault_objects ADD COLUMN source_content TEXT NOT NULL DEFAULT ''");
      }
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(15, Date.now());
    });
    transaction();
  }

  const workspaceEmbeddingConfigs = client
    .prepare("SELECT id FROM _migrations WHERE id = 16")
    .get();
  if (!workspaceEmbeddingConfigs) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS workspace_embedding_configs (
          workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          provider_kind TEXT NOT NULL,
          url TEXT NOT NULL,
          model TEXT NOT NULL,
          dimension INTEGER,
          state TEXT NOT NULL DEFAULT 'stale',
          error_code TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(16, Date.now());
    });
    transaction();
  }

  const workspaceEmbeddingStates = client.prepare("SELECT id FROM _migrations WHERE id = 17").get();
  if (!workspaceEmbeddingStates) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS workspace_embedding_states (
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'unconfigured',
          error_code TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, source),
          CHECK (source IN ('vault', 'attachment'))
        );
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(17, Date.now());
    });
    transaction();
  }

  const sessionArtifacts = client.prepare("SELECT id FROM _migrations WHERE id = 18").get();
  if (!sessionArtifacts) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS session_artifacts (
          id TEXT PRIMARY KEY NOT NULL,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          operation TEXT NOT NULL,
          first_seen_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          UNIQUE(session_id, workspace_id, path),
          CHECK (operation IN ('created', 'modified', 'deleted'))
        );
        CREATE INDEX IF NOT EXISTS session_artifacts_workspace_session_seen
          ON session_artifacts(workspace_id, session_id, last_seen_at DESC);
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(18, Date.now());
    });
    transaction();
  }

  const mcpClient = client.prepare("SELECT id FROM _migrations WHERE id = 19").get();
  if (!mcpClient) {
    const transaction = client.transaction(() => {
      client.exec(`
        CREATE TABLE IF NOT EXISTS mcp_servers (
          id TEXT PRIMARY KEY NOT NULL,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          transport TEXT NOT NULL CHECK (transport IN ('stdio', 'streamable-http')),
          enabled INTEGER NOT NULL DEFAULT 0,
          config_json TEXT NOT NULL,
          share_workspace_root INTEGER NOT NULL DEFAULT 0,
          allow_private_network INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'disabled',
          error_code TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(workspace_id, slug)
        );
        CREATE TABLE IF NOT EXISTS mcp_server_secrets (
          id TEXT PRIMARY KEY NOT NULL,
          server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('bearer', 'env')),
          name TEXT NOT NULL DEFAULT '',
          secret_ref TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(server_id, kind, name)
        );
        CREATE TABLE IF NOT EXISTS mcp_tools (
          id TEXT PRIMARY KEY NOT NULL,
          server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
          remote_name TEXT NOT NULL,
          public_name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL DEFAULT '',
          input_schema TEXT NOT NULL DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'ready',
          error_code TEXT,
          discovered_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(server_id, remote_name)
        );
        CREATE INDEX IF NOT EXISTS mcp_servers_workspace_updated
          ON mcp_servers(workspace_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS mcp_tools_server_enabled
          ON mcp_tools(server_id, enabled);
      `);
      client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(19, Date.now());
    });
    transaction();
  }
}

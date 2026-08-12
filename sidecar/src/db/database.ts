// MIT License — Copyright (c) 2026 Mateus Gaio

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { applyMigrations } from "./migrations.js";
import { schema } from "./schema.js";

export type BlackwallDatabase = BetterSQLite3Database<typeof schema>;
export type DatabaseHandle = {
  client: Database.Database;
  db: BlackwallDatabase;
  close: () => void;
  path: string;
};

export function dataDirectory(): string {
  return process.env.BLACKWALL_DATA_DIR ?? join(homedir(), ".blackwall");
}

export function openDatabase(directory = dataDirectory()): DatabaseHandle {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "blackwall.db");
  const client = new Database(path);
  client.defaultSafeIntegers(false);
  applyMigrations(client);
  migrateLegacyProviders(client, directory);
  return {
    client,
    db: drizzle(client, { schema }),
    close: () => client.close(),
    path,
  };
}

function migrateLegacyProviders(client: Database.Database, directory: string) {
  const legacyPath = join(directory, "providers.json");
  const backupPath = join(directory, "providers.json.bak");
  const current = client.prepare("SELECT COUNT(*) AS count FROM providers").get() as {
    count: number;
  };
  if (!existsSync(legacyPath) || current.count > 0) return;
  const legacy = JSON.parse(readFileSync(legacyPath, "utf8")) as {
    providers?: Array<{ baseUrl: string; id: string; name: string }>;
  };
  const providers = legacy.providers ?? [];
  const insert = client.prepare(
    "INSERT OR IGNORE INTO providers (id, type, name, base_url, status, created_at, updated_at) VALUES (?, 'openai-compatible', ?, ?, 'unknown', ?, ?)",
  );
  const timestamp = Date.now();
  const migrate = client.transaction(() => {
    for (const provider of providers) {
      insert.run(provider.id, provider.name, provider.baseUrl, timestamp, timestamp);
    }
  });
  migrate();
  if (!existsSync(backupPath)) copyFileSync(legacyPath, backupPath);
}

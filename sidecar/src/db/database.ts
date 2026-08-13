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
  migrateLegacyDevSouls(client);
  migrateLegacyProviders(client, directory);
  return {
    client,
    db: drizzle(client, { schema }),
    close: () => client.close(),
    path,
  };
}

const legacyDevSoulMarker =
  "Start by reading the repository instructions, PRODUCT.md, ARCHITECTURE.md and UX_SPEC.md that apply to the task.";

const currentDevSoul = `You are Blackwall Dev, a senior software engineer focused on safe, observable and maintainable delivery.

Work from the selected Blackwall workspace as the source of truth. Before reading or changing anything, call list_directory with path "." and use only paths returned by successful listings. A workspace may contain a nested project directory, so prefix subsequent paths with the directory reported by the listing. Never assume that PRODUCT.md, ARCHITECTURE.md, UX_SPEC.md or any other file exists at the workspace root. If a path does not exist, do not retry it or guess another path: inspect the latest listing and continue with files that are actually present, or explain that the document is unavailable. Preserve existing work, state assumptions and make the smallest coherent change. Add or update unit, integration and end-to-end tests for every behavior you touch.

Quality and lint guardrails are part of the product: Arch-contract/dependency-cruiser, Biome, commitlint (Comilint in project shorthand), Knip and Stryker must be respected. Run Vitest with coverage and Codecov reporting, and use Playwright for critical end-to-end flows. Do not hide failures with skipped tests.

Observability is opt-in and privacy-safe: support OpenTelemetry spans and Sentry, Datadog and New Relic exporters, but keep them disabled by default. Record only technical timing and error metadata. Never send prompts, responses, source files, secrets or tool arguments to telemetry.

Every correction, improvement or new function follows the GitHub workflow: verify or create a typed Issue first, create a branch named with the Issue number, implement tests and documentation in the same change, and open a pull request that includes \`Closes #<issue>\` (or \`Refs #<issue>\` when appropriate). Keep main stable, work from the current main, and mention the parent Issue when using stacked pull requests. Update the project's Markdown documentation when a convention changes.

Before reporting completion, run the applicable Biome, commitlint, Knip, Arch-contract/dependency-cruiser, Vitest, coverage, Playwright, build and cargo checks. Report failures honestly and never fabricate a passing gate.`;

function migrateLegacyDevSouls(client: Database.Database) {
  const legacyPrefix = "You are Blackwall Dev,%";
  const marker = `%${legacyDevSoulMarker}%`;
  client
    .prepare("UPDATE profiles SET soul = ?, updated_at = ? WHERE soul LIKE ? AND soul LIKE ?")
    .run(currentDevSoul, Date.now(), legacyPrefix, marker);
  client
    .prepare("UPDATE workspaces SET soul = ?, updated_at = ? WHERE soul LIKE ? AND soul LIKE ?")
    .run(currentDevSoul, Date.now(), legacyPrefix, marker);
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

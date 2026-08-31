// MIT License — Copyright (c) 2026 Mateus Gaio
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdir, realpath } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import {
  Client,
  type FetchLike,
  type Tool as RemoteTool,
  StreamableHTTPClientTransport,
  type Transport,
} from "@modelcontextprotocol/client";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { and, eq, inArray } from "drizzle-orm";
import { dataDirectory, openSharedDatabase } from "./db/database.js";
import { mcpServerSecrets, mcpServers, mcpTools, workspaces } from "./db/schema.js";
import { decryptSecret, encryptSecret, hasSecret, removeSecret } from "./secrets.js";

const MAX_ENABLED_SERVERS = 16;
const MAX_ENABLED_TOOLS = 64;
const MAX_TOOL_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOOL_DESCRIPTION_CHARS = 2_000;
const MAX_TOOL_SCHEMA_BYTES = 32 * 1024;
const MAX_TOOL_RESULT_BYTES = 128 * 1024;
const MCP_TIMEOUT_MS = 120_000;
const PUBLIC_SERVER_SLUG_LENGTH = 16;
const PUBLIC_TOOL_SLUG_LENGTH = 20;
const HASH_LENGTH = 8;

export type McpTransportKind = "stdio" | "streamable-http";
type McpServerState = "disabled" | "disconnected" | "connecting" | "ready" | "error";
type McpToolState = "ready" | "removed" | "unsupported";

type StdioMcpConfig = {
  args: string[];
  command: string;
  cwd: "isolated" | "workspace";
};

type StreamableHttpMcpConfig = { url: string };
export type McpServerConfig = StdioMcpConfig | StreamableHttpMcpConfig;

export type McpServerInput = {
  allowPrivateNetwork?: boolean;
  bearer?: string | null;
  config: McpServerConfig;
  environment?: Record<string, string | null>;
  id?: string;
  name: string;
  shareWorkspaceRoot?: boolean;
  transport: McpTransportKind;
};

type McpToolView = {
  description: string;
  discoveredAt: number;
  enabled: boolean;
  errorCode: string | null;
  inputSchema: Record<string, unknown>;
  publicName: string;
  remoteName: string;
  state: McpToolState;
};

type McpServerView = {
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
  state: McpServerState;
  tools: McpToolView[];
  transport: McpTransportKind;
  workspaceId: string;
};

export type McpToolDefinition = {
  function: {
    description: string;
    name: string;
    parameters: Record<string, unknown>;
    strict: false;
  };
  type: "function";
};

type ResolvedMcpTool = {
  publicName: string;
  remoteName: string;
  serverId: string;
  serverName: string;
  workspaceId: string;
};

type McpToolResult = {
  content: string;
  isError?: boolean;
};

export class McpInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "McpInputError";
  }
}

export class McpNotFoundError extends Error {
  constructor() {
    super("O servidor MCP ou a ferramenta selecionada não existe neste workspace.");
    this.name = "McpNotFoundError";
  }
}

export class McpConnectionError extends Error {
  constructor(
    readonly code: string,
    message = "Não foi possível conectar ao servidor MCP.",
  ) {
    super(message);
    this.name = "McpConnectionError";
  }
}

type ServerRow = typeof mcpServers.$inferSelect;
type ToolRow = typeof mcpTools.$inferSelect;
type SecretRow = typeof mcpServerSecrets.$inferSelect;

type OpenConnection = {
  client: Client;
  transport: Transport;
  transportKind: McpTransportKind;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function byteLength(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function jsonString(value: unknown, maximumBytes: number, errorCode: string): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new McpInputError(errorCode, "O conteúdo MCP não pode ser serializado com segurança.");
  }
  if (serialized === undefined || byteLength(serialized) > maximumBytes)
    throw new McpInputError(errorCode, "O conteúdo MCP excede o limite permitido.");
  return serialized;
}

function clippedUtf8(value: string, maximumBytes: number) {
  if (byteLength(value) <= maximumBytes) return value;
  return `${Buffer.from(value, "utf8")
    .subarray(0, Math.max(0, maximumBytes - 20))
    .toString("utf8")}\n[truncado]`;
}

function slug(value: string, maximumLength: number) {
  const normalized = value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximumLength);
  return normalized || "tool";
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, HASH_LENGTH);
}

/** O routing reverso depende sempre desta coluna, nunca do parsing do nome público. */
export function publicMcpToolName(serverSlug: string, serverId: string, remoteName: string) {
  return `mcp__${slug(serverSlug, PUBLIC_SERVER_SLUG_LENGTH)}_${shortHash(serverId)}__${slug(remoteName, PUBLIC_TOOL_SLUG_LENGTH)}_${shortHash(remoteName)}`;
}

function validateEnvironmentName(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))
    throw new McpInputError(
      "mcp_invalid_environment_name",
      "O nome da variável de ambiente MCP é inválido.",
    );
}

function bearerSecretRef(serverId: string) {
  return `mcp:${serverId}:bearer`;
}

function environmentSecretRef(serverId: string, name: string) {
  return `mcp:${serverId}:env:${name}`;
}

function parseMcpConfig(transport: string, configJson: string): McpServerConfig {
  try {
    const config = asObject(JSON.parse(configJson));
    if (!config) throw new Error("invalid config");
    if (transport === "stdio") {
      if (
        typeof config.command !== "string" ||
        !config.command ||
        !Array.isArray(config.args) ||
        config.args.some((item) => typeof item !== "string") ||
        (config.cwd !== "isolated" && config.cwd !== "workspace")
      )
        throw new Error("invalid stdio config");
      return { args: config.args, command: config.command, cwd: config.cwd };
    }
    if (transport === "streamable-http" && typeof config.url === "string")
      return { url: config.url };
  } catch {
    // A configuração só é criada por validateServerInput; não expor conteúdo corrompido.
  }
  throw new McpInputError("mcp_invalid_configuration", "A configuração MCP salva é inválida.");
}

function validateServerInput(input: McpServerInput) {
  const name = input.name.trim();
  if (!name || name.length > 120)
    throw new McpInputError(
      "mcp_invalid_name",
      "Informe um nome de servidor MCP de até 120 caracteres.",
    );
  if (input.transport !== "stdio" && input.transport !== "streamable-http")
    throw new McpInputError(
      "mcp_invalid_transport",
      "O transporte MCP selecionado não é suportado.",
    );
  if (!asObject(input.config))
    throw new McpInputError("mcp_invalid_configuration", "A configuração MCP é inválida.");
  if (input.transport === "stdio") {
    const config = input.config as StdioMcpConfig;
    if (
      typeof config.command !== "string" ||
      !config.command.trim() ||
      config.command.includes("\0") ||
      !Array.isArray(config.args) ||
      config.args.some((argument) => typeof argument !== "string" || argument.includes("\0")) ||
      (config.cwd !== "isolated" && config.cwd !== "workspace")
    )
      throw new McpInputError("mcp_invalid_stdio", "A configuração stdio MCP é inválida.");
    if (config.cwd === "workspace" && !input.shareWorkspaceRoot)
      throw new McpInputError(
        "mcp_workspace_root_not_shared",
        "Compartilhe a pasta do workspace antes de usá-la como diretório do servidor MCP.",
      );
    return {
      args: [...config.args],
      command: config.command.trim(),
      cwd: config.cwd,
    } satisfies StdioMcpConfig;
  }
  const config = input.config as StreamableHttpMcpConfig;
  if (typeof config.url !== "string" || !config.url.trim())
    throw new McpInputError("mcp_invalid_url", "A URL Streamable HTTP MCP é inválida.");
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw new McpInputError("mcp_invalid_url", "A URL Streamable HTTP MCP é inválida.");
  }
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:"))
    throw new McpInputError("mcp_invalid_url", "A URL Streamable HTTP MCP não é permitida.");
  return { url: url.toString() } satisfies StreamableHttpMcpConfig;
}

function isLoopbackAddress(address: string) {
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("127.");
}

function isLinkLocalOrMetadataAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized === "169.254.169.254" || normalized.startsWith("169.254.")) return true;
  return (
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fe90:") ||
    normalized.startsWith("fea0:") ||
    normalized.startsWith("feb0:")
  );
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (normalized.startsWith("10.") || normalized.startsWith("192.168.")) return true;
  if (normalized.startsWith("172.")) {
    const octet = Number(normalized.split(".")[1]);
    if (octet >= 16 && octet <= 31) return true;
  }
  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

async function validateHttpEndpoint(url: URL, allowPrivateNetwork: boolean) {
  if (url.username || url.password || (url.protocol !== "https:" && url.protocol !== "http:"))
    throw new McpConnectionError("mcp_invalid_url", "A URL Streamable HTTP MCP não é permitida.");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const addresses = isIP(hostname)
    ? [hostname]
    : hostname === "localhost"
      ? ["127.0.0.1", "::1"]
      : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  if (!addresses.length) throw new McpConnectionError("mcp_unresolved_host");
  const loopback = addresses.every(isLoopbackAddress);
  if (url.protocol === "http:" && !loopback)
    throw new McpConnectionError(
      "mcp_https_required",
      "Use HTTPS fora de loopback para o servidor MCP.",
    );
  for (const address of addresses) {
    if (isLinkLocalOrMetadataAddress(address))
      throw new McpConnectionError("mcp_network_blocked", "O endpoint MCP não é permitido.");
    if (!isLoopbackAddress(address) && isPrivateAddress(address) && !allowPrivateNetwork)
      throw new McpConnectionError(
        "mcp_private_network_blocked",
        "Ative a rede privada somente para um servidor MCP confiável.",
      );
  }
}

function secureFetch(allowPrivateNetwork: boolean): FetchLike {
  return async (input, init) => {
    const url = input instanceof URL ? input : new URL(input);
    await validateHttpEndpoint(url, allowPrivateNetwork);
    const response = await fetch(input, { ...init, redirect: "manual" });
    // Não seguir redirect silenciosamente evita DNS rebinding e troca de origem.
    if (response.status >= 300 && response.status < 400)
      throw new McpConnectionError(
        "mcp_redirect_blocked",
        "O redirecionamento do servidor MCP foi bloqueado.",
      );
    return response;
  };
}

function sanitizeSchema(value: unknown): { errorCode?: string; schema: Record<string, unknown> } {
  if (!asObject(value)) return { schema: {} };
  const seen = new WeakSet<object>();
  const visit = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== "object") return candidate;
    if (seen.has(candidate))
      throw new McpInputError("mcp_schema_unsupported", "Schema MCP recursivo.");
    seen.add(candidate);
    if (Array.isArray(candidate)) return candidate.map(visit);
    const object: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(candidate)) {
      if (key === "$schema" || key === "title") continue;
      // $ref pode criar recursão e exigir resolução externa; ambos ficam fora desta fase.
      if (key === "$ref")
        throw new McpInputError("mcp_schema_unsupported", "Schema MCP não suportado.");
      object[key] = visit(item);
    }
    return object;
  };
  try {
    const schema = asObject(visit(value));
    if (!schema) return { schema: {} };
    jsonString(schema, MAX_TOOL_SCHEMA_BYTES, "mcp_schema_unsupported");
    return { schema };
  } catch (error) {
    if (error instanceof McpInputError) return { errorCode: "mcp_schema_unsupported", schema: {} };
    return { errorCode: "mcp_schema_unsupported", schema: {} };
  }
}

function parseToolSchema(row: ToolRow): Record<string, unknown> {
  try {
    const value = JSON.parse(row.inputSchema);
    return asObject(value) ?? {};
  } catch {
    return {};
  }
}

function toolView(row: ToolRow): McpToolView {
  return {
    description: row.description,
    discoveredAt: row.discoveredAt,
    enabled: row.enabled,
    errorCode: row.errorCode,
    inputSchema: parseToolSchema(row),
    publicName: row.publicName,
    remoteName: row.remoteName,
    state: row.state as McpToolState,
  };
}

function serverView(row: ServerRow, secrets: SecretRow[], tools: ToolRow[]): McpServerView {
  return {
    allowPrivateNetwork: row.allowPrivateNetwork,
    config: parseMcpConfig(row.transport, row.configJson),
    enabled: row.enabled,
    envNames: secrets
      .filter((secret) => secret.kind === "env")
      .map((secret) => secret.name)
      .sort(),
    errorCode: row.errorCode,
    hasBearer: secrets.some((secret) => secret.kind === "bearer"),
    id: row.id,
    name: row.name,
    shareWorkspaceRoot: row.shareWorkspaceRoot,
    slug: row.slug,
    state: row.state as McpServerState,
    tools: tools.map(toolView),
    transport: row.transport as McpTransportKind,
    workspaceId: row.workspaceId,
  };
}

function workspaceExists(workspaceId: string, storageDirectory: string) {
  const database = openSharedDatabase(storageDirectory);
  try {
    return database.db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
  } finally {
    database.close();
  }
}

function serverForWorkspace(workspaceId: string, serverId: string, storageDirectory: string) {
  const database = openSharedDatabase(storageDirectory);
  try {
    return database.db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .get();
  } finally {
    database.close();
  }
}

function uniqueSlug(
  workspaceId: string,
  name: string,
  currentId: string | undefined,
  storageDirectory: string,
) {
  const base = slug(name, PUBLIC_SERVER_SLUG_LENGTH);
  const database = openSharedDatabase(storageDirectory);
  try {
    const taken = new Set(
      database.db
        .select({ id: mcpServers.id, slug: mcpServers.slug })
        .from(mcpServers)
        .where(eq(mcpServers.workspaceId, workspaceId))
        .all()
        .filter((row) => row.id !== currentId)
        .map((row) => row.slug),
    );
    if (!taken.has(base)) return base;
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${base.slice(0, Math.max(1, PUBLIC_SERVER_SLUG_LENGTH - String(index).length - 1))}-${index}`;
      if (!taken.has(candidate)) return candidate;
    }
  } finally {
    database.close();
  }
  throw new McpInputError(
    "mcp_invalid_name",
    "Não foi possível criar um identificador único para o servidor MCP.",
  );
}

async function upsertSecretMetadata(
  serverId: string,
  kind: "bearer" | "env",
  name: string,
  storageDirectory: string,
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const now = Date.now();
    const secretRef =
      kind === "bearer" ? bearerSecretRef(serverId) : environmentSecretRef(serverId, name);
    database.db
      .insert(mcpServerSecrets)
      .values({ createdAt: now, id: randomUUID(), kind, name, secretRef, serverId, updatedAt: now })
      .onConflictDoUpdate({
        set: { secretRef, updatedAt: now },
        target: [mcpServerSecrets.serverId, mcpServerSecrets.kind, mcpServerSecrets.name],
      })
      .run();
    return secretRef;
  } finally {
    database.close();
  }
}

async function removeSecretMetadata(
  serverId: string,
  kind: "bearer" | "env",
  name: string,
  storageDirectory: string,
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const secret = database.db
      .select()
      .from(mcpServerSecrets)
      .where(
        and(
          eq(mcpServerSecrets.serverId, serverId),
          eq(mcpServerSecrets.kind, kind),
          eq(mcpServerSecrets.name, name),
        ),
      )
      .get();
    if (secret)
      database.db.delete(mcpServerSecrets).where(eq(mcpServerSecrets.id, secret.id)).run();
    return secret?.secretRef;
  } finally {
    database.close();
  }
}

export function listMcpServers(
  workspaceId: string,
  storageDirectory = dataDirectory(),
): McpServerView[] {
  const database = openSharedDatabase(storageDirectory);
  try {
    const servers = database.db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.workspaceId, workspaceId))
      .all();
    const ids = servers.map((server) => server.id);
    const secrets = ids.length
      ? database.db
          .select()
          .from(mcpServerSecrets)
          .where(inArray(mcpServerSecrets.serverId, ids))
          .all()
      : [];
    const tools = ids.length
      ? database.db.select().from(mcpTools).where(inArray(mcpTools.serverId, ids)).all()
      : [];
    return servers.map((server) =>
      serverView(
        server,
        secrets.filter((secret) => secret.serverId === server.id),
        tools
          .filter((tool) => tool.serverId === server.id)
          .sort((left, right) => left.remoteName.localeCompare(right.remoteName)),
      ),
    );
  } finally {
    database.close();
  }
}

export async function saveMcpServer(
  workspaceId: string,
  input: McpServerInput,
  storageDirectory = dataDirectory(),
): Promise<McpServerView> {
  if (!workspaceExists(workspaceId, storageDirectory)) throw new McpNotFoundError();
  const config = validateServerInput(input);
  const existing = input.id
    ? serverForWorkspace(workspaceId, input.id, storageDirectory)
    : undefined;
  if (input.id && !existing) throw new McpNotFoundError();
  const id = existing?.id ?? randomUUID();
  if (!existing) {
    const database = openSharedDatabase(storageDirectory);
    try {
      const count = database.db
        .select({ count: mcpServers.id })
        .from(mcpServers)
        .where(eq(mcpServers.workspaceId, workspaceId))
        .all().length;
      if (count >= MAX_ENABLED_SERVERS)
        throw new McpInputError(
          "mcp_server_limit",
          "Cada workspace aceita no máximo 16 servidores MCP.",
        );
    } finally {
      database.close();
    }
  }
  const now = Date.now();
  const nextSlug =
    existing?.slug ?? uniqueSlug(workspaceId, input.name.trim(), id, storageDirectory);
  const database = openSharedDatabase(storageDirectory);
  try {
    const values = {
      allowPrivateNetwork: Boolean(input.allowPrivateNetwork),
      configJson: jsonString(config, 64 * 1024, "mcp_invalid_configuration"),
      enabled: false,
      errorCode: null,
      id,
      name: input.name.trim(),
      shareWorkspaceRoot: Boolean(input.shareWorkspaceRoot),
      slug: nextSlug,
      state: "disabled",
      transport: input.transport,
      updatedAt: now,
      workspaceId,
    };
    if (existing) database.db.update(mcpServers).set(values).where(eq(mcpServers.id, id)).run();
    else
      database.db
        .insert(mcpServers)
        .values({ ...values, createdAt: now })
        .run();
  } finally {
    database.close();
  }
  if (input.bearer !== undefined) {
    if (input.bearer) {
      const ref = await upsertSecretMetadata(id, "bearer", "", storageDirectory);
      await encryptSecret(storageDirectory, ref, input.bearer);
    } else {
      const ref = await removeSecretMetadata(id, "bearer", "", storageDirectory);
      if (ref) await removeSecret(storageDirectory, ref);
    }
  }
  for (const [name, value] of Object.entries(input.environment ?? {})) {
    validateEnvironmentName(name);
    if (value) {
      const ref = await upsertSecretMetadata(id, "env", name, storageDirectory);
      await encryptSecret(storageDirectory, ref, value);
    } else {
      const ref = await removeSecretMetadata(id, "env", name, storageDirectory);
      if (ref) await removeSecret(storageDirectory, ref);
    }
  }
  const saved = listMcpServers(workspaceId, storageDirectory).find((server) => server.id === id);
  if (!saved) throw new McpNotFoundError();
  return saved;
}

export async function removeMcpServer(
  workspaceId: string,
  serverId: string,
  storageDirectory = dataDirectory(),
) {
  const database = openSharedDatabase(storageDirectory);
  let secrets: SecretRow[] = [];
  try {
    const server = database.db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .get();
    if (!server) throw new McpNotFoundError();
    secrets = database.db
      .select()
      .from(mcpServerSecrets)
      .where(eq(mcpServerSecrets.serverId, serverId))
      .all();
    database.db.delete(mcpServers).where(eq(mcpServers.id, serverId)).run();
  } finally {
    database.close();
  }
  await Promise.all(secrets.map((secret) => removeSecret(storageDirectory, secret.secretRef)));
}

export function setMcpServerEnabled(
  workspaceId: string,
  serverId: string,
  enabled: boolean,
  storageDirectory = dataDirectory(),
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const server = database.db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .get();
    if (!server) throw new McpNotFoundError();
    if (enabled && server.state !== "ready")
      throw new McpInputError("mcp_test_required", "Teste o servidor MCP antes de habilitá-lo.");
    database.db
      .update(mcpServers)
      .set({ enabled, state: enabled ? "ready" : "disabled", updatedAt: Date.now() })
      .where(eq(mcpServers.id, serverId))
      .run();
  } finally {
    database.close();
  }
  const saved = listMcpServers(workspaceId, storageDirectory).find(
    (server) => server.id === serverId,
  );
  if (!saved) throw new McpNotFoundError();
  return saved;
}

export function setMcpToolsEnabled(
  workspaceId: string,
  serverId: string,
  publicNames: string[],
  storageDirectory = dataDirectory(),
) {
  if (!Array.isArray(publicNames) || publicNames.some((name) => typeof name !== "string"))
    throw new McpInputError("mcp_invalid_tools", "A lista de ferramentas MCP é inválida.");
  const requested = new Set(publicNames);
  const database = openSharedDatabase(storageDirectory);
  try {
    const server = database.db
      .select()
      .from(mcpServers)
      .where(and(eq(mcpServers.id, serverId), eq(mcpServers.workspaceId, workspaceId)))
      .get();
    if (!server) throw new McpNotFoundError();
    if (server.state !== "ready")
      throw new McpInputError(
        "mcp_test_required",
        "Teste o servidor MCP antes de habilitar ferramentas.",
      );
    const serverTools = database.db
      .select()
      .from(mcpTools)
      .where(eq(mcpTools.serverId, serverId))
      .all();
    const permitted = new Set(
      serverTools.filter((tool) => tool.state === "ready").map((tool) => tool.publicName),
    );
    if ([...requested].some((name) => !permitted.has(name)))
      throw new McpInputError(
        "mcp_unknown_tool",
        "Uma ferramenta MCP não pertence ao catálogo testado.",
      );
    const enabledOutsideServer =
      database.db
        .select({ enabled: mcpTools.enabled })
        .from(mcpTools)
        .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
        .where(and(eq(mcpServers.workspaceId, workspaceId), eq(mcpTools.enabled, true)))
        .all()
        .filter((tool) => tool.enabled).length - serverTools.filter((tool) => tool.enabled).length;
    if (enabledOutsideServer + requested.size > MAX_ENABLED_TOOLS)
      throw new McpInputError(
        "mcp_tool_limit",
        "Cada workspace aceita no máximo 64 ferramentas MCP habilitadas.",
      );
    const now = Date.now();
    for (const tool of serverTools) {
      database.db
        .update(mcpTools)
        .set({ enabled: tool.state === "ready" && requested.has(tool.publicName), updatedAt: now })
        .where(eq(mcpTools.id, tool.id))
        .run();
    }
  } finally {
    database.close();
  }
  const saved = listMcpServers(workspaceId, storageDirectory).find(
    (server) => server.id === serverId,
  );
  if (!saved) throw new McpNotFoundError();
  return saved;
}

export function enabledMcpToolDefinitions(
  workspaceId: string,
  storageDirectory = dataDirectory(),
): McpToolDefinition[] {
  const database = openSharedDatabase(storageDirectory);
  try {
    const rows = database.db
      .select({ server: mcpServers, tool: mcpTools })
      .from(mcpTools)
      .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
      .where(
        and(
          eq(mcpServers.workspaceId, workspaceId),
          eq(mcpServers.enabled, true),
          eq(mcpServers.state, "ready"),
          eq(mcpTools.enabled, true),
          eq(mcpTools.state, "ready"),
        ),
      )
      .all();
    return rows.map(({ tool }) => ({
      function: {
        description: tool.description,
        name: tool.publicName,
        parameters: parseToolSchema(tool),
        strict: false,
      },
      type: "function",
    }));
  } finally {
    database.close();
  }
}

export function resolveEnabledMcpTool(
  workspaceId: string,
  publicName: string,
  storageDirectory = dataDirectory(),
): ResolvedMcpTool | null {
  const database = openSharedDatabase(storageDirectory);
  try {
    const row = database.db
      .select({ server: mcpServers, tool: mcpTools })
      .from(mcpTools)
      .innerJoin(mcpServers, eq(mcpTools.serverId, mcpServers.id))
      .where(
        and(
          eq(mcpServers.workspaceId, workspaceId),
          eq(mcpServers.enabled, true),
          eq(mcpServers.state, "ready"),
          eq(mcpTools.enabled, true),
          eq(mcpTools.state, "ready"),
          eq(mcpTools.publicName, publicName),
        ),
      )
      .get();
    return row
      ? {
          publicName: row.tool.publicName,
          remoteName: row.tool.remoteName,
          serverId: row.server.id,
          serverName: row.server.name,
          workspaceId: row.server.workspaceId,
        }
      : null;
  } finally {
    database.close();
  }
}

function connectionFailureCode(error: unknown) {
  if (error instanceof McpConnectionError) return error.code;
  if (typeof error === "object" && error && "status" in error && Number(error.status) === 401)
    return "mcp_auth_required";
  const message = error instanceof Error ? error.message : "";
  return /\b401\b|unauthori[sz]ed/i.test(message) ? "mcp_auth_required" : "mcp_connection_failed";
}

function normalizeMcpResult(result: unknown): McpToolResult {
  const root = asObject(result) ?? {};
  const chunks: string[] = [];
  const content = Array.isArray(root.content) ? root.content : [];
  for (const item of content) {
    const block = asObject(item);
    if (!block || typeof block.type !== "string") continue;
    if (block.type === "text" && typeof block.text === "string") chunks.push(block.text);
    else if (block.type === "image" || block.type === "audio" || block.type === "resource")
      chunks.push(`[conteúdo ${block.type} omitido]`);
    else if (block.type === "resource_link") chunks.push("[link de recurso não aberto]");
    else chunks.push(`[conteúdo MCP ${block.type} omitido]`);
  }
  if (root.structuredContent !== undefined) {
    try {
      chunks.push(JSON.stringify(root.structuredContent));
    } catch {
      chunks.push("[conteúdo estruturado MCP indisponível]");
    }
  }
  return {
    content: clippedUtf8(
      chunks.join("\n") || "[servidor MCP não retornou conteúdo]",
      MAX_TOOL_RESULT_BYTES,
    ),
    ...(root.isError === true ? { isError: true } : {}),
  };
}

/** Mantém conexões MCP sob demanda, uma por servidor, sem logs de payload. */
export class McpClientManager {
  #connections = new Map<string, OpenConnection>();

  constructor(
    readonly storageDirectory = dataDirectory(),
    readonly onToolsUpdated: (event: {
      count: number;
      serverId: string;
      workspaceId: string;
    }) => void = () => undefined,
  ) {}

  async saveServer(workspaceId: string, input: McpServerInput) {
    if (input.id) await this.disconnect(input.id);
    return saveMcpServer(workspaceId, input, this.storageDirectory);
  }

  async removeServer(workspaceId: string, serverId: string) {
    await this.disconnect(serverId);
    return removeMcpServer(workspaceId, serverId, this.storageDirectory);
  }

  async disconnect(serverId: string) {
    const connection = this.#connections.get(serverId);
    this.#connections.delete(serverId);
    if (!connection) {
      this.setServerState(serverId, "disconnected", null);
      return;
    }
    try {
      if (connection.transportKind === "streamable-http")
        await (connection.transport as StreamableHTTPClientTransport)
          .terminateSession()
          .catch(() => undefined);
      await connection.client.close();
    } catch {
      // O servidor remoto não controla o ciclo de vida local.
    }
    this.setServerState(serverId, "disconnected", null);
  }

  async closeAll() {
    await Promise.all([...this.#connections.keys()].map((serverId) => this.disconnect(serverId)));
  }

  async testServer(workspaceId: string, serverId: string) {
    const server = serverForWorkspace(workspaceId, serverId, this.storageDirectory);
    if (!server) throw new McpNotFoundError();
    const connection = await this.connect(server);
    const listed = await connection.client.listTools(undefined, {
      cacheMode: "refresh",
      timeout: MCP_TIMEOUT_MS,
    });
    const count = this.persistCatalog(server, listed.tools ?? []);
    this.onToolsUpdated({ count, serverId: server.id, workspaceId: server.workspaceId });
    const view = listMcpServers(workspaceId, this.storageDirectory).find(
      (item) => item.id === serverId,
    );
    if (!view) throw new McpNotFoundError();
    return view;
  }

  async callTool(
    resolved: ResolvedMcpTool,
    arguments_: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    jsonString(arguments_, MAX_TOOL_ARGUMENT_BYTES, "mcp_arguments_too_large");
    // Commit point: relê o registro persistido antes de qualquer conexão/chamada remota.
    const fresh = resolveEnabledMcpTool(
      resolved.workspaceId,
      resolved.publicName,
      this.storageDirectory,
    );
    if (!fresh || fresh.serverId !== resolved.serverId || fresh.remoteName !== resolved.remoteName)
      throw new McpConnectionError(
        "mcp_tool_disabled",
        "A ferramenta MCP foi desabilitada antes da execução.",
      );
    const server = serverForWorkspace(fresh.workspaceId, fresh.serverId, this.storageDirectory);
    if (!server) throw new McpNotFoundError();
    try {
      const connection = await this.connect(server);
      const result = await connection.client.callTool(
        { arguments: arguments_, name: fresh.remoteName },
        { signal, timeout: MCP_TIMEOUT_MS },
      );
      return normalizeMcpResult(result);
    } catch (error) {
      if (signal?.aborted || /timeout|timed out|connection|socket/i.test(String(error)))
        await this.disconnect(fresh.serverId);
      const code = connectionFailureCode(error);
      if (code === "mcp_auth_required")
        throw new McpConnectionError(code, "O servidor MCP exige credenciais válidas.");
      if (error instanceof McpConnectionError) throw error;
      throw new McpConnectionError(code);
    }
  }

  private async connect(server: ServerRow): Promise<OpenConnection> {
    const existing = this.#connections.get(server.id);
    if (existing) return existing;
    this.setServerState(server.id, "connecting", null);
    try {
      const config = parseMcpConfig(server.transport, server.configJson);
      const client = new Client(
        { name: "Blackwall", version: "0.1.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      client.setNotificationHandler("notifications/tools/list_changed", () =>
        this.refreshCatalog(server.id).catch(() => undefined),
      );
      const transport = await this.createTransport(server, config);
      transport.onclose = () => {
        if (this.#connections.get(server.id)?.transport === transport) {
          this.#connections.delete(server.id);
          this.setServerState(server.id, "disconnected", null);
        }
      };
      await client.connect(transport, { timeout: MCP_TIMEOUT_MS });
      const connection: OpenConnection = {
        client,
        transport,
        transportKind: server.transport as McpTransportKind,
      };
      this.#connections.set(server.id, connection);
      this.setServerState(server.id, "ready", null);
      return connection;
    } catch (error) {
      await this.disconnect(server.id);
      const code = connectionFailureCode(error);
      this.setServerState(server.id, "error", code);
      if (code === "mcp_auth_required")
        throw new McpConnectionError(code, "O servidor MCP exige credenciais válidas.");
      if (error instanceof McpConnectionError) throw error;
      throw new McpConnectionError(code);
    }
  }

  private async createTransport(server: ServerRow, config: McpServerConfig): Promise<Transport> {
    if (server.transport === "stdio") {
      const stdio = config as StdioMcpConfig;
      const environment = { ...getDefaultEnvironment() };
      const database = openSharedDatabase(this.storageDirectory);
      let secrets: SecretRow[] = [];
      try {
        secrets = database.db
          .select()
          .from(mcpServerSecrets)
          .where(and(eq(mcpServerSecrets.serverId, server.id), eq(mcpServerSecrets.kind, "env")))
          .all();
      } finally {
        database.close();
      }
      for (const secret of secrets) {
        validateEnvironmentName(secret.name);
        environment[secret.name] = await decryptSecret(this.storageDirectory, secret.secretRef);
      }
      let cwd: string;
      if (stdio.cwd === "workspace") {
        if (!server.shareWorkspaceRoot)
          throw new McpConnectionError(
            "mcp_workspace_root_not_shared",
            "A pasta do workspace não foi compartilhada.",
          );
        const workspace = workspaceExists(server.workspaceId, this.storageDirectory);
        if (!workspace) throw new McpNotFoundError();
        const database = openSharedDatabase(this.storageDirectory);
        try {
          const row = database.db
            .select()
            .from(workspaces)
            .where(eq(workspaces.id, server.workspaceId))
            .get();
          if (!row) throw new McpNotFoundError();
          cwd = await realpath(row.rootPath);
        } finally {
          database.close();
        }
      } else {
        cwd = join(this.storageDirectory, "mcp", server.id);
        await mkdir(cwd, { recursive: true, mode: 0o700 });
      }
      return new StdioClientTransport({
        args: stdio.args,
        command: stdio.command,
        cwd,
        env: environment,
        stderr: "ignore",
      });
    }
    const http = config as StreamableHttpMcpConfig;
    const url = new URL(http.url);
    await validateHttpEndpoint(url, server.allowPrivateNetwork);
    const database = openSharedDatabase(this.storageDirectory);
    let bearer: SecretRow | undefined;
    try {
      bearer = database.db
        .select()
        .from(mcpServerSecrets)
        .where(and(eq(mcpServerSecrets.serverId, server.id), eq(mcpServerSecrets.kind, "bearer")))
        .get();
    } finally {
      database.close();
    }
    return new StreamableHTTPClientTransport(url, {
      authProvider: bearer
        ? { token: async () => decryptSecret(this.storageDirectory, bearer.secretRef) }
        : undefined,
      fetch: secureFetch(server.allowPrivateNetwork),
      onInsufficientScope: "throw",
    });
  }

  private async refreshCatalog(serverId: string) {
    const database = openSharedDatabase(this.storageDirectory);
    let server: ServerRow | undefined;
    try {
      server = database.db.select().from(mcpServers).where(eq(mcpServers.id, serverId)).get();
    } finally {
      database.close();
    }
    if (!server) return;
    const connection = await this.connect(server);
    const listed = await connection.client.listTools(undefined, {
      cacheMode: "refresh",
      timeout: MCP_TIMEOUT_MS,
    });
    const count = this.persistCatalog(server, listed.tools ?? []);
    this.onToolsUpdated({ count, serverId: server.id, workspaceId: server.workspaceId });
  }

  private persistCatalog(server: ServerRow, remoteTools: RemoteTool[]) {
    const database = openSharedDatabase(this.storageDirectory);
    try {
      const existing = database.db
        .select()
        .from(mcpTools)
        .where(eq(mcpTools.serverId, server.id))
        .all();
      const byRemoteName = new Map(existing.map((tool) => [tool.remoteName, tool]));
      const seen = new Set<string>();
      const now = Date.now();
      for (const remoteTool of remoteTools) {
        if (!remoteTool || typeof remoteTool.name !== "string" || !remoteTool.name.trim()) continue;
        const remoteName = remoteTool.name.trim();
        seen.add(remoteName);
        const schema = sanitizeSchema(remoteTool.inputSchema);
        const previous = byRemoteName.get(remoteName);
        const state: McpToolState = schema.errorCode ? "unsupported" : "ready";
        const values = {
          description:
            typeof remoteTool.description === "string"
              ? remoteTool.description.slice(0, MAX_TOOL_DESCRIPTION_CHARS)
              : "",
          discoveredAt: now,
          enabled: state === "ready" ? (previous?.enabled ?? false) : false,
          errorCode: schema.errorCode ?? null,
          inputSchema: jsonString(schema.schema, MAX_TOOL_SCHEMA_BYTES, "mcp_schema_unsupported"),
          publicName: publicMcpToolName(server.slug, server.id, remoteName),
          remoteName,
          state,
          updatedAt: now,
        };
        if (previous)
          database.db.update(mcpTools).set(values).where(eq(mcpTools.id, previous.id)).run();
        else
          database.db
            .insert(mcpTools)
            .values({ ...values, createdAt: now, id: randomUUID(), serverId: server.id })
            .run();
      }
      for (const removed of existing.filter((tool) => !seen.has(tool.remoteName))) {
        database.db
          .update(mcpTools)
          .set({ enabled: false, errorCode: null, state: "removed", updatedAt: now })
          .where(eq(mcpTools.id, removed.id))
          .run();
      }
      database.db
        .update(mcpServers)
        .set({ errorCode: null, state: "ready", updatedAt: now })
        .where(eq(mcpServers.id, server.id))
        .run();
      return remoteTools.length;
    } finally {
      database.close();
    }
  }

  private setServerState(serverId: string, state: McpServerState, errorCode: string | null) {
    const database = openSharedDatabase(this.storageDirectory);
    try {
      database.db
        .update(mcpServers)
        .set({ errorCode, state, updatedAt: Date.now() })
        .where(eq(mcpServers.id, serverId))
        .run();
    } finally {
      database.close();
    }
  }
}

export async function mcpHasSecret(
  serverId: string,
  kind: "bearer" | "env",
  name = "",
  storageDirectory = dataDirectory(),
) {
  const database = openSharedDatabase(storageDirectory);
  try {
    const row = database.db
      .select()
      .from(mcpServerSecrets)
      .where(
        and(
          eq(mcpServerSecrets.serverId, serverId),
          eq(mcpServerSecrets.kind, kind),
          eq(mcpServerSecrets.name, name),
        ),
      )
      .get();
    return row ? hasSecret(storageDirectory, row.secretRef) : false;
  } finally {
    database.close();
  }
}

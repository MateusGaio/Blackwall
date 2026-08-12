// MIT License — Copyright (c) 2026 Mateus Gaio
import { sidecarUrl } from "../../platform/runtime";

export type ConnectedProvider = {
  baseUrl: string;
  id: string;
  model: string;
  name: string;
  type: "openai-compatible" | "ollama";
};

export type Profile = {
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

export type Session = {
  id: string;
  selectedModel: string | null;
  selectedProviderId: string | null;
  title: string;
  updatedAt: number;
  workspaceId: string;
};

export type StoredMessage = ChatMessage & {
  createdAt: number;
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
  sessions: Session[];
  workspaces: Workspace[];
};

type BootstrapInput = {
  locale: string;
  permissionMode?: "ask" | "automatic" | "read-only";
  profileName: string;
  profileSoul: string;
  workspaceName: string;
  workspaceRootPath: string;
  workspaceSoul: string;
};

type ProviderInput = Omit<ConnectedProvider, "id" | "type"> & {
  apiKey?: string;
  type?: ConnectedProvider["type"];
};
export type ChatMessage = { content: string; id: string; role: "assistant" | "user" };

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const baseUrl = await sidecarUrl();
  if (!baseUrl) {
    throw new Error("Abra o Blackwall pelo app desktop para conectar um provedor local.");
  }
  const response = await fetch(`${baseUrl}${path}`, init);
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

export type ProviderModel = {
  capabilities: string[];
  id: string;
  name: string;
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

export async function bootstrapApp(input: BootstrapInput): Promise<AppState> {
  return request("/v1/bootstrap", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function listProviders(): Promise<ConnectedProvider[]> {
  const response = await request<{ providers: ConnectedProvider[] }>("/v1/providers", {
    method: "GET",
  });
  return response.providers;
}

export async function createSession(workspaceId: string, title?: string): Promise<Session> {
  const response = await request<{ session: Session }>("/v1/sessions", {
    body: JSON.stringify({ title, workspaceId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.session;
}

export async function selectSession(sessionId: string): Promise<AppState> {
  return request(`/v1/sessions/${sessionId}/select`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function persistMessage(
  sessionId: string,
  message: {
    content: string;
    model?: string | null;
    providerId?: string | null;
    role: StoredMessage["role"];
    status?: string;
  },
): Promise<StoredMessage> {
  const response = await request<{ message: StoredMessage }>(`/v1/sessions/${sessionId}/messages`, {
    body: JSON.stringify(message),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return response.message;
}

export async function sendMessage(
  providerId: string,
  messages: ChatMessage[],
  model?: string,
): Promise<{ content: string; provider: ConnectedProvider }> {
  return request("/v1/chat/completions", {
    body: JSON.stringify({
      messages: messages.map(({ content, role }) => ({ content, role })),
      model,
      providerId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

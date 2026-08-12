// MIT License — Copyright (c) 2026 Mateus Gaio
import { sidecarUrl } from "../../platform/runtime";

export type ConnectedProvider = {
  baseUrl: string;
  id: string;
  model: string;
  name: string;
};

type ProviderInput = Omit<ConnectedProvider, "id"> & { apiKey: string };
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

export async function sendMessage(
  providerId: string,
  messages: ChatMessage[],
): Promise<{ content: string; provider: ConnectedProvider }> {
  return request("/v1/chat/completions", {
    body: JSON.stringify({
      messages: messages.map(({ content, role }) => ({ content, role })),
      providerId,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

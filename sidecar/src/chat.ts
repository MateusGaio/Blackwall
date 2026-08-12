// MIT License — Copyright (c) 2026 Mateus Gaio

import { withInstrumentation } from "./observability.js";
import { getProvider, type Provider, providerApiKey } from "./providers.js";

export type ChatMessage = { content: string; role: "assistant" | "user" };
type FetchLike = typeof fetch;

export async function sendChatMessage(
  providerId: string,
  messages: ChatMessage[],
  request: FetchLike = fetch,
): Promise<{ content: string; provider: Provider }> {
  const provider = await getProvider(providerId);
  const apiKey = await providerApiKey(providerId);
  const response = await withInstrumentation("provider.chat", () =>
    request(`${provider.baseUrl}/chat/completions`, {
      body: JSON.stringify({ messages, model: provider.model, stream: false }),
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      `Não foi possível obter resposta (HTTP ${response.status}). Revise o provedor ou tente novamente.`,
    );
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content?.trim();
  if (!content)
    throw new Error("O provedor não retornou uma mensagem utilizável. Tente outro modelo.");
  return { content, provider };
}

// MIT License — Copyright (c) 2026 Mateus Gaio
//
// Diagnóstico único: descobre se o endpoint da OpenCode Zen devolve
// prompt caching (cached_tokens) para o EXATO formato de requisição que o
// Blackwall já gera em produção (mesmo adapter, mesmo chatRequest()).
//
// Roda só na máquina onde o Blackwall real está instalado (usa a chave
// decifrada de ~/.blackwall). Não expõe a chave em nenhum log.
//
// Uso:
//   cd Blackwall
//   npx tsx scripts/diagnose-zen-cache.ts            # autodetecta o provider Zen
//   npx tsx scripts/diagnose-zen-cache.ts <providerId>  # força um provider específico

import { createProviderAdapter, listProviders, providerApiKey } from "../sidecar/src/providers.js";

type UsagePayload = {
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
  };
};

function extractUsageFromSse(rawText: string): UsagePayload["usage"] | undefined {
  for (const line of rawText.split("\n")) {
    const trimmed = line.replace(/^data:\s*/, "").trim();
    if (!trimmed || trimmed === "[DONE]") continue;
    try {
      const parsed = JSON.parse(trimmed) as UsagePayload;
      if (parsed.usage) return parsed.usage;
    } catch {
      // linha não é um JSON completo (fragmento de outro evento) — ignora
    }
  }
  return undefined;
}

function printUsage(label: string, usage: UsagePayload["usage"] | undefined) {
  if (!usage) {
    console.log(`[${label}] nenhum campo "usage" encontrado na resposta.`);
    return;
  }
  const cached = usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens;
  console.log(
    `[${label}] prompt_tokens=${usage.prompt_tokens ?? "?"} completion_tokens=${
      usage.completion_tokens ?? "?"
    } total_tokens=${usage.total_tokens ?? "?"} cached_tokens=${cached ?? "(ausente)"}`,
  );
}

const FILLER_SYSTEM_PROMPT =
  "Você é o agente do Blackwall. Siga as instruções do repositório, do PRODUCT.md e do ARCHITECTURE.md antes de qualquer ação. " +
  "Explore o workspace com cautela, prefira ferramentas de leitura antes de qualquer escrita, e nunca encadeie comandos de shell com operadores como && ou |. ".repeat(
    40,
  );

async function main() {
  const requestedId = process.argv[2];
  const providers = await listProviders();
  const provider = requestedId
    ? providers.find((candidate) => candidate.id === requestedId)
    : providers.find((candidate) => {
        try {
          return new URL(candidate.baseUrl).hostname.endsWith("opencode.ai");
        } catch {
          return false;
        }
      });

  if (!provider) {
    console.error(
      "Não encontrei um provider da OpenCode Zen salvo. Rode com o id do provider como argumento:",
    );
    for (const candidate of providers) {
      console.error(`  ${candidate.id}  ${candidate.name}  ${candidate.baseUrl}`);
    }
    process.exit(1);
  }

  console.log(`Provider: ${provider.name} (${provider.baseUrl}), modelo: ${provider.model}`);
  const apiKey = await providerApiKey(provider.id);
  if (!apiKey) {
    console.error("Não consegui decifrar a chave desse provider neste diretório de dados.");
    process.exit(1);
  }

  const adapter = createProviderAdapter({ ...provider, apiKey });

  const baseMessages = [
    { role: "system", content: FILLER_SYSTEM_PROMPT },
    { role: "user", content: "Qual é a capital da França? Responda em uma palavra." },
  ];

  const growingMessages = [
    ...baseMessages,
    { role: "assistant", content: "Paris." },
    { role: "user", content: "E a capital da Alemanha?" },
  ];

  async function fire(label: string, messages: unknown[]) {
    const req = adapter.chatRequest(provider!.model, messages, undefined, {});
    const response = await fetch(req.endpoint, {
      body: req.body,
      headers: req.headers,
      method: req.method,
    });
    if (!response.ok) {
      console.log(`[${label}] HTTP ${response.status}: ${await response.text()}`);
      return;
    }
    const text = await response.text();
    printUsage(label, extractUsageFromSse(text));
  }

  console.log("\n--- Rodada 1: prefixo estável (system + primeira pergunta) ---");
  await fire("rodada 1", baseMessages);

  console.log("\n--- Rodada 2: EXATAMENTE o mesmo prefixo de novo (checa cache hit) ---");
  await fire("rodada 2", baseMessages);

  console.log("\n--- Rodada 3: mesmo prefixo + turno novo no final (simula conversa crescendo) ---");
  await fire("rodada 3", growingMessages);

  console.log(
    "\nSe 'cached_tokens' aparecer > 0 na rodada 2 ou 3, a Zen está cacheando o prefixo estável " +
      "mesmo com o formato de requisição que o Blackwall já usa. Se ficar sempre ausente/0, a Zen " +
      "não está aplicando cache pra esse modelo/formato — e o assunto de caching fica descartado de vez.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

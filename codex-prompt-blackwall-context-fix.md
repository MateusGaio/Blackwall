Objective:
Corrigir o rastreamento de uso de tokens e reduzir o consumo de contexto no sidecar do Blackwall (TypeScript, em sidecar/src/), implementando as Fases 0, 1, 2 e 4.1 de um plano já validado por análise direta deste código. Pare antes da Fase 3 (resumo automático) e não toque na Fase 5 — ambas fora de escopo nesta sessão.

Starting State:
Repo Node/TypeScript. package.json na raiz tem "test": "vitest run". Comandos disponíveis: `npm test` (suíte inteira), `npx vitest run <arquivo>` (arquivo específico), `npm run check` (lint + knip + depcruise + test — rodar só ao final de tudo, não a cada fase).

Arquivos relevantes e seu estado atual, verbatim:

1) sidecar/src/providers.ts — classe OpenAICompatibleProvider, método chatRequest, branch Chat Completions:
```ts
const body: Record<string, unknown> = { messages, model, stream: true };
if ((options.toolMode ?? "auto") === "auto" && options.tools?.length) {
  body.tool_choice = "auto";
  body.tools = toOpenAIChatTools(options.tools);
  body.parallel_tool_calls = false;
  if (isOpenRouter(this.provider.baseUrl)) body.provider = { require_parameters: true };
}
```

2) sidecar/src/streaming.ts — função parseLine, dentro do branch `if (protocol === "openai-responses")`: trata `response.output_text.delta`, `response.function_call_arguments.delta`, `response.function_call_arguments.done` / `response.output_item.done`, `response.output_item.added`, e um fallback `if (Array.isArray(body.output))`. O branch termina em `return null;` sem nunca tratar `response.completed` (evento que carrega `response.usage` na Responses API da OpenAI). `normalizeTokenUsage` já está importado de `./usage.js` e é usado no branch Chat Completions/Ollama mais abaixo na mesma função.

3) sidecar/src/index.ts — dentro de `executeChat`:
   a) construção de `storedMessages`:
   ```ts
   const storedMessages = input.sessionId
     ? store.listMessages(input.sessionId).map((message) => ({
         content: message.content,
         name: message.toolName ?? undefined,
         role: message.role as ChatMessage["role"],
         toolCallId: message.toolCallId ?? undefined,
         toolCalls: message.toolCalls,
       }))
     : input.messages;
   ```
   b) backoff entre candidatos, no catch externo do loop de streaming:
   ```ts
   await new Promise((resolve) =>
     setTimeout(resolve, Math.min(2000, 250 * 2 ** candidates.indexOf(candidate))),
   );
   ```
   O erro capturado ali pode ser uma `ProviderRequestError` (definida em streaming.ts, `extends ProviderHttpError`) com propriedade `windows: UsageWindow[]`. `parseRateLimitHeaders` (usage.ts) já popula um window com `label: "retry-after"` e `resetAt` quando o header `retry-after` existe na resposta do provedor.

4) sidecar/src/streaming.ts — função `readStream`, dentro de `consume()`:
   ```ts
   const key = `index:${call.index}`;
   const current = calls.get(key);
   calls.set(key, {
     arguments: call.replaceArguments
       ? call.arguments
       : `${current?.arguments ?? ""}${call.arguments}`,
     id: current?.id ?? call.id,
     index: current?.index ?? call.index,
     name: current?.name ?? call.name,
   });
   ```

5) sidecar/src/db/migrations.ts — padrão de migração incremental já em uso: cada bloco é gated por `client.prepare("SELECT id FROM _migrations WHERE id = N").get()`, faz `ALTER TABLE ... ADD COLUMN` guardado por `PRAGMA table_info(<tabela>)`, e termina com `client.prepare("INSERT INTO _migrations (id, applied_at) VALUES (?, ?)").run(N, Date.now())`. O último id usado é 7 (bloco "usageTables"). O próximo id livre é 8. Ler o bloco id=6 (`providerCapabilities`, que adiciona colunas em `models`) antes de escrever o novo bloco — é o exemplo mais próximo do que você vai fazer.

Target State (o que deve existir ao final de cada fase):

FASE 0:
- providers.ts: o body do Chat Completions passa a incluir `stream_options: { include_usage: true }` sempre (não só quando toolMode auto com tools).
- streaming.ts: `parseLine` trata `response.completed` dentro do branch Responses, extraindo `body.response?.usage` e retornando `{ tokens: normalizeTokenUsage({ usage }) }` quando presente.
- index.ts: o backoff do catch externo usa o window `retry-after` do erro quando presente — `Math.max(delayMinimoAtual, resetAt - Date.now())` — mantendo o cálculo atual como piso quando não houver esse window.

FASE 1:
- Nova migração id=8 em migrations.ts adicionando `context_limit INTEGER` e `output_reserve INTEGER` à tabela `models`, replicando exatamente a sintaxe/guard do bloco id=6.
- db/schema.ts: tabela `models` ganha os dois campos (`contextLimit`/`outputReserve` na convenção camelCase já usada no arquivo).
- providers.ts: tipo `ProviderModel` ganha `contextLimit?: number` e `outputReserve?: number`. `OpenAICompatibleProvider.listModels` captura `model.context_length` do payload de `/models` quando presente. `OllamaProvider.listModels`/o enriquecimento via `/api/show` captura o campo de contexto disponível em `model_info` — inspecionar uma resposta real de `/api/show` (ou a doc da API do Ollama) antes de assumir o nome exato da chave, porque varia por família de modelo (ex. `llama.context_length`, `qwen2.context_length`). Se não encontrar, deixar `undefined` sem quebrar o restante do parsing — nunca bloquear listagem de modelos por falta desse dado.

FASE 2:
- Novo arquivo sidecar/src/context-budget.ts exportando:
  - Constantes: `TAIL_TURNS_PROTECTED = 2`, `PRUNE_PROTECT_TOKENS = 8_000`, `PRUNE_MINIMUM_TOKENS = 4_000`, `COMPACTION_BUFFER_TOKENS = 4_000`.
  - Função `pruneHistoryForModel(messages, budget)`: varre as mensagens de trás para frente preservando as últimas `TAIL_TURNS_PROTECTED` trocas completas (usuário→assistente→tool) intactas; soma `Math.ceil(byteLength(content) / 4)` de todas as mensagens com `role: "tool"` fora dessa cauda; se esse total exceder `PRUNE_PROTECT_TOKENS` e a poda potencial for >= `PRUNE_MINIMUM_TOKENS`, substitui o `content` dessas mensagens tool antigas por um JSON curto `{"pruned":true,"tool":<nome original>,"summary":"conteúdo de <N> bytes processado anteriormente nesta sessão"}` — mantendo `role`, `tool_call_id`/`toolCallId` e `name` intactos, só o `content` encolhe, para não quebrar o pareamento tool-call/tool-result que os provedores exigem.
  - A função nunca escreve no SQLite: recebe o array já carregado por `store.listMessages(...)` e devolve uma cópia podada em memória.
- index.ts: chamar `pruneHistoryForModel` logo depois de `store.listMessages(...).map(...)`, antes do resto da montagem de `promptMessages`, usando o `contextLimit`/`outputReserve` do `modelRecord` já resolvido naquele turno como `budget` (se `contextLimit` for `undefined`, usar um teto conservador de 32000 tokens só para a lógica de poda).
- Novo arquivo sidecar/src/context-budget.test.ts: sessão sintética com ~20 trocas incluindo tool results grandes; verificar que (a) as últimas 2 trocas ficam intactas, (b) o total estimado cai abaixo do budget configurado, (c) nenhuma mensagem `tool` fica órfã (todo `tool_call_id` de uma mensagem tool tem uma mensagem assistente com o `tool_calls` correspondente antes dela).

FASE 4.1:
- streaming.ts, dentro de `readStream`/`consume`: trocar a chave de correlação para `call.id ? \`id:${call.id}\` : \`index:${call.index}\``.

Allowed Actions:
- Editar: sidecar/src/providers.ts, sidecar/src/streaming.ts, sidecar/src/index.ts, sidecar/src/db/schema.ts, sidecar/src/db/migrations.ts.
- Editar sidecar/src/db/store.ts apenas se for estritamente necessário para expor contextLimit/outputReserve — não refatorar nada além disso ali.
- Criar: sidecar/src/context-budget.ts, sidecar/src/context-budget.test.ts.
- Editar/estender os testes existentes: providers.test.ts, streaming.test.ts, tool-contract.test.ts, index.test.ts — o que for necessário para cobrir as mudanças acima.
- Rodar `npm test` e `npx vitest run <arquivo>` quantas vezes forem necessárias durante o trabalho.

Forbidden Actions:
- Não tocar em sidecar/src/secrets.ts nem em qualquer lógica de criptografia/armazenamento de chaves de API.
- Não adicionar novas dependências (nada de tiktoken, gpt-tokenizer ou similar) — a estimativa de tokens usa a heurística bytes/4 descrita acima.
- Não implementar a Fase 3 (resumo automático/compaction) nem a Fase 5 (modelo de mensagens em "parts", tabela de transformação por provedor, permissões por wildcard) — ambas fora de escopo nesta sessão, mesmo que pareçam next-step óbvio.
- Não alterar nada em src/ ou src-tauri/ (frontend/Tauri) além de tipos TypeScript compartilhados que precisem dos novos campos opcionais `contextLimit`/`outputReserve` — sem mudar UI, componentes ou comportamento visual.
- Não rodar `npm run e2e` / Playwright (exige browser, fora do escopo desta tarefa) nem `npm run build:desktop`.
- Não fazer commit nem push. Deixar as mudanças no working tree para revisão humana.
- Migrações somente aditivas: apenas `ALTER TABLE ... ADD COLUMN`. Nunca `DROP`, `RENAME` ou qualquer alteração destrutiva em tabelas existentes.

Stop Conditions:
Pare e peça revisão humana quando:
- Terminar a Fase 0 e a Fase 1 — mostrar o diff e o resultado de `npm test` antes de seguir para a Fase 2.
- Terminar a Fase 2 — mostrar o diff, o resultado de `npm test`, e um exemplo concreto (pode ser no próprio teste) do tamanho estimado do payload antes e depois da poda em uma sessão sintética longa.
- Qualquer teste existente quebrar e não for possível corrigir em até 2 tentativas.
- For necessário alterar qualquer arquivo fora da lista em Allowed Actions.
- Antes de iniciar qualquer trabalho da Fase 3 — não iniciar essa fase sem confirmação explícita, mesmo que a Fase 2 sozinha pareça insuficiente.

Checkpoints:
Depois de cada fase, output: ✅ Fase [N] concluída — arquivos alterados: [lista] — comando de teste rodado: [comando] — resultado: [pass/fail, com contagem].
Ao final (depois da Fase 4.1), um resumo único listando todos os arquivos tocados, quais fases foram implementadas, e quais ficaram pendentes de aprovação (Fase 3 e Fase 5).

---
This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm file paths, directories, and permissions match the actual project.

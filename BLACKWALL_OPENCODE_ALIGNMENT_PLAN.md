
# Plano de implementação — alinhar o fluxo de IA do Blackwall ao do OpenCode

Este documento detalha, fase por fase, como aproximar o pipeline de chat do Blackwall (`sidecar/src`) do modelo usado pelo OpenCode (`sst/opencode`), resolvendo os três problemas diagnosticados: consumo excessivo de tokens (histórico completo reenviado a cada turno), rastreamento de uso quebrado para protocolos Responses/Chat Completions, e fragilidade no loop de tool-calling.

Cada fase é independente e entregável isoladamente. A ordem reflete risco crescente: fases 0–1 são correções cirúrgicas de baixo risco; fases 2–3 mudam o comportamento do agente (o que é enviado ao modelo) e precisam de mais teste; fase 4 é opcional/estratégica.

---

## Fase 0 — Correções críticas de rastreamento de uso (baixo risco, sem mudança de schema)

**Status: ✅ implementado e verificado (via Codex) em 2026-08-15.**

**Objetivo:** eliminar os dois bugs que fazem `tokens` chegar `undefined` na maioria das requisições, que é a causa direta dos "erros de verificação de uso de tokens".

### 0.1 — `stream_options.include_usage` no Chat Completions

Arquivo: `sidecar/src/providers.ts`, método `OpenAICompatibleProvider.chatRequest` (linha ~275).

A API de Chat Completions da OpenAI (e compatíveis: OpenRouter, OpenCode Zen) só inclui o campo `usage` no stream se a requisição pedir explicitamente. Hoje o body montado é:

```ts
const body: Record<string, unknown> = { messages, model, stream: true };
```

Mudança:

```ts
const body: Record<string, unknown> = {
  messages,
  model,
  stream: true,
  stream_options: { include_usage: true },
};
```

Aplicar também em `OllamaProvider.chatRequest` não é necessário (Ollama já manda `prompt_eval_count`/`eval_count` nativamente no fim do stream).

### 0.2 — Ler `usage` no protocolo Responses

Arquivo: `sidecar/src/streaming.ts`, função `parseLine` (bloco `if (protocol === "openai-responses")`, linha ~266–323).

Hoje o bloco trata `response.output_text.delta`, `response.function_call_arguments.*` e `response.output_item.*`, mas nunca `response.completed` — que é o evento que carrega `response.usage`. Adicionar, antes do `return null;` final do bloco Responses:

```ts
if (body.type === "response.completed") {
  const usage = (body as { response?: { usage?: Record<string, unknown> } }).response?.usage;
  return usage ? { tokens: normalizeTokenUsage({ usage }) } : null;
}
```

Como `readStream` já faz `if (chunk.tokens) tokens = { ...tokens, ...chunk.tokens };`, isso passa a popular `result.tokens` corretamente para modelos rodando via `api.openai.com` (protocolo padrão quando o `baseUrl` inclui esse host).

### 0.3 — Backoff de retry respeitando `retry-after`

Arquivo: `sidecar/src/index.ts`, dentro do loop de candidatos em `executeChat` (linha ~1153–1163).

Hoje o delay entre tentativas é fixo por posição do candidato:

```ts
await new Promise((resolve) =>
  setTimeout(resolve, Math.min(2000, 250 * 2 ** candidates.indexOf(candidate))),
);
```

O erro já carrega `windows` (parseado de `retry-after` em `parseRateLimitHeaders`, `usage.ts`). Trocar para usar o `resetAt` da janela mais restritiva quando disponível, com o backoff exponencial como piso mínimo:

```ts
const rateLimitWindows =
  typeof error === "object" && error && "windows" in error
    ? ((error as { windows?: UsageWindow[] }).windows ?? [])
    : [];
const retryWindow = rateLimitWindows.find((w) => w.label === "retry-after");
const minDelay = Math.min(2000, 250 * 2 ** candidates.indexOf(candidate));
const delay = retryWindow?.resetAt
  ? Math.max(minDelay, retryWindow.resetAt - Date.now())
  : minDelay;
await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
```

**Critério de aceite da Fase 0:** rodar `providers.test.ts`, `streaming.test.ts` e `usage.test.ts` (já existentes) mais um novo caso em `streaming.test.ts` simulando um evento `response.completed` com `usage` e verificando que `streamChatMessage` retorna `tokens` preenchido. Testar manualmente com um provedor Chat Completions real (OpenRouter) e um com Responses (`api.openai.com`) e confirmar que o uso aparece no cabeçalho da UI.

---

## Fase 1 — Modelo de dados para orçamento de contexto

**Status: ✅ implementado e verificado (via Codex) em 2026-08-15.** Migração id=8 aplicada.

**Objetivo:** dar ao sidecar a mesma informação que o OpenCode usa em `isOverflow()` — o limite de contexto do modelo — para poder decidir quando podar/resumir. Hoje `models` (schema.ts) não guarda isso.

### 1.1 — Nova coluna `models.context_limit`

Migração incremental em `db/migrations.ts`, seguindo o padrão já usado ali (bloco de `ALTER TABLE ... ADD COLUMN` guardado por `pragma table_info`, ver linha ~201–227):

```ts
if (!columns.has("context_limit"))
  client.exec("ALTER TABLE models ADD COLUMN context_limit INTEGER");
if (!columns.has("output_reserve"))
  client.exec("ALTER TABLE models ADD COLUMN output_reserve INTEGER");
```

Atualizar `db/schema.ts` (`models` table) e os tipos `ProviderModel`/`setModelCapability` em `providers.ts` para expor esses dois campos.

Preenchimento: a maioria dos provedores OpenAI-compatible retorna `context_length` em `/models` (OpenRouter manda isso no payload de cada modelo). Ajustar `OpenAICompatibleProvider.listModels` para capturar `model.context_length` quando presente. Para Ollama, `/api/show` retorna isso em `model_info` (chave varia por família, ex. `llama.context_length`); ler com fallback. Quando o provedor não informar nada, deixar `null` e usar um teto conservador (ex. 32.000 tokens) só para a lógica de poda — nunca bloquear o chat por falta desse dado.

### 1.2 — Estimativa de tokens sem tokenizer nativo

O Blackwall não tem um tokenizer embutido. Duas opções, em ordem de preferência:

1. Usar a contagem real já retornada pelo provedor (`result.tokens.totalTokens`, agora corrigido na Fase 0) como base acumulada da sessão — soma incremental salva em `provider_usage_events`, já filtrável por `sessionId` via `getUsageSummary`.
2. Para decidir *antes* de mandar a próxima requisição (a contagem real só vem depois), usar uma heurística leve (`Math.ceil(bytes / 4)`) sobre o `JSON.stringify` das mensagens candidatas — é o mesmo grau de precisão que basta para decidir "estourou ou não", não para faturamento.

Não é necessário adicionar uma dependência de tokenizer (`tiktoken`/`gpt-tokenizer`) agora; adicionar isso é uma melhoria de precisão para uma fase futura, não um bloqueador.

**Critério de aceite:** `syncProviderModels` grava `context_limit` quando o provedor informa; teste novo em `providers.test.ts` cobrindo o parsing de `context_length`/`model_info`.

---

## Fase 2 — Janela de histórico e poda de tool outputs

**Status: ✅ implementado e verificado (via Codex) em 2026-08-15.** `context-budget.ts` só poda quando o total estimado ultrapassa `contextLimit - outputReserve` (refinamento do Codex, mais fiel ao gatilho de overflow do OpenCode do que a especificação original deste documento).

Histórico da medição real (sessão de 3 mensagens explorando o projeto "aidentro" com o modelo nemotron-3.5-lightning-free, context_limit NULL → fallback 32k):
- Antes de qualquer correção: 761.475 tokens.
- Depois da 1ª correção (poda intra-turno adicionada, mas com thresholds PRUNE_PROTECT/PRUNE_MINIMUM ainda bloqueando poda de muitos resultados pequenos): 1.048.839 tokens — piorou, diagnosticado e corrigido.
- Depois de remover os thresholds que bloqueavam poda quando já acima do orçamento: 423.700 tokens — redução de ~44% frente ao ponto de partida.

O número não vai a zero porque é uma métrica cumulativa: mesmo com cada requisição individual limitada a ~28.000 tokens (32k − 4k de reserva), uma sessão com ~10-13 idas e voltas ao provedor (uma por chamada de ferramenta) soma naturalmente um total alto. Para este provedor específico (OpenCode Zen) o `context_limit` real nunca será conhecido — `/models` não expõe `context_length`/`context_window` para nenhum modelo, então o fallback de 32k é permanente aqui.

**Objetivo:** parar de reenviar a sessão inteira em todo turno — a causa raiz do consumo de tokens. Equivalente ao `SessionCompaction.prune` do OpenCode (`session/compaction.ts:243-309`), mas sem precisar da arquitetura de "parts" deles: dá para implementar em cima do modelo atual de mensagens.

### 2.1 — Onde entra no fluxo

Arquivo: `sidecar/src/index.ts`, função `executeChat`, onde `storedMessages` é montado (linha ~687–695) e onde `promptMessages` é composto (linha ~706–713).

Hoje:

```ts
const storedMessages = input.sessionId
  ? store.listMessages(input.sessionId).map(...)
  : input.messages;
```

Nova função `pruneHistoryForModel(messages, budget)` em um módulo novo `sidecar/src/context-budget.ts`, chamada logo depois:

```ts
const storedMessages = input.sessionId
  ? pruneHistoryForModel(store.listMessages(input.sessionId).map(...), contextBudget)
  : input.messages;
```

Onde `contextBudget` vem de `models.context_limit`/`output_reserve` (Fase 1) já resolvidos para o `modelRecord` daquele turno.

### 2.2 — Algoritmo de poda (espelha `PRUNE_PROTECT`/`PRUNE_MINIMUM`/`DEFAULT_TAIL_TURNS` do OpenCode)

Constantes equivalentes, em `context-budget.ts`:

```ts
export const TAIL_TURNS_PROTECTED = 2;       // últimas N trocas completas, nunca podadas
export const PRUNE_PROTECT_TOKENS = 8_000;   // só poda se o total de tool output passar disso
export const PRUNE_MINIMUM_TOKENS = 4_000;   // só poda se a poda render pelo menos isso de volta
export const COMPACTION_BUFFER_TOKENS = 4_000; // reserva de segurança, como o OpenCode
```

(Valores menores que os do OpenCode porque os modelos locais/roteados via OpenRouter tendem a ter janelas menores que os presets deles; ajustar depois de medir uso real.)

Algoritmo:

1. Varrer as mensagens de trás para frente, pulando as últimas `TAIL_TURNS_PROTECTED` trocas usuário→assistente→tool.
2. Somar bytes/4 de todas as mensagens `role: "tool"` fora da cauda protegida.
3. Se esse total exceder `PRUNE_PROTECT_TOKENS` e houver pelo menos `PRUNE_MINIMUM_TOKENS` podáveis, substituir o `content` dessas mensagens `tool` antigas por um placeholder curto: `{"pruned": true, "tool": "read_file", "summary": "arquivo lido anteriormente, 4.2 KB"}` — mantém o par tool-call/tool-result estruturalmente válido (nenhum provedor rejeita a sequência), só encolhe o payload.
4. Nunca tocar no conteúdo persistido no SQLite — a poda acontece só na cópia que vai para o provedor, exatamente como a separação "stored vs model context" do OpenCode. Isso significa que a função opera sobre o array já carregado, não faz `UPDATE` no banco.

### 2.3 — Teste

Novo arquivo `context-budget.test.ts`: sessão sintética com 20 trocas incluindo tool results grandes, verificar que (a) as últimas 2 trocas permanecem intactas, (b) o total estimado de tokens cai abaixo do limite configurado, (c) a ordem e os `tool_call_id` permanecem casados (nenhum `tool` message órfão).

**Critério de aceite:** sessões longas (>30 mensagens) passam a enviar um payload com tamanho limitado independente de quanto histórico existe, sem quebrar a correspondência tool-call/tool-result.

---

## Fase 3 — Resumo automático real (revisada em 2026-08-16 com base no código-fonte atual do OpenCode)

**Status: ✅ implementada e verificada (confirmado no código em 2026-08-22).** `compactTranscript` roda em `executeChat` com guarda `alreadyCompactedThisTurn`, o resumo persiste como mensagem `isSummary: true`, a UI renderiza card próprio (`ConversationSummaryCard`), eventos `chat.compacting` chegam ao cliente e os testes determinísticos cobrem o caminho feliz e o de overflow irrecuperável (`index.test.ts`). Mateus pediu (16/08) para copiar de verdade o fluxo do OpenCode em vez de reinventar uma poda própria; a versão abaixo foi verificada linha a linha contra o repositório real (`github.com/anomalyco/opencode`, branch `dev` — o org antigo `sst/opencode` redireciona pra lá) em vez de ser uma extrapolação da pesquisa original. Fontes: `packages/opencode/src/session/compaction.ts`, `session/overflow.ts`, `session/processor.ts`, `session/retry.ts`, `provider/transform.ts`.

**Diferença estrutural chave em relação à Fase 2:** a Fase 2 (já implementada) só *encolhe* tool outputs antigos para um stub JSON (`{"pruned":true,...}`) — o conteúdo original desaparece. O OpenCode faz algo mais parecido com o que um humano faria: manda os turnos antigos pra o próprio modelo pedindo um **resumo real em texto**, guarda esse resumo como uma mensagem, e descarta os turnos originais só depois de ter o resumo. Isso preserva mais contexto útil por token gasto do que um stub genérico. É essa mecânica — resumir de verdade, não só truncar — que falta copiar.

### 3.0 — Por que não copiar os números absolutos do OpenCode

O OpenCode mira modelos de contexto grande (200k+ tokens, Claude/GPT frontier). Os números confirmados no código-fonte são absolutos:

- `COMPACTION_BUFFER = 20_000` tokens (reserva de saída, em `overflow.ts`)
- `PRUNE_PROTECT = 40_000` tokens (só poda tool output se o total ultrapassar isso)
- `PRUNE_MINIMUM = 20_000` tokens (só poda se render pelo menos isso de volta)
- `TOOL_OUTPUT_MAX_CHARS = 2_000` (teto de caracteres por resultado individual antes de considerar poda)
- `DEFAULT_TAIL_TURNS` — **instável no upstream**: existia como `2` numa leitura do arquivo, mas uma segunda leitura minutos depois já não tinha essa constante (o `tail_turns` de config passou a default `undefined`, ou seja "não podar por turno, só por token"). O arquivo está em desenvolvimento ativo; não vale a pena perseguir um alvo que o próprio time do OpenCode está mudando. **Manter `TAIL_TURNS_PROTECTED = 2` do Blackwall como está.**

O Blackwall, na prática, atende muito modelo pequeno/gratuito (fallback de 32k de contexto quando o provedor não informa `context_length` — é o caso do OpenCode Zen hoje). Usar `PRUNE_PROTECT = 40_000` literal seria maior que o orçamento inteiro desses modelos. **Regra de adaptação: todos os limiares abaixo devem ser proporcionais ao `contextLimit` de cada modelo (via `models.context_limit`/`output_reserve`, já existente da Fase 1), nunca um valor absoluto copiado do OpenCode.** Sugestão concreta:

```ts
// context-budget.ts
const compactionBufferTokens = Math.max(
  COMPACTION_BUFFER_TOKENS, // 4_000, o já existente — piso mínimo
  Math.round(budget.contextLimit * 0.15), // 15% do contexto, como o OpenCode reserva ~10-20% em modelos grandes
);
```

### 3.1 — Gatilho de overflow (equivalente a `isOverflow()`)

Já existe na prática: `pruneHistoryForModel` compara `totalTokens` contra `availableTokens = contextLimit - outputReserve`. A mudança da Fase 3 é o que acontece **quando a poda por stub (Fase 2) não é suficiente** — ou seja, quando mesmo depois de encolher os tool outputs antigos o transcript ainda excede o orçamento. Hoje isso não tem tratamento; o request simplesmente vai estourado pro provedor.

Novo gatilho em `executeChat` (`sidecar/src/index.ts`), logo após a chamada a `pruneHistoryForModel` dentro do `while (true)`:

```ts
const estimatedTokens = estimateTranscriptTokens(transcript); // reaproveita a heurística bytes/4 já existente
if (estimatedTokens > availableTokens && !alreadyCompactedThisTurn) {
  transcript = await compactTranscript(transcript, { candidate, contextBudget, request });
  alreadyCompactedThisTurn = true; // nunca compactar duas vezes no mesmo turno — vira Fase 3.4
}
```

### 3.2 — Geração do resumo (equivalente a `processCompaction()`/`buildPrompt()`)

Nova função `compactTranscript()` em `context-budget.ts`. Passos, espelhando o real do OpenCode:

1. Separar o transcript em: cauda protegida (últimas `TAIL_TURNS_PROTECTED` trocas completas, igual à Fase 2) e o restante ("histórico antigo").
2. Fazer uma chamada adicional, **não-streaming**, ao mesmo provedor/modelo do turno atual (o OpenCode também usa por padrão o modelo da sessão, não um modelo dedicado — não adicionar essa complexidade agora), com um prompt de resumo estruturado sobre o histórico antigo:

```
Resuma esta conversa em Markdown com as seções: Objetivo, Restrições, Progresso, Decisões-chave, Próximos passos, Contexto crítico. Seja denso; omita saudações.
```

3. O resultado vira uma única mensagem nova, com um marcador (ver 3.3) indicando que é um resumo — igual ao `summary: true` que o OpenCode grava na mensagem gerada.
4. Substituir o "histórico antigo" inteiro por essa mensagem de resumo. A cauda protegida continua intocada.

### 3.3 — Persistência (adaptação pro schema de perfis/workspaces do Blackwall)

O OpenCode não tem conceito de perfil/workspace — é uma sessão por diretório de projeto. O Blackwall já tem `profiles → workspaces → sessions → messages` (schema.ts), então o resumo se encaixa naturalmente como **mais uma linha na tabela `messages` daquela sessão**, não como um conceito novo de dados. Precisa só de um jeito de marcar "isso é um resumo, não é uma mensagem normal do usuário/modelo":

- Migração nova: `ALTER TABLE messages ADD COLUMN is_summary INTEGER NOT NULL DEFAULT 0` (padrão já usado nas migrações anteriores, `PRAGMA table_info` guardado).
- `store.appendMessage` grava `role: "system"`, `isSummary: true`.
- O frontend (`src/features/.../MessageList` ou equivalente) já pode simplesmente filtrar `isSummary` pra não renderizar como bolha de chat normal — ou renderizar como um card discreto tipo "resumo automático da conversa", à escolha do Mateus depois de ver funcionando.
- Ao montar `promptMessages` (index.ts), o resumo persistido substitui as mensagens que ele resume **só na cópia enviada ao provedor** — igual à Fase 2, nunca apagar linhas reais do SQLite.

### 3.4 — Replay da última mensagem do usuário

Depois de inserir o resumo, o OpenCode volta a mandar a última mensagem real do usuário como se fosse nova (`compaction.ts`, lógica de detectar e "tocar de novo" o último turno não-resumo). No Blackwall isso é natural: a cauda protegida (3.2) já inclui a última troca usuário→assistente→tool por construção do `protectedTailStart` existente — **não precisa de replay explícito**, a cauda já cumpre esse papel. Só confirmar via teste que a última mensagem do usuário nunca fica só do lado "antigo" a ser resumido.

### 3.5 — Falha irrecuperável (equivalente a `ContextOverflowError`)

Se mesmo depois de compactar o transcript ainda estourar o orçamento (sessão gigantesca ou modelo com contexto minúsculo), não tentar compactar de novo no mesmo turno (`alreadyCompactedThisTurn`, item 3.1) — lançar um erro claro: "Esta conversa ficou grande demais para este modelo; comece uma nova sessão ou troque para um modelo com janela maior."

**Critério de aceite:** teste determinístico (ver Fase 7 abaixo) simulando uma sessão que estoura o budget mesmo após a poda da Fase 2; confirmar que a compactação roda exatamente uma vez por turno, o resumo substitui o histórico antigo mantendo a cauda intacta, e uma segunda tentativa de overflow no mesmo turno lança o erro em vez de compactar de novo.

---

## Fase 4 — Ajustes no loop de tool-calling

**Objetivo:** dois ajustes pequenos que a pesquisa do OpenCode expôs, independentes das fases anteriores.

### 4.1 — Correlação de tool-call deltas mais robusta

**Status: ✅ implementado e verificado (via Codex) em 2026-08-15.** A implementação real vai além do diff sugerido aqui: mantém um mapa `index → chave por id` porque fragmentos seguintes de um mesmo tool call frequentemente chegam sem `id` de novo — usar só `call.id ? id:... : index:...` teria quebrado a correlação nesse caso. Ver `streaming.ts` em torno da linha 376.

Arquivo: `sidecar/src/streaming.ts`, função `readStream` (linha ~371): a chave de correlação hoje é só `index:${call.index}`. Quando o provedor manda `id` estável desde o primeiro fragmento (a maioria manda), preferir `id` como chave e cair para `index` só quando `id` estiver ausente:

```ts
const key = call.id ? `id:${call.id}` : `index:${call.index}`;
```

Isso evita colisão quando dois tool calls concorrentes chegam sem `index` bem formado.

### 4.2 — Reavaliar `DEFAULT_TOOL_CALL_BUDGET` depois da Fase 2

Hoje `DEFAULT_TOOL_CALL_BUDGET = 128` e `MAX_TOOL_RESULT_BYTES_PER_TURN = 512_000` (`tool-contract.ts`) existem porque não havia poda — o orçamento por turno era a única proteção contra explosão de contexto. Com a poda da Fase 2 ativa, esses tetos podem ficar mais folgados sem risco (a poda cuida do que sobra depois), mas vale reduzir o `MAX_TOOL_RESULT_BYTES_PER_TURN` para algo como 200.000 bytes como segunda linha de defesa, já que a poda só age passado o turno atual.

**Critério de aceite:** `tool-contract.test.ts` atualizado cobrindo a correlação por `id`; nenhuma regressão nos testes de orçamento existentes.

### 4.3 — Doom loop: alinhar threshold com o OpenCode (novo, 2026-08-16)

**Status: pendente.** Confirmado no código-fonte (`session/processor.ts`): `DOOM_LOOP_THRESHOLD = 3` (para no 3º erro/repetição idêntica). O Blackwall hoje usa `shouldStopAfterRepeatedToolError(2)` (para na 2ª) — mais rígido. Isso é uma escolha deliberada, não um bug: threshold menor gasta menos tokens quando o modelo está preso num erro, mas dá menos chance de auto-correção. Dado que o problema original (`execute_command` encadeando shell) já ganhou um aviso proativo no `toolInstruction` (16/08), considerar subir para `3` só depois de confirmar que o aviso proativo já reduz a taxa de erro — subir o threshold sem isso é gastar mais tokens no mesmo bug. **Decisão explícita de quem executar esta fase: manter 2 ou subir para 3, registrando o motivo aqui.**

### 4.4 — Retry/backoff: conferir contra os valores reais do OpenCode (novo, 2026-08-16)

**Status: pendente de verificação.** A Fase 0.3 foi implementada e reportada como concluída em 15/08, mas nunca foi reconferida linha a linha depois disso. Valores confirmados no código-fonte do OpenCode (`session/retry.ts`) para comparar contra a implementação atual do Blackwall:

```
RETRY_INITIAL_DELAY = 2_000        // ms
RETRY_BACKOFF_FACTOR = 2
RETRY_JITTER_FACTOR = 0.25
RETRY_MAX_DELAY_NO_HEADERS = 30_000 // ms, teto quando não há header retry-after
RETRY_MAX_RETRIES = 5
```

O Blackwall lê `retry-after` (via `parseRateLimitHeaders`) mas o backoff mínimo hoje é `Math.min(2000, 250 * 2 ** posição)` — teto de 2 segundos, bem menor que o teto de 30s do OpenCode, e sem jitter. Ação: (a) reler o trecho atual em `index.ts` e confirmar se ainda bate com o que a Fase 0.3 descreveu; (b) considerar adicionar jitter (`RETRY_JITTER_FACTOR`) para evitar que múltiplas abas/sessões batam no rate limit no mesmo instante; (c) `RETRY_MAX_RETRIES = 5` explícito — hoje o Blackwall usa `routeCandidates(..., maxAttempts = 8)`, que é um conceito adjacente (tenta outros candidatos de rota) mas não é a mesma coisa que "tentar de novo o mesmo candidato até 5x". Não misturar os dois conceitos ao implementar.

**Critério de aceite:** `providers.test.ts`/`index.test.ts` cobrindo o teto de 30s e o jitter; nenhuma mudança de comportamento pra quem não está sendo rate-limited.

---

## Fase 6 — Prompt caching via `cache_control` (nova, 2026-08-16, promovida da antiga Fase 5)

**Status: pendente.** Confirmado no código-fonte (`provider/transform.ts`, função `applyCaching()`): o OpenCode marca como cacheável **as 2 primeiras mensagens `system`** e **as 2 últimas mensagens não-system**, aplicando `cache_control: { type: "ephemeral" }` (formato Anthropic; outros provedores têm chave equivalente — Bedrock usa `cachePoint`, OpenAI-compatible usa `cache_control` também, Copilot usa `copilot_cache_control`).

**Importante, já investigado nesta sessão:** caching muda o **custo** cobrado por token (lido/cacheado sai mais barato), mas **não reduz a contagem de tokens** que aparece no `usage` — os tokens cacheados continuam contando no total. Ou seja, esta fase serve pra economizar dinheiro em provedores pagos que cobram por token cacheado mais barato (Anthropic, Qwen/Alibaba via OpenRouter, Bedrock, Vertex) — **não resolve o problema de "tokens totais" que motivou este plano inteiro.** Vale a pena, mas é uma otimização de custo, não de contagem.

O OpenCode Zen (provedor usado nos testes reais do Mateus) tem modelos gratuitos sem coluna de "cache write" na tabela de preços — não há evidência de que caching explícito (`cache_control`) funcione nesse endpoint específico para o modelo gratuito testado; o script `scripts/diagnose-zen-cache.ts` (já entregue) serve pra confirmar isso caso Mateus troque pra um modelo pago da Zen no futuro.

### 6.1 — Onde aplicar

Nova função `applyPromptCaching(messages, capability)` chamada em `providers.ts`/`streaming.ts` antes de montar o `body` da requisição — só quando o provedor/modelo tiver uma capability explícita `supportsPromptCaching: true`. Seguir o mesmo padrão já usado pra `toolSupport`/`parallelToolCalls`: campo em `models` (nova coluna, migração incremental), resolvido em `auto`/`enabled`/`disabled`, default `disabled` até confirmação manual — não adivinhar automaticamente que um provedor suporta, dado que isso é cobrança real de dinheiro do Mateus se aplicado errado.

### 6.2 — Formato por provedor

Detectar por `baseUrl` (mesmo padrão de `isOpenRouter`): OpenRouter repassa `cache_control` no formato Anthropic pra qualquer modelo Anthropic/Alibaba roteado por ele (confirmado na doc oficial, pesquisa de 15/08); chamada direta a `api.anthropic.com` (se algum dia suportado) usaria o mesmo formato. Não implementar Bedrock/Vertex/Copilot agora — o Blackwall não tem esses provedores.

**Critério de aceite:** teste em `providers.test.ts` confirmando que `cache_control` só aparece nas 2 primeiras mensagens system e 2 últimas mensagens quando a capability está `enabled`, e nunca aparece por padrão.

---

## Fase 7 — Teste de integração determinístico (pré-requisito antes de mexer mais em Fase 3/6)

**Status: ✅ implementado (confirmado em 2026-08-22).** A suíte WebSocket de `index.test.ts` usa `fetch` mockado e cobre poda intra-turno em três turnos, compactação única com persistência de resumo e falha sem loop — determinísticos, sem rede nem modelo real. Motivo: em 16/08 uma mudança pequena e aparentemente segura (enxugar o `toolInstruction`) foi seguida por uma medição manual pior (509.310 vs 423.700 tokens), e não foi possível confirmar se foi regressão real ou variância de uma única amostra não-determinística. Continuar julgando mudanças de poda/compactação por "rodei uma vez no app de verdade e comparei o número" não é confiável o suficiente pra uma mudança do tamanho da Fase 3.

Construir um teste em `index.test.ts` (mockando `global.fetch`, no mesmo padrão já usado ali) que: roda 3 turnos com ~30 chamadas de ferramenta cada através do `executeChat` real; asserta um teto determinístico de tamanho de transcript enviado por requisição; e, depois que a Fase 3 existir, asserta que uma mensagem com `isSummary: true` aparece quando o cenário simulado excede o orçamento mesmo após a poda da Fase 2.

**Critério de aceite:** o teste passa de forma determinística (sem depender de rede real ou de um modelo real), e vira parte da suíte que roda antes de qualquer mudança futura em `context-budget.ts`/Fase 3/Fase 6.

---

## Ordem de rollout recomendada (atualizada em 2026-08-22)

1. ~~Fase 0~~ — concluída.
2. ~~Fase 1~~ — concluída.
3. ~~Fase 2~~ — concluída (redução de ~44% medida).
4. ~~Fase 4.1~~ — concluída.
5. ~~Fase 7~~ — concluída (testes determinísticos WebSocket).
6. ~~Fase 3~~ — concluída (resumo real via LLM, persistido com isSummary).
7. **Fase 4.3** (doom loop 2→3) — decisão pendente do owner; medir a taxa de erro com o aviso proativo atual antes de subir o threshold.
8. **Fase 4.4** (retry/backoff) — pendente: adicionar jitter (~25%) e teto de 30s quando não há header retry-after; hoje o piso é fixo em 2s sem jitter (`index.ts`, bloco retry-after).
9. Fase 6 (cache_control) — adiada por design: ganho de custo, não de contagem; só depois das anteriores estabilizarem.
10. Fase 4.2 (ajuste de budgets) — depende de medir a Fase 3 em uso real.

> **Estado consolidado e próximos passos macro:** ver `ROADMAP.md` na raiz.

Cada fase tem testes automatizados existentes que servem de rede de segurança (`index.test.ts`, `streaming.test.ts`, `tool-contract.test.ts`, `providers.test.ts`, `usage.test.ts`, `store.test.ts`, `context-budget.test.ts`) — rodar a suíte completa entre fases antes de avançar.

---

## Registro de trabalho feito fora da numeração original (2026-08-16)

Antes desta revisão, as seguintes mudanças já foram implementadas e verificadas (102/102 testes, typecheck e lint limpos), fora da sequência de fases original — documentando aqui pra manter este arquivo como fonte única da verdade:

- **`parallel_tool_calls` configurável**: nova coluna `models.parallel_tool_calls` (`auto`/`enabled`/`disabled`, migração id=9). `auto` resolve para `true` só em provedores OpenRouter (único com "Tool Call Error Rate" confirmado publicamente); qualquer outro provedor mantém `false` por padrão. Override manual disponível via `PATCH /v1/providers/:id/models/:modelId/parallel-tool-calls` e seletor na tela de configuração do provedor.
- **Painel de uso corrigido**: `cachedInputTokens`/`reasoningTokens` já eram gravados no backend (`usage.ts`) mas nunca apareciam em `UsageDashboard.tsx` — agora aparecem no grid de totais.
- **`toolInstruction` enxuto + aviso proativo**: texto reescrito removendo redundância (364 → 298 tokens), depois com uma frase nova avisando proativamente que `execute_command` não tem shell (298 → 339 tokens; ainda 25 tokens abaixo do original). Resultado de uma medição manual pós-mudança (509.310 tokens) ficou pior que o baseline anterior (423.700) numa comparação de mesma tarefa/modelo — **causa não confirmada ainda**, ver Fase 7.
- **`scripts/diagnose-zen-cache.ts`**: script de diagnóstico entregue (não executado ainda pelo Mateus) pra confirmar se o endpoint da OpenCode Zen retorna `cached_tokens` pro formato exato de requisição que o Blackwall já usa.
- **Filtro "somente esta sessão" no painel de uso**: `getUsageSummary()` já suportava `sessionId` fim-a-fim no backend, mas `UsageDashboard.tsx` nunca passava esse parâmetro — sempre mostrava total acumulado do período (30 dias por padrão), mascarando comparações de sessão única. Corrigido com checkbox "Somente esta sessão" em `UsageDashboard.tsx`/`ProviderManager.tsx`/`WorkspaceShell.tsx`.
- **Teto fixo de poda de saída de ferramentas (`TOOL_OUTPUT_BUDGET_TOKENS`/`TOOL_OUTPUT_PRUNE_MINIMUM_TOKENS`, 40.000/20.000, `context-budget.ts`)**: achado por comparação direta com uma sessão real no OpenCode nativo (mesmo modelo, mesmo workspace, mesmos prompts) — 47.680 tokens totais lá contra 720.551 no Blackwall pra exploração equivalente. Causa raiz: `pruneHistoryForModel` só podava reativamente quando `totalTokens > availableContextTokens(contextLimit)`; para modelos de janela grande (ex. Nemotron 3.5 Lightning Free via OpenCode Zen, 262.144 tokens) esse teto nunca é alcançado numa sessão comum, então nenhuma saída de ferramenta antiga jamais era substituída — toda chamada resend a íntegra do histórico em toda requisição subsequente. O `prune()` do OpenCode (`session/compaction.ts`) usa um teto absoluto (`PRUNE_PROTECT=40_000`/`PRUNE_MINIMUM=20_000`) deliberadamente **não** proporcional à janela do modelo — poda a saída de ferramentas mais antiga que os últimos ~40k tokens independente de quanta folga o modelo tem. Isso contraria o princípio geral "escalar tudo proporcionalmente ao `context_limit`" estabelecido nas fases anteriores: correto pra maioria dos limiares, errado especificamente aqui. Implementado como um segundo gatilho independente em `pruneHistoryForModel`, mantendo o gatilho antigo (baseado no `context_limit` real) como rede de segurança pra modelos de janela pequena. Verificado com 2 novos testes em `context-budget.test.ts` (9/9 passando) e suíte completa (81/81 testes, tsc e biome limpos).
- **Causa raiz real da discrepância "720k vs 47k" — métricas diferentes, não gasto diferente**: o painel do OpenCode mostra **uma única requisição** (o contexto atualmente ocupado), enquanto o do Blackwall somava **todas as requisições da sessão**. Confirmado na fonte: `session/overflow.ts` do OpenCode calcula `tokens.input + tokens.output + tokens.cache.read + tokens.cache.write` sobre `SessionV1.Assistant["tokens"]` — os tokens de *uma* mensagem assistant. Bate exatamente com o painel dele (1.615 + 349 + 20 + 45.696 = 47.680, e 47.680/262.144 = 18% = o "Uso" exibido). O `getUsageSummary` do Blackwall (`usage.ts`) faz `SUM(total_tokens)` sobre todas as linhas de `provider_usage_events`. Comparando o mesmo indicador na sessão real `a3fc7721`: última requisição do Blackwall = 33.362 tokens de contexto contra 47.680 do OpenCode — **o Blackwall usa menos contexto por requisição**, não mais. Atenção também à semântica de cache, que difere: no OpenCode `cache.read` é somado separadamente de `input`; em APIs OpenAI-compatíveis `prompt_tokens` **já inclui** `cached_tokens` (`normalizeTokenUsage` mapeia corretamente, então somar os dois seria contagem dupla). Corrigido expondo `lastRequest` em `UsageSummary` (mesma query `latest` já existente, sem round-trip extra) e separando no `UsageDashboard.tsx` "Contexto atual (última requisição)" de "Acumulado de todas as requisições (cobrança)". Teste novo em `usage.test.ts`; 82/82 testes, tsc (sidecar + frontend) e biome limpos.
- **Nota sobre o teto fixo de poda acima**: continua válido como alinhamento real de comportamento com o `prune()` do OpenCode e reduz o custo acumulado de fato, mas **não** era a causa da discrepância de números relatada — essa era a diferença de métrica descrita acima.
- **Achado secundário, ainda não corrigido**: `models.context_limit` fica `null` no banco quando o provedor não informa `context_length` na listagem de modelos (confirmado pra `nemotron-3.5-lightning-free` via OpenCode Zen, cujo limite real é 262.144). `index.ts:805` cai num fallback de `32_000` nesse caso — incorreto, mas não é a causa da explosão de tokens (um fallback maior só reduziria ainda mais a chance da rede de segurança disparar). Vale revisitar `syncProviderModels`/endpoint de detalhes do modelo depois.

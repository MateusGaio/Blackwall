Você é um engenheiro sênior trabalhando no codebase do Blackwall (`sidecar/src`, TypeScript, Node). Este prompt autoriza um subconjunto específico de fases de um documento de planejamento que já existe no repositório: `BLACKWALL_OPENCODE_ALIGNMENT_PLAN.md` (raiz do projeto). Leia esse arquivo inteiro antes de tocar em qualquer código — ele contém a especificação completa, os números confirmados no código-fonte real do OpenCode, e o histórico de decisões já tomadas. Este prompt não repete tudo que está lá; ele diz **o que você está autorizado a fazer agora, em que ordem, e onde parar**.

## Estado atual (contexto que você precisa saber antes de começar)

- Fases 0, 1, 2 e 4.1 do plano já estão implementadas e verificadas (102/102 testes passando).
- Hoje (16/08) uma mudança pequena no `toolInstruction` (texto de sistema, `sidecar/src/index.ts`) foi seguida por uma medição manual pior (509.310 tokens vs um baseline de 423.700 na mesma tarefa/modelo). A causa não foi confirmada — pode ser regressão real ou variância normal de um modelo não-determinístico medido com uma amostra só. Isso é o motivo da Fase 7 vir primeiro nesta lista: precisamos de um teste determinístico antes de continuar julgando mudanças de poda/compactação por "rodei uma vez e comparei o número".
- `context-budget.ts`, `context-budget.test.ts`, `providers.ts`, `streaming.ts`, `index.ts`, `tool-contract.ts` e o schema/migrations do SQLite (`db/schema.ts`, `db/migrations.ts`) já existem e seguem padrões estabelecidos (migração incremental com `PRAGMA table_info` guardado; capabilities por modelo resolvidas em `auto`/`enabled`/`disabled`, default seguro, override manual via PATCH + seletor na UI — ver como `parallelToolCalls` foi implementado em `providers.ts` como referência de estilo pra qualquer capability nova).

## Estado alvo — o que fazer, em ordem, com checkpoint obrigatório entre cada item

### 1. Fase 7 do plano — teste de integração determinístico (faça isso primeiro, sempre)

Construir o teste em `sidecar/src/index.test.ts` descrito na Fase 7: mockar `global.fetch`, rodar 3 turnos com ~30 chamadas de ferramenta cada através do `executeChat` real, e assertar um teto determinístico de tamanho de transcript por requisição. Pode reaproveitar o padrão de teste WebSocket já existente nesse arquivo (`queued`/`waiters`/`waitFor`).

**Pare aqui e reporte** antes de seguir para o item 2: rode a suíte inteira (`npm test`), confirme que o novo teste passa de forma determinística (sem rede real), e me diga o resultado.

### 2. Fase 3 do plano — resumo automático real via LLM

Só comece depois de eu confirmar o item 1. Implementar exatamente como a Fase 3 do documento descreve: gatilho de overflow pós-poda (3.1), `compactTranscript()` gerando um resumo real via chamada não-streaming ao mesmo modelo do turno (3.2), persistência como nova coluna `messages.is_summary` seguindo o padrão de migração incremental já usado (3.3), sem replay explícito da última mensagem do usuário porque a cauda protegida já cobre isso (3.4), e erro claro em vez de loop infinito se compactar não bastar (3.5).

**Obrigatório, não pule:** todos os limiares numéricos (buffer de compactação, protect/minimum de poda) devem ser proporcionais ao `contextLimit` de cada modelo (seção 3.0 do plano), nunca os valores absolutos do OpenCode (`PRUNE_PROTECT=40000` etc. são para modelos de 200k+ de contexto; o Blackwall atende muito modelo de 32k de fallback). Se você copiar um valor absoluto sem escalar, isso é um bug, não uma variação de estilo.

**Pare aqui e reporte** antes de seguir para o item 3: rode a suíte inteira, inclua o novo teste da Fase 3 descrito no critério de aceite (3.5), e me dê os números antes/depois numa sessão simulada que force overflow pós-poda.

### 3. Fases 4.3 e 4.4 do plano — doom loop e retry/backoff

Só depois do item 2 confirmado. Para 4.3 (doom loop threshold): **não mude de 2 para 3 sozinho** — registre no plano os dois lados da decisão (a que já está escrita) e pergunte antes de aplicar, porque é uma troca deliberada de tokens-gastos-por-erro contra chance-de-autocorreção, não uma correção de bug óbvia. Para 4.4 (retry/backoff): releia o trecho atual em `index.ts`, compare contra os valores confirmados do OpenCode listados na Fase 4.4, e ajuste teto/jitter se divergir muito — sem misturar isso com `routeCandidates`/`maxAttempts`, que é um conceito diferente (troca de candidato de rota, não retry do mesmo candidato).

## Fora de escopo nesta rodada — não toque

- **Fase 6 do plano (`cache_control`/prompt caching)**: não implementar agora. É otimização de custo em provedores pagos, não reduz a contagem de tokens que motivou este trabalho, e mexe com cobrança real de dinheiro do Mateus se malconfigurado — fica para uma autorização futura separada.
- Não mexer no texto do `toolInstruction` de novo nesta rodada — já foi editado hoje e o efeito ainda não foi confirmado (é literalmente o motivo da Fase 7 existir).
- Não fazer commit nem push. Trabalho fica no working tree para eu revisar.
- Não adicionar dependência de tokenizer (`tiktoken`/similar) — o plano já decidiu explicitamente não precisar disso agora (seção 1.2).

## Condições de parada

- Pare e pergunte se qualquer migração de schema não seguir o padrão `PRAGMA table_info` guardado já usado em `db/migrations.ts` — não crie um mecanismo de migração novo.
- Pare e pergunte se a Fase 3 exigir uma segunda chamada de rede por turno de forma que quebre o modo `BLACKWALL_E2E_MOCK`/`BLACKWALL_E2E_AGENT` usado pelos testes existentes.
- Depois de cada item (1, 2, 3), pare e reporte antes de continuar — não encadeie as três fases numa entrega só.

Depois de cada entrega, rode `npm test`, `npx tsc -p sidecar/tsconfig.json --noEmit` e `npx biome check` nos arquivos tocados, e inclua os resultados no seu relatório.

---
This prompt is for an agentic tool with real system access. Review the scope locks, forbidden actions, and stop conditions before pasting. Confirm file paths, directories, and permissions match the actual project.

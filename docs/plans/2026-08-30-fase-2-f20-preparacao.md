# Fase 2 — F2.0: preparação e estabilização

> Estado local da execução do épico #178 em 2026-08-30. A branch foi criada a
> partir do estado de trabalho existente; arquivos não rastreados do usuário
> foram preservados.

## Âncora de restrições

- Stack permanece Tauri v2 + React/Vite + sidecar Node/TypeScript.
- Nenhuma dependência de LanceDB, MCP ou Python foi instalada nesta etapa.
- A única dependência nova autorizada para F2.0 é WebdriverIO, usada pelo
  harness Tauri externo.
- Telemetria continua desligada por padrão e nenhum prompt/resposta/segredo é
  emitido pelos harnesses.
- Não houve mudança de UI; o checklist de motion não se aplica a esta etapa.

## Matriz do épico #178

| Item | Escopo | Estado nesta branch | Evidência local / próximo passo |
|---|---|---|---|
| #149 | Erros tipados em `GET /v1/providers/:id/models` | ✅ Implementado | `sidecar/src/providers.ts`, `sidecar/src/index.ts`, testes HTTP em `sidecar/src/index.test.ts` |
| #179 | Retry com base 2s, fator 2, jitter ±25%, 5 tentativas, teto de 30s sem header | ✅ Implementado | `sidecar/src/retry.ts` e `sidecar/src/retry.test.ts`; `retry-after` é piso sem teto |
| #180 | Doom-loop | ✅ Mantido em 2 | `sidecar/src/tool-contract.ts` e testes existentes; não alterado para 3 |
| #87–#89 | Ciclo agente–ferramenta | 🔎 Candidato a encerramento | Base de tools, approvals e budget já coberta pelos testes atuais; encerramento externo requer atualização das Issues com links desta branch |
| #90 | Compatibilidade com modelos antigos | ⏸ Backlog | Deve permanecer não bloqueante; reavaliar quando o item de protocolos tocar a Fase 2 |
| #91 | Evidências | ✅ Revisado localmente | Auditoria existente em `docs/security-audit/`; anexar links no tracker externo |
| #92 | Harness Tauri desktop real | ⚠️ Implementado, bloqueado no ambiente | `npm run test:harness:desktop`; falta `WebKitWebDriver` nativo neste host |
| #93 | Harness live opt-in | ✅ Implementado, não executado sem opt-in | `npm run test:harness:live`; URL/model/key próprios por provedor e workflow não bloqueante |

### Contrato de slash commands / PR #238

O conteúdo da PR #238 e o gate associado não estão disponíveis neste clone: o
GitHub local está sem autenticação válida e não há ref/branch da PR. O código e
`UX_SPEC.md` continuam no contrato confirmado da Fase 1, que expõe somente
`/nota`. Portanto, não foi inventado nem parcialmente integrado um contrato
para `/note`, `/model`, `/plan`, `/mode` ou `/help`.

Para concluir essa parte sem reabrir decisões de UX, o mantenedor precisa
fornecer a PR/ref autenticada ou aplicar o contrato em uma atualização
separada; então o coordenador deve validar o gate, alinhar `UX_SPEC.md` e
atualizar esta matriz.

## Decomposição posterior do #178

| Frente | Dependência principal | Resultado esperado |
|---|---|---|
| watcher/indexação | ADR-03, ADR-19 | Projeção incremental do Vault e reindexação segura |
| embeddings/LanceDB | ADR-04 | Embeddings locais ou API configurável, com storage isolado |
| busca híbrida/citações | ADR-03, ADR-04 | FTS5 + vetor, ranking reproduzível e citações verificáveis |
| tools/UI de RAG | ADR-19 | Busca/contexto explícitos, estados de loading e erro |
| cliente MCP/permissões | ADR-15 | Consentimento por servidor/tool e escopo persistido |
| servidor MCP | ADR-15 | Exposição mínima e auditável de capacidades locais |
| Vault avançado/motion | ADR-19 | UX incremental após o núcleo de indexação |

Esta decomposição é planejamento; nenhuma frente acima foi iniciada em F2.0.

## Gates locais

- ✅ `npx vitest run sidecar/src/retry.test.ts sidecar/src/providers.test.ts sidecar/src/index.test.ts` — 45 testes passaram.
- ✅ `npm run build:sidecar`.
- ✅ `npx biome check --write` nos arquivos alterados.
- ✅ `npm run test:harness:live` sem opt-in — saída `skipped` e nenhuma chamada externa.
- ⚠️ `npm run test:harness:desktop` — bloqueado antes do fluxo por ausência de `WebKitWebDriver`; instalar `webkit2gtk-driver` ou definir `TAURI_NATIVE_DRIVER`.
- ⏳ Knip, dependency-cruiser e suíte completa devem ser executados no ambiente com permissões de socket compatíveis.

O harness live aceita `BLACKWALL_LIVE_OLLAMA_URL`,
`BLACKWALL_LIVE_OLLAMA_MODEL`, `BLACKWALL_LIVE_OLLAMA_API_KEY`,
`BLACKWALL_LIVE_OPENAI_URL`, `BLACKWALL_LIVE_OPENAI_MODEL`,
`BLACKWALL_LIVE_OPENAI_API_KEY` e `BLACKWALL_LIVE_TIMEOUT_MS`. A execução live
é obrigatória antes do release da Fase 2, mas deve permanecer desligada até o
núcleo RAG existir e ser validado.

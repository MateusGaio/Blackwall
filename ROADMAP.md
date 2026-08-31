# Blackwall — ROADMAP

> Fonte viva do estado e dos próximos passos. Atualizado em **2026-08-30**.
> Decisões de stack/ADRs: `ARCHITECTURE.md` · Escopo de produto: `PRODUCT.md` · Contrato de UI: `UX_SPEC.md`.

---

## Onde estamos (estado consolidado)

| Frente | Estado |
|---|---|
| **Fase 1 — MVP (produto)** | ✅ Entregue e estável: perfis/workspaces/Souls, Vault Markdown + grafo d3-force, chat WebSocket com streaming e fallback de rota, anexos textuais/PDF com FTS5, modos `ask`/`automatic`/`read-only`, uso local com limites manuais, observabilidade opt-in, captura explícita `/nota` idempotente com desfazer |
| **Fechamento `v0.1.0` (pre-release beta)** | 🔄 Em fechamento: hardening do runtime, auditoria de segurança/motion, CI Linux/Windows, bundles AppImage/`.deb`/NSIS e release manual sem updater |
| **Pipeline de IA** (alinhamento ao OpenCode) | ✅ Fases 0–3, 4.1 e 7 concluídas — rastreamento de uso, orçamento de contexto, poda de tool outputs, **compactação real com resumo persistido (`isSummary`)** e testes determinísticos. Detalhes em [`BLACKWALL_OPENCODE_ALIGNMENT_PLAN.md`](./BLACKWALL_OPENCODE_ALIGNMENT_PLAN.md) |
| **UI** | ✅ Fundação shadcn + tokens OLED + U1–U3 mergeadas (chat, onboarding, vault, settings sobre primitivas). 🔄 **Em voo pelo owner:** U4 estética terminal (#173) e U5 cromo de sessão (#175) |
| **Qualidade / robustez** (2026-08-22) | ✅ Robustez do ciclo de stream (#161), performance do sidecar (#162), remoção de código morto (#163), i18n completo (#168), performance da UI (#169) |

## Pendências pontuais do pipeline (fora de fase)

| Item | Origem | Esforço |
|---|---|---|
| Doom loop threshold 2→3 — **decisão do owner**, medir antes | Alinhamento §4.3 | horas |
| Retry com jitter (~25%) + teto de 30s sem header | Alinhamento §4.4 | meio dia |
| `cache_control` opt-in por capability | Alinhamento Fase 6 | adiado (custo, não contagem) |
| Fallback de `context_limit` null (32k fixo hoje) | Registro 16/08 + #149 | pequeno |

## Em voo (owner)

- **Épico Chat v2 — padrão Codex híbrido** (spec #181, plano em `docs/plans/2026-08-23-plano-chat-v2-codex.md`): PRs abertos em cadeia — #187 spec · #188 limpeza · #189 thread nas primitivas assistant-ui · #190 passos agênticos + ApprovalCard · #191 composer bottom pane + fila com preview · #186 co-localização/varredura final. Merge somente com autorização do owner, na ordem da cadeia.

## Próxima fase de produto — Fase 2: RAG semântico + MCP

### F2.0 — preparação e estabilização (#178)

Em execução na branch `chore/178-f2-preparacao`: #149 e #179 foram
implementadas com testes determinísticos, o limiar de doom-loop permanece 2,
e os harnesses #92/#93 foram adicionados. O harness desktop depende de
`WebKitWebDriver` nativo no host; o live harness é estritamente opt-in e não
bloqueia CI. A matriz completa, a decomposição e os gates estão em
[`docs/plans/2026-08-30-fase-2-f20-preparacao.md`](./docs/plans/2026-08-30-fase-2-f20-preparacao.md).

PR #238 não está disponível neste clone autenticado; o contrato de slash
commands permanece, portanto, no escopo confirmado de Fase 1 (`/nota`) até a
ref da PR ser fornecida.

Conforme `PRODUCT.md`, a Fase 2 abre duas frentes:

1. **RAG semântico (LanceDB)** sobre Vault + anexos — hoje a busca é só lexical (FTS5).
2. **MCP** — conectar servidores/clientes MCP ao harness.

### Entregas MCP da Fase 2

- **F2.6 — cliente MCP e permissões por workspace:** entregue na PR #245. O Blackwall
  consome apenas servidores explicitamente configurados e ferramentas habilitadas.
- **F2.7 — servidor MCP local somente leitura:** exporta um workspace por endpoint Streamable
  HTTP loopback, com token independente e `search_workspace` como única ferramenta. A
  exportação permanece desligada até haver token e allowlist explícita; stdio, OAuth,
  resources/prompts, escrita e proxy de ferramentas remotas seguem fora do escopo.

**Pré-requisitos sugeridos antes de abrir a Fase 2:**

- [ ] Fechar U4/U5 (base de UI estável para receber novas telas)
- [ ] Zerar as pendências pontuais 4.3/4.4 (afetam o custo de tokens do agente que o RAG alimenta)
- [x] Corrigir **#149** (400 genérico em `GET /v1/providers/{id}/models`) — implementação local na F2.0; investigação arquivada em `docs/investigacoes/2026-08-22-models-400.md`
- [x] Adicionar harness desktop/live (#92/#93); a execução desktop ainda requer `WebKitWebDriver` nativo no ambiente

## Mapa das issues abertas (triage 2026-08-22)

| Issues | Recomendação |
|---|---|
| #149 | Corrigir no pré-requisito da Fase 2 |
| #87 · #88 · #89 (ciclo agente-ferramenta) | Base já existe (tools + approvals + budget); reavaliar escopo restante contra o código atual antes da Fase 2 — parte pode já estar entregue |
| #92 · #93 (harness Tauri/Ollama real) | Antes ou junto da Fase 2 (validação de MCP) |
| #108 · #109 · #110 (perfil/onboarding) | Reavaliar contra a U3.1 mergeada; fechar com repro se não reproduzirem mais |
| #126 · #127 (boas-vindas/usage no chat) | Decidir após o U5 (#175) — o cromo de sessão muda esse fluxo |
| #146 · #147 · #148 (efeitos shiny/border/stagger) | Backlog de polimento pós-U5 |
| #156 (spec U4) | Fechar quando #173 mergear |
| #79 (souls EN) · #100/#102 (uso) | Provavelmente já entregues — confirmar e fechar |
| #84 (workspace-access) | Feature removida por design (#139); reabrir issue nova se a ideia voltar |
| #90 (compatibilidade modelos antigos) | Ligar ao item de protocolos quando tocar na Fase 2 |

> Regra da casa: Issue → branch → PR rascunho → gates → merge só com autorização do owner (`AGENTS.md` §2).

## Arquivo de planos executados

`docs/plans/arquivados/` — planos de execução concluídos, mantidos como registro histórico:

- `2026-08-21-plano-limpeza-de-casa.md` (H1–H3: git, decomposição de monólitos, i18n)
- `2026-08-22-prompt-execucao-u2.md` · `2026-08-22-prompt-execucao-u3.md` (redesign UI)

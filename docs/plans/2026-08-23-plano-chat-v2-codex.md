# Plano — Chat v2: padrão Codex híbrido (App + TUI)

> Criado em 2026-08-23 · Owner: Mateus · Status: **em execução**
> Contrato visual: [`UX_SPEC.md` §3 v2](../../UX_SPEC.md) · Épico rastreado a partir da Issue [#181](https://github.com/MateusGaio/Blackwall./issues/181)

## Contexto

O dono avaliou a superfície de chat pós-U4/U5 como insatisfatória e pediu redesign alinhado às UIs de modelos famosos, com o Codex como referência híbrida:

- **Codex CLI/TUI** (ratatui): `ChatWidget` (células de transcript + célula ativa), `BottomPane` único (composer, send↔stop na mesma posição, status acima do input, preview de fila pendente, hints).
- **Codex App desktop**: thread central limpa, passos agênticos colapsáveis abaixo da interação (expandíveis até representação crua), plano executado como checklist.

Diagnóstico do estado atual (varredura 2026-08-23): assistant-ui usado só como runtime headless; thread à mão (`ChatThread.tsx`); CSS legado morto; componentes de chat fora de `features/chat`.

## Decisões travadas

1. **Referência:** híbrido Codex App (transcript/passos) + Codex TUI (bottom pane/status).
2. **Renderização:** migrar para primitivas oficiais do `@assistant-ui/react@0.15.16` (`MessagePrimitive`/`ThreadPrimitive`/`ComposerPrimitive`) sobre o `useExternalStoreRuntime` existente — contrato do `SidecarChatStore` intocado.
3. **Escopo:** só a superfície de chat (thread, composer, cromo de sessão, passos, aprovação). Header/sidebar/Vault fora do escopo.

## Tabela de labels (pt-BR / en) — aprovada pelo dono

| Chave | Atual | Nova (pt-BR) | en |
|---|---|---|---|
| `chat.status.thinking` | `consulting` | `pensando…` | `thinking…` |
| `chat.status.generating` | `generating` | `gerando…` | `generating…` |
| `chat.workedSteps` | `{n} passos de ferramenta` | `agiu · {n} {ação\|ações}` (+ duração quando houver) | `acted · {n} {step\|steps}` |
| `chat.showDetails` / `chat.hideDetails` | — | `ver detalhes` / `ocultar` | `show details` / `hide details` |
| `chat.scrollToBottom` | idem | `ir para o fim ↓` | `jump to bottom ↓` |
| marcadores de papel | `› você` / `● Blackwall` | `❯ você` / `● blackwall` | `❯ you` / `● blackwall` |

Demais labels (fila, aprovação, modos, anexos) preservam sentido com copy revisada pt/en.

## Fases

| Fase | Issue | Branch base | Entrega |
|---|---|---|---|
| **A** — spec/terreno | #181 | `docs/181-chat-v2-spec` | UX_SPEC §3 reescrito + este plano (docs only) |
| **B** — limpeza | #182 | `chore/182-limpeza-chat` | CSS morto (.provider-selector*, .usage-indicator*, duplicatas), CompactIcon órfãos, decisão sobre ui/sidebar.tsx |
| **C** — thread nas primitivas | #183 | `feat/183-thread-primitivas` | ThreadViewport/MessageGroup sobre MessagePrimitive; ChatThread custom apagado; hooks contratuais mantidos |
| **D** — passos agênticos | #184 | `feat/184-passos-agenticos` | ToolStepsCard colapsável c/ duração + ApprovalCard inline |
| **E** — composer bottom pane | #185 | `feat/185-composer-bottom-pane` | Send↔stop único, chips, fila c/ preview, status footer |
| **F** — co-localização/varredura | #186 | `chore/186-colocar-chat` | SummaryCard/UsageDialog → features/chat/ui; knip/depcruiser zero; ROADMAP atualizado |

Ordem: A ∥ B → C → D ∥ E → F. Cada fase: Issue → branch (`<tipo>/<issue>-slug`) → PR rascunho → quality gates → merge só com autorização do owner.

## Preservações obrigatórias

- `SidecarChatStore` e adaptador (`use-sidecar-runtime.tsx`) sem mudança de contrato; 13 testes do store intocados.
- Fila FIFO (ADR-21), guards sessão/epoch, modos ask/automatic/read-only, anexos textuais/PDF, resumo automático (`isSummary`), usage dialog, command palette.
- Hooks contratuais e2e: `li.message-user`, `data-testid="chat-composer"`, `data-testid="provider-chip"`, `data-testid="session-statusline"`, `menuitemradio` de permissões. Spec Playwright não é reescrito.

## Critérios transversais (todo PR)

- Biome, Knip, dependency-cruiser, commitlint verdes; Vitest ≥ 70% cobertura; Playwright verde nos fluxos críticos.
- Estilos exclusivamente Tailwind + tokens OLED/motion existentes; proibido CSS global novo no chat.
- Motion checklist (AGENTS.md §1/§4): skeleton, lazy loading se aplicável, entrada/saída, progresso, `prefers-reduced-motion`.

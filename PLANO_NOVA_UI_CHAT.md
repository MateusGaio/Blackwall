# Plano — Nova UI do Chat · shadcn/ui + assistant-ui (referência React Bits)

> Documento operacional do redesign da interface. Pré-requisito: `PLANO_LIMPEZA_DE_CASA.md`
> concluído (git reconciliado, monólitos fatiados, i18n migrado). Sem essa base, este plano não começa.

---

## Objetivo

Renovar a UI inteira com foco inicial no **chat**, entregando o polish visual e de motion que o
produto exige, mantendo intacta a identidade definida em `UX_SPEC.md` (estética Codex CLI /
Claude Code, OLED monocromático).

## Stack trancada (decisões desta análise)

| Camada | Escolha | Por quê |
|---|---|---|
| Sistema de design | **shadcn/ui** (código copiado pro repo, Radix/Base UI + Tailwind) | Open code, acessível, e o assistant-ui é distribuído nesse mesmo formato — encaixe nativo. Tailwind 4 já está nas deps (`@tailwindcss/vite`), hoje subutilizado |
| Motor do chat | **assistant-ui** (`@assistant-ui/react`) via adaptador `ExternalStoreRuntime` | Streaming, auto-scroll, retry, anexos e a11y prontos; substitui a lógica hand-rolled restante |
| Motion | CSS-first (tokens + keyframes) + lib **`motion`** somente onde exit animations/stagger justificarem | Atende checklist obrigatório sem dependência pesada desde o dia 1 |
| Efeitos | **React Bits apenas como referência visual** | Ver nota de licença abaixo |

### Nota de licença — React Bits (importante)

Licença MIT + Commons Clause: permite uso, proíbe revender o código dos componentes.
Como o Blackwall é MIT e terá publicação pública futura, **copiar arquivos verbatim é vedado**
(conflito com o constraint "todo arquivo novo mantém licença MIT" e com o gate de publicação).
Estratégia: usar o catálogo como referência e **reimplementar em monocromático** — os efeitos
precisariam ser reconvertidos para escala de cinza de qualquer jeito.

## Fora do escopo deste plano

- Esfera de partículas "A Mente" — postergada por decisão do owner; será fase própria depois.
- RAG/LanceDB, MCP, agentes/swarm — roadmap de produto (Fases 2–3), não UI.

## Constraints (reancoragem)

- Tauri v2 + React/Vite + sidecar Node/Bun travados.
- Todo componente novo de UI precisa de: skeleton, lazy loading (quando aplicável), animação de
  entrada **e saída**, indicador de progresso em ação não-instantânea, `prefers-reduced-motion`.
  Não é opcional — critério de aceite.
- Nenhuma dependência nova sem Issue com justificativa.
- Fluxo Issue → branch (`feat/<issue>-descricao`) → PR rascunho → gates → merge.
- Nenhuma tela nova fora do `UX_SPEC.md`; mudança de spec vai por PR próprio antes do código.

---

## Fase U1 — Fundação do design system · `type:enhancement`

### U1.1 — Instalação shadcn

1. Issue + branch `chore/<n>-shadcn-fundacao`.
2. `npx shadcn@latest init` criando `components.json`.
3. Mapear tokens no CSS (Tailwind v4 usa `@theme`): preservar variáveis existentes
   (`--radius-control: 8px`, `--radius-surface: 10px`, `--radius-panel: 12px`) e ligar aos tokens shadcn:

   | Token | Valor (UX_SPEC §1) |
   |---|---|
   | `--background` | `#0a0a0b` |
   | `--foreground` | `#f2f2f3` |
   | escala primária | cinzas (#77777c → #252527) |
   | bordas | 1px sólidas `#252527` (sem sombras/elevação) |
   | fonte técnica | ui-monospace (IDs de modelo, contadores, paths) |

4. Instalar só as primitivas necessárias agora: `button`, `dialog`, `popover`, `tooltip`,
   `command`, `sidebar`, `skeleton`, `progress`, `resizable`, `scroll-area`, `select`,
   `textarea`, `input`, `tabs`, `separator`.
5. Conviver com o CSS legado: classes antigas continuam funcionando até cada tela ser migrada
   (U3). Proibido big-bang.

### U1.2 — Utilitários de motion

1. Tokens: `--motion-fast: 120ms`, `--motion-base: 180ms`, `--motion-slow: 280ms` +
   easings (ease-out-quart padrão).
2. Componentes utilitários em `src/shared/components/motion/`: `<EnterExit>` (entrada **e**
   saída), `<Skeleton>` (wrapper do shadcn), `<ProgressIndicator>`.
3. Handler global `prefers-reduced-motion` (desliga transformações, mantém opacidade).

**Aceite:** Knip verde (nenhuma primitiva instalada sem uso), Biome verde, telas existentes
visualmente inalteradas.

---

## Fase U2 — Redesign do Chat · `type:feature`

O chat migra para primitivas assistant-ui estilizadas via componentes copiados (formato shadcn)
em `src/features/chat/`.

### U2.1 — Dependência nova (Issue com justificativa)

- `@assistant-ui/react` — runtime headless + primitivas Thread/Message/Composer.
- Compatibilidade a validar no PR de spike: React 19 + Vite 7 (esperado ok; biblioteca ativa).

### U2.2 — Adaptador ExternalStoreRuntime ↔ sidecar

Ponte entre o protocolo WebSocket do sidecar e o runtime do assistant-ui. Contratos a mapear:

| Comportamento atual (UX_SPEC / ADR) | Implementação no adapter |
|---|---|
| Streaming token a token com cursor piscando (§3) | `streamingContentRef` → append no adapter |
| Parar geração preservando parcial (Fase 1 roadmap) | cancelamento → flush do parcial como mensagem final |
| Fila FIFO por workspace (ADR-21) | estado "na fila" exposto ao Composer |
| Regenerar / Editar mensagem (§3) | actions nativas das primitivas |
| Erro acionável do roteador após 8 tentativas (§10, ADR-16) | mensagem formatada, nunca stack trace |
| Guard anti-vazamento entre sessões | mantém `activeSessionIdRef` na ponte |

### U2.3 — UI do chat (checklist motion em CADA componente)

- Bolhas conforme §3: usuário à direita (sutil), assistente à esquerda sem bolha.
- Composer: auto-resize, seletor de modelo estilo breadcrumb (já existe — portar), escudo de
  permissões `ask`/`automatic`/`read-only` (some no modo sem workspace), indicador de fila.
- Pill "rolar para o final" durante streaming.
- Skeleton da lista ao trocar de sessão; lazy loading do painel Vault já existente mantida.
- Efeitos inspirados em React Bits, reimplementados monocromáticos (candidatos):
  *Shiny Text* no status de streaming, *Border Beam* sutil no composer quando IA respondendo,
  transição staggerada na lista de sessões. Cada efeito = 1 Issue pequena, avaliada caso a caso.

**Aceite:**

- [ ] E2E `onboarding-chat.spec.ts` atualizado e verde no mesmo PR
- [ ] Os 5 itens do motion checklist verificados por tela (audit antes de marcar pronto)
- [ ] Sem regressão de i18n (t() em todo texto novo)
- [ ] Bundle: three.js e afins NÃO entram nesta fase

---

## Fase U3 — Rollout das demais telas · `type:enhancement`

Mesma disciplina (Issue → PR → gates → motion audit), nesta ordem:

1. **Onboarding + ProfileChooser** (`App.tsx`) — já tem progress bar e transições de card;
   portar para primitivas + tokens U1.
2. **VaultPanel** — tabs/arquivo/grafo sobre `tabs`/`resizable` shadcn; grafo d3-force intocado.
3. **Settings / ProviderManager** — formulários sobre `input`/`select`/`dialog`; UsageDashboard
   recebe `progress`/`skeleton` nativos.
4. Remoção gradual do CSS legado de `index.css` conforme cada tela migra (Knip passa a acusar
   classes mortas — limpar por tela).

---

## Fase U4 — Estética terminal do chat · `type:enhancement`

> Preferências decididas pelo owner (ago/2026). Supersedem o visual da U2.3 onde conflitarem;
> as mecânicas do §3 do `UX_SPEC.md` (parar geração, regenerar, editar, fila FIFO, pill de
> scroll) permanecem intocadas. **Escopo fechado:** apenas thread + composer (estado vazio
> incluído). Sidebar, header e Vault fora desta fase.

Decisões trancadas:

1. **Mensagens sem bolha** — usuário alinhado à direita, agente à esquerda; ambos texto flat
   com marcador de papel em mono (`›` você / `●` agente); largura máxima por mensagem
   mantida (~640px). Ganchos de teste preservados: `li.message-user`, `li.message-assistant`.
2. **Tipografia** — estrutura em mono (marcadores, status line, tool calls, código,
   contadores); a prosa das respostas continua sans-serif.
3. **Streaming** — cursor de bloco ▊ piscando no fim do stream + linha de status mono
   (`gerando…`). Efeitos *Shiny Text* / *Border Beam* da U2.3 ficam descartados.
4. **Composer** — linha de prompt com borda 1px e raio `--radius-control`, prefixo mono `❯`;
   anexos como tokens `[arquivo.md]` removíveis; auto-resize, indicador de fila e escudo de
   permissões preservados.
5. **Escopo** — thread + composer apenas; nada de sidebar/header/Vault nesta fase.

Execução: PR de documentação primeiro (amenda do UX_SPEC §3), depois Issue +
branch `feat/<n>-chat-terminal` encadeada na stack aberta (`Depends on`), gates completos
e motion audit ADR-09 nos dois componentes.

---

## Fase U5 — Cromo de sessão estilo Claude · `type:enhancement`

> Complemento da U4, decidido pelo owner (ago/2026): adaptar os padrões de interface da
> Claude (status line do Claude Code, model dropdown junto ao enviar, usage ring, painel
> de passos do Cowork) à identidade OLED e às features que o Blackwall tem e a Claude não:
> roteador com fallback (ADR-05/16), janelas de limite por provedor, fila FIFO (ADR-21)
> e rastreamento local de uso.

Mapeamento elemento Claude → adaptação Blackwall:

| Claude | Blackwall |
|---|---|
| Status line `model · ctx% · $cost` | **Linha de sessão mono** abaixo do composer: `provedor › modelo · ctx 34% [▓▓▓░░░░░░░] 68k/200k · janela 72% restante · fila N` — custo não existe (grátis) → janela de limite do roteador no lugar |
| Model dropdown junto ao enviar | **Chip `provedor › modelo`** no rodapé do composer: popover agrupado por provedor, ordem de fallback numerada (#1→n), ativo marcado; desabilitado durante streaming |
| Usage ring clicável | O **segmento ctx da linha de sessão vira botão** (`aria-haspopup="dialog"`) abrindo o `SessionUsageDialog` existente |
| Mode selector junto ao enviar | Escudo de permissões já existente — permanece no grupo do rodapé |
| Painel de passos do Cowork | **Passos de ferramenta**: parar de filtrar `role === "tool"`; cada tool call vira linha mono colapsável (`├─ read_file src/x.ts · ok`), grupo recolhido com contador ("N passos"); aprovação continua inline |

Decisões trancadas:

1. Linha de sessão **abaixo do composer**, uma linha, mono xs; zero fetch novo — consome
   `usageSummary`, `queuedCount`, `streamingStatus` que o shell já possui.
2. Custo USD fora do escopo; "janela restante" usa o menor `remainingPercent` entre as
   janelas conhecidas (`windows[].remainingPercent`).
3. O `<select>` de provedor do header é removido (fonte única de verdade = chip do composer);
   header fica com sidebar-toggle + breadcrumb + título + Vault.
4. Passos de ferramenta recolhidos por padrão; modo Verboso/Normal/Resumo fica documentado
   como pendência futura.
5. Ganchos do e2e preservados (`chat-composer`, `menuitemradio` de permissões,
   `li.message-user`) e novos `data-testid`: `session-statusline`, `provider-chip`.
6. i18n completo pt-BR/en para todo texto novo.

Execução: Issue + branch `feat/<n>-session-chrome` encadeada na branch da U4, gates completos,
motion audit ADR-09 (EnterExit na linha/grupos, reduced-motion).

## Riscos

| Risco | Mitigação |
|---|---|
| Conflito CSS legado × Tailwind durante convivência | Escopo por tela; nenhuma classe global renomeada na U1 |
| Adapter do WS revelar acoplamento residual do shell | H2 concluída é pré-requisito duro |
| Scope creep de efeitos visuais | Cada efeito é Issue separada, avaliada e auditável |

## Issues a criar antes de executar

| Issue sugerida | Label |
|---|---|
| Fundação shadcn + tokens OLED | `type:enhancement` |
| Utilitários de motion (tokens, EnterExit, reduced-motion global) | `type:enhancement` |
| Spike/adoção assistant-ui + adapter ExternalStoreRuntime | `type:feature` |
| Redesign do chat (Thread/Message/Composer) | `type:feature` |
| Um Issue por tela no rollout (onboarding, vault, settings) | `type:enhancement` |
| Estética terminal do chat (thread+composer) | `type:enhancement` |
| Cromo de sessão estilo Claude (status line, chip de provedor, passos) | `type:enhancement` |

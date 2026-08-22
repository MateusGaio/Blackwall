> **[Arquivado em 2026-08-22]** Documento de execução já concluído — mantido como registro histórico.
> Estado atual do projeto: veja `ROADMAP.md` na raiz.

# Prompt de continuação — Executar Fase U2 (assistant-ui + adaptador + redesign do chat)

> Copie todo o bloco abaixo como primeira mensagem da nova sessão do agente.
> O agente também pode simplesmente receber: "Leia PROMPT_EXECUCAO_U2.md e execute."

---

Atuando como **Agente de Frontend/Design System** no repositório Blackwall (`~/Desktop/Blackwall harness second Try/Blackwall`), execute a **Fase U2** do `PLANO_NOVA_UI_CHAT.md`, com checkpoints. U3 (rollout das demais telas) está fora do escopo.

## 0. Ancoragem de constraints

- Stack travada: Tauri v2 + React/Vite + sidecar Node/Bun. React 19, Vite 7, Tailwind 4 (`@tailwindcss/vite`), react-i18next.
- **Diferença crítica vs U1:** nesta fase entra **uma** dependência nova planejada — `@assistant-ui/react` (runtime headless + primitivas Thread/Message/Composer). Ela exige **Issue própria com justificativa** (AGENTS.md §1: sem dependência nova sem necessidade clara). Nada além disso (proibido three.js, framer-motion, jsdom etc.). Efeitos "React Bits" são **reimplementados** localmente, nunca instalados.
- Licença MIT: cabeçalho em todo arquivo novo de código.
- Todo texto novo de UI/aria-label passa por `t()` com chave em pt-BR **e** en.
- Motion não é opcional (ADR-09): skeleton, lazy quando aplicável, entrada **e** saída, progresso, `prefers-reduced-motion` — checklist em CADA componente novo. Consumir os utilitários da U1 (`<EnterExit>`, `<Skeleton>`, `<ProgressIndicator>` de `src/shared/components/motion/`) em vez de reinventar.
- Fluxo: Issue → branch → commits convencionais → gates → PR rascunho → merge só com autorização explícita do owner.

## 1. Leitura obrigatória antes de codar

`AGENTS.md` · `UX_SPEC.md` (**§3 chat é o contrato desta fase**, §10 erros do roteador, §13 streaming interrompido) · `PLANO_NOVA_UI_CHAT.md` (Fase U2 é o escopo) · `ARCHITECTURE.md` (ADR-09 motion, ADR-16 retry do roteador, ADR-21 fila de mensagens).

## 2. Estado verificado do repo (não refazer esta análise)

- **PR #141 (Fase U1) existe como rascunho e ainda NÃO foi mergeado** na análise original; CI `check`/`e2e`/`rust` verdes. Branch: `chore/140-shadcn-fundacao`. Regra do AGENTS.md §2.3: PRs dependentes declaram `Depends on #141` e usam a branch anterior como base até ela integrar. **Antes de criar branches, verifique o estado atual de #141**: se já mergeada na `main`, baseie tudo na `main` atualizada; se não, baseie em `chore/140-shadcn-fundacao`.
- Fundação U1 disponível nessa base: `components.json` (estilo radix-nova), 17 primitivas em `src/shared/components/ui/` (+ smoke test `primitives.test.tsx`), utilitários em `src/shared/components/motion/`, tokens OLED no topo de `src/styles/index.css` (tema permanente escuro; classe `.dark` nunca aplicada), alias `@/*` configurado em todos os tsconfigs/vite/vitest.
- Baseline local: **143 testes** Vitest (~2s) · Knip limpo · depcruise limpo · Biome com apenas os 3 warnings pré-existentes de especificidade em `index.css` · E2E único verde (`onboarding-chat.spec.ts`; portas: dev 1420, e2e 1421, sidecar mock 1423).
- Chat atual: `src/app/WorkspaceShell.tsx` + módulos em `src/app/shell/` (`ChatHeader`, `Composer`, `MessageList`, `SessionsSidebar`, `Dialogs`, `VaultSlot`, `useStreamingChat`). A ponte de streaming hoje vive em `useStreamingChat.ts` (`activeSessionIdRef`, `streamingContentRef`).
- Contratos do sidecar tipados em `src/shared/api/sidecar.ts` (`ChatMessage`, `StoredMessage`, `Session`, `WorkspaceToolApproval`, etc.). WebSocket único do sidecar (ADR-11).
- i18n completo (pt-BR/en) em `src/i18n.ts`; namespaces existentes incluem `chat.*`, `composer.*`, `sessions.*`, `motion.*`. Proibido reintroduzir string hardcoded.
- CSS legado intacto por design: classes `.app-shell`, `.workspace-shell` etc. continuam funcionando até a U3. Ao migrar uma tela para primitivas, os estilos novos saem de tokens/utilities Tailwind, não de classes globais novas no `index.css`.

## 3. Tarefa U2.1 — Adoção assistant-ui (Issue própria primeiro, label `type:feature`)

1. Issue descrevendo a justificativa da dependência `@assistant-ui/react`: runtime headless que evita reimplementar Thread/Message/Composer/streaming-state; alternativa seria manter hooks manuais (custo de manutenção alto, já comprovado pelos 1k+ linhas do shell antigo).
2. Branch `feat/<n>-assistant-ui-spike` a partir da base definida na seção 2.
3. Instalar e validar compatibilidade: React 19 + Vite 7 + Tailwind 4 + tema via tokens U1 (sem `@layer` próprio conflitante). Documentar no PR qualquer ajuste.
4. Estilização via componentes copiados (formato shadcn) em `src/features/chat/` — nada de importar CSS empacotado do assistant-ui.
5. Se o spike revelar bloqueio real (ex.: peer dep incompatível com React 19), PARAR e reportar ao owner antes de forçar alternativas.

## 4. Tarefa U2.2 — Adaptador ExternalStoreRuntime ↔ sidecar (mesma Issue ou Issue seguinte, `Refs`/`Closes` coerentes)

Ponte entre o WebSocket do sidecar e o runtime do assistant-ui. Mapear (tabela do plano):

| Comportamento atual | Implementação no adapter |
|---|---|
| Streaming token a token com cursor piscando (UX_SPEC §3) | `streamingContentRef` → append no adapter |
| Parar geração preservando parcial | cancelamento → flush do parcial como mensagem final |
| Fila FIFO por workspace (ADR-21) | estado "na fila" exposto ao Composer |
| Regenerar / Editar mensagem (§3) | actions nativas das primitivas |
| Erro acionável do roteador após 8 tentativas (§10, ADR-16) | mensagem formatada, nunca stack trace |
| Guard anti-vazamento entre sessões | mantém `activeSessionIdRef` na ponte |

- Ponto de partida: `src/app/shell/useStreamingChat.ts` (lógica hoje testada por `composer.test.ts`/testes existentes — nenhum teste pode quebrar).
- O adaptador precisa cobrir **entrada e saída** de mensagens com `<EnterExit>` desde este momento (a saída animada é o item mais valioso herdado da U1 — não adiar para U2.3).
- Erros: usar variação de cinza + ícone (token `--destructive` monocromático da U1), texto acionável via `t()`.

## 5. Tarefa U2.3 — UI do chat (checklist motion em CADA componente)

Issue própria (`type:feature`), branch `feat/<n>-redesign-chat`.

- Bolhas conforme §3: usuário à direita (sutil), assistente à esquerda **sem bolha**.
- Composer: auto-resize, seletor de modelo estilo breadcrumb (já existe — portar para primitivas `popover`/`command` da U1), escudo de permissões `ask`/`automatic`/`read-only` (some no modo sem workspace), indicador de fila (estado do adapter U2.2).
- Pill "rolar para o final" durante streaming.
- Skeleton da lista ao trocar de sessão (`<Skeleton>` da U1); lazy loading do painel Vault mantido.
- Efeitos inspirados em React Bits, reimplementados monocromáticos (candidatos, CADA um = 1 Issue pequena separada, avaliada caso a caso): *Shiny Text* no status de streaming, *Border Beam* sutil no composer quando IA respondendo, transição staggerada na lista de sessões. Não implementar nenhum deles neste PR sem Issue própria.
- Critérios de aceite da fase (do plano):
  - [ ] E2E `onboarding-chat.spec.ts` atualizado e verde **no mesmo PR**
  - [ ] Os 5 itens do motion checklist verificados por tela (audit antes de marcar pronto)
  - [ ] Sem regressão de i18n (`t()` em todo texto novo, chaves em pt-BR e en)
  - [ ] Bundle: three.js e afins NÃO entram (`npm run build` e inspecionar tamanhos)
  - [ ] Telas fora do chat permanecem intocadas (U3 cuida delas)

## 6. Gates e verificação (por commit e no fim)

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run test          # 143 testes baseline — nenhum pode quebrar; novos testes p/ adapter
npm run knip          # zero primitiva/export órfão
npm run lint          # só os 3 warnings pré-existentes de index.css
npm run depcruise     # fronteira UI ↔ sidecar continua valendo (adapter fala com shared/api, nunca direto com sidecar/)
npm run build         # checar bundle (sem three.js/dep pesada)
npm run e2e           # antes de abrir o PR (reuseExistingServer: false — feche qualquer dev server; spec sobe o próprio server na 1421)
```

Aceite da fase: chat redesignado sobre primitivas assistant-ui + tokens/motion U1 · adapter sem vazamento entre sessões · E2E verde · CI `check`/`e2e`/`rust` passando no PR.

## 7. Lições desta base (economizam horas — herdadas da execução da U1)

- Depois de edições grandes: `npx biome check --write <arquivos>` — ordenação de imports e formatação reclamam.
- Rodapé de commit precisa linha em branco antes de `Closes #N` (commitlint avisa).
- Knip acusa exports/types órfãos — exporte só o que outro módulo consome. Smoke tests contam como consumo (ponto cego intencional usado pelas primitivas da U1); se instalar primitiva nova do shadcn, estenda `primitives.test.tsx`.
- O parser CSS do Biome já está com `tailwindDirectives: true` (blocos `@theme`/`@custom-variant` passam); código vendado em `src/shared/components/ui/**` tem override de lint próprio — não editar estilo desses arquivos à mão.
- API nova do `react-resizable-panels` v4 usa `orientation`, não `direction`. Radix Progress não emite `aria-valuenow` em SSR — nos testes, asserte o `transform` do indicador.
- Testes são SSR (`renderToStaticMarkup`), **sem jsdom**: desenhe componentes com estados iniciais testáveis; efeitos colaterais (ex.: timers de saída do `<EnterExit>`) não são cobertos por unit tests aqui.
- O e2e usa `reuseExistingServer: false` — feche qualquer `npm run dev` antes de rodá-lo.
- Proteção da `main`: 1 approving review + checks obrigatórios; owner não auto-aprova. Merge exige autorização explícita dele na sessão ou aprovação do colaborador `herick-gonzaga`.
- Antes de ações remotas: `gh auth status`.

## 8. Relatório final esperado

Lista de dependências adicionadas (com justificativa por item — `@assistant-ui/react` deve ser a única fora do conjunto shadcn), arquivos novos/tocados, tabela do adapter preenchida com os nomes reais dos eventos do WS encontrados no sidecar, resultado do motion audit por tela (5 itens ADR-09), confirmação de que telas fora do chat não mudaram, resultado dos 6 gates + CI, link(s) do(s) PR(s), e pendências de decisão do owner (incluindo os efeitos React Bits candidatos que ficarem para Issues separadas).

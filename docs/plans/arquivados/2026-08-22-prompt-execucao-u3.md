> **[Arquivado em 2026-08-22]** Documento de execução já concluído — mantido como registro histórico.
> Estado atual do projeto: veja `ROADMAP.md` na raiz.

# Prompt de continuação — Executar Fase U3 (rollout das demais telas + remoção do CSS legado)

> Copie todo o bloco abaixo como primeira mensagem da nova sessão do agente.
> O agente também pode simplesmente receber: "Leia PROMPT_EXECUCAO_U3.md e execute."

---

Atuando como **Agente de Frontend/Design System** no repositório Blackwall (`~/Desktop/Blackwall harness second Try/Blackwall`), execute a **Fase U3** do `PLANO_NOVA_UI_CHAT.md`, com checkpoints e **um Issue por tela, na ordem fixa abaixo**. Nada além da U3 neste trabalho.

## 0. Ancoragem de constraints

- Stack travada: Tauri v2 + React/Vite + sidecar Node/Bun. React 19, Vite 7, Tailwind 4 (`@tailwindcss/vite`), react-i18next.
- **Zero dependências novas nesta fase.** Todas as primitivas necessárias já estão instaladas (button, dialog, popover, tooltip, command, sidebar, skeleton, progress, resizable, scroll-area, select, textarea, input, tabs, separator). Se algo estiver faltando para uma tela: PARAR e reportar ao owner antes de instalar qualquer coisa.
- Licença MIT: cabeçalho em todo arquivo novo de código.
- Todo texto novo/alterado de UI/aria-label passa por `t()` com chave em pt-BR **e** en (os namespaces `onboarding.*`, `settings.*`, `vault.*`, `usage.*` já existem — reusar).
- Motion ADR-09 por tela: skeleton, lazy quando aplicável, entrada **e** saída (`<EnterExit>`), progresso (`<ProgressIndicator>`), `prefers-reduced-motion`. Consumir os utilitários de `src/shared/components/motion/` e as primitivas de `src/shared/components/ui/` — nada de CSS global novo para telas migradas.
- Fluxo: Issue → branch → commits convencionais → gates → PR rascunho → merge só com autorização explícita do owner.

## 1. Leitura obrigatória antes de codar

`AGENTS.md` · `UX_SPEC.md` (**agora ele é o contrato de TODAS as telas**: §4 empty states, §5 dois grafos/página Agentes, §6 dashboard, §7 Soul obrigatória, §8 onboarding, §9 ações destrutivas, §11 responsivo, §12 teclado) · `PLANO_NOVA_UI_CHAT.md` (Fase U3) · `ARCHITECTURE.md` (ADR-09 motion).

## 2. Estado verificado do repo (não refazer esta análise; revalidar só o que está marcado)

- **Dependências de PR:** U1 = PR #141 (`chore/140-shadcn-fundacao`) com fundação shadcn + tokens OLED + motion utils; U2 = redesign do chat (assistant-ui + adapter). **No início da sessão verifique o estado real de #141 e do PR da U2**: só baseie branches na `main` atualizada quando ambos estiverem mergeados; caso contrário, declare `Depends on #N` e use a branch anterior como base (AGENTS.md §2.3).
- Fundação disponível: tokens no topo de `src/styles/index.css` (tema permanente escuro), 17 primitivas em `src/shared/components/ui/` (+ smoke test `primitives.test.tsx` que mantém o Knip verde — estendê-lo se consumir primitiva nova), motion em `src/shared/components/motion/`.
- Inventário das telas a migrar (contagem de linhas pode ter mudado ~pouco desde a U1):
  - **Onboarding + ProfileChooser:** `src/app/App.tsx` (~693 linhas). Já tem progress bar própria e transições de card → substituir por `<ProgressIndicator>`/`<EnterExit>`.
  - **Vault:** `src/features/vault/components/VaultPanel.tsx` (~589 linhas). Grafo **d3-force fica intocado** (ADR/produto); tabs/arquivo/lista migram para `tabs`/`resizable`/`scroll-area`.
  - **Settings / ProviderManager:** `src/features/config/components/ProviderManager.tsx` + módulos fatiados em `provider-manager/` (ProfileSettings, ProviderFormSection, ProviderList, WorkspacesSection, hooks de form); formulários migram para `input`/`select`/`dialog`.
  - **Dashboard de uso:** `src/features/config/components/UsageDashboard.tsx` + `src/app/SessionUsageDialog.tsx` → recebem `progress`/`skeleton` nativos.
  - **Compartilhados:** `ConfirmDialog.tsx` (~62 linhas, portar para primitiva `dialog` — cobre UX_SPEC §9 ações destrutivas), `SoulPicker.tsx` (~75 linhas), **CommandPalette legada dentro de `src/app/shell/Dialogs.tsx`** (classe `.command-palette`, query manual) → portar para a primitiva `command` dentro de `dialog` (UX_SPEC §2, Cmd/Ctrl+K).
- Baseline local na época da U1: **143 testes** Vitest · Knip limpo · depcruise limpo · Biome com exatamente **3 warnings pré-existentes de especificidade nos blocos legados de `index.css`** · E2E único verde (`onboarding-chat.spec.ts`; portas dev 1420 / e2e 1421 / sidecar mock 1423). **Revalide os números na main atual** — a U2 deve ter adicionado testes do adapter.
- i18n completo (pt-BR/en) em `src/i18n.ts`. Proibido string hardcoded.

## 3. Ordem de execução (mesma disciplina por tela: Issue → PR rascunho → gates)

### Tela 1 — Onboarding + ProfileChooser (`type:enhancement`)
Branch `feat/<n>-onboarding-primitivas`. Portar `App.tsx` para primitivas/tokens U1: cards sobre superfícies com raio `surface`, progress bar → `<ProgressIndicator>`, transições de entrada/saída de etapas → `<EnterExit>`. **Atenção:** o e2e `onboarding-chat.spec.ts` exercita exatamente este fluxo — preservar ganchos de teste (data-testid/textos assertados) e manter o spec verde no mesmo PR.

### Tela 2 — Vault (`type:enhancement`)
Branch `feat/<n>-vault-primitivas`. Tabs arquivo/grafo sobre `tabs`; painéis redimensionáveis sobre `resizable`; listas longas sobre `scroll-area`. Grafo d3-force intocado (só o contêiner/painel muda). Estados vazios conforme UX_SPEC §4.

### Tela 3 — Settings / ProviderManager / Usage / Diálogos (`type:enhancement`)
Branch `feat/<n>-settings-primitivas`. Formulários sobre `input`/`select` (validação atual preservada); diálogos sobre `dialog` (inclui `SessionUsageDialog` e o port do `ConfirmDialog`); `UsageDashboard` recebe `<ProgressIndicator>`/`<Skeleton>` nativos; CommandPalette legada → primitiva `command` dentro de `dialog`, mantendo Cmd/Ctrl+K e os destinos atuais. Escudo de permissões e seletor de modelo NÃO são desta fase (já foram no chat/U2).

Cada PR sai com: motion audit (5 itens ADR-09) na tela migrada · confirmação de que as OUTRAS telas não mudaram · gates verdes.

## 4. Remoção gradual do CSS legado (passo final de cada tela)

- Conforme cada tela migra, remover do `index.css` **apenas** os blocos mortos dela — proibido big-bang.
- **Correção importante vs plano:** o Knip NÃO enxerga classes CSS (ele analisa exports/deps). Antes de remover cada bloco, verificar uso real com grep: `grep -rn "nome-da-classe" src/ --include="*.tsx" --include="*.ts"`. Zero usos = removível.
- Os 3 warnings pré-existentes do Biome vivem nesses blocos legados: eles desaparecem naturalmente conforme a remoção avança. Ao final da fase, `npm run lint` deve ficar com **0 warnings**.
- Tokens/motion/blocos novos no topo do arquivo NUNCA são tocados.

## 5. Gates e verificação (por commit e por PR)

```bash
npx tsc -p tsconfig.app.json --noEmit
npm run test          # baseline atual + nenhum quebrado
npm run knip          # zero órfão (lembrar do smoke test das primitivas)
npm run lint          # warnings só nos blocos legados ainda não removidos
npm run depcruise
npm run build         # sem deps novas; d3-force permanece
npm run e2e           # reuseExistingServer: false — feche dev servers antes
```

Aceite da fase: todas as telas sobre primitivas/tokens U1 · CSS legado zerado ou restrito ao que ainda tem uso real · Knip/lint/depcruise limpos · CI `check`/`e2e`/`rust` passando em cada PR.

## 6. Lições herdadas (U1/U2 — economizam horas)

- Depois de edições grandes: `npx biome check --write <arquivos>`.
- Rodapé de commit: linha em branco antes de `Closes #N`.
- Exporte só o que outro módulo consome (Knip acusa); smoke tests contam como consumo — se usar primitiva até agora não consumida, adicione-a ao `primitives.test.tsx` antes de mais nada.
- Testes são SSR (`renderToStaticMarkup`), sem jsdom: estados iniciais testáveis; timers de saída não são cobertos por unit tests.
- Radix Progress em SSR não emite `aria-valuenow` — asserte o transform do indicador. `react-resizable-panels` v4 usa `orientation`.
- Código vendado em `src/shared/components/ui/**` tem override de lint — não editar estilo à mão nesses arquivos.
- O parser CSS do Biome já aceita `@theme`/`@custom-variant` (`tailwindDirectives: true`).
- O e2e sobe o próprio server (`reuseExistingServer: false`) — nada rodando nas portas 1421/1423.
- Proteção da `main`: 1 approving review + checks; merge só com autorização explícita do owner na sessão ou aprovação de `herick-gonzaga`.
- Antes de ações remotas: `gh auth status`.

## 7. Relatório final esperado

Por tela/PR: dependências usadas (deve ser ZERO nova), arquivos novos/tocados, resultado do motion audit (5 itens), evidência de delta nas outras telas (nenhum), blocos CSS legados removidos (com o grep de verificação), resultado dos 6 gates + CI, link do PR. No fim da fase: estado final de `index.css` (linhas antes/depois), lint em 0 warnings, pendências de decisão do owner.

> **[Arquivado em 2026-08-22]** Documento de execução já concluído — mantido como registro histórico.
> Estado atual do projeto: veja `ROADMAP.md` na raiz.

# Plano de Limpeza de Casa — Blackwall

> Documento operacional para resolver todas as pendências estruturais identificadas na análise de 2026-08-21.
> Nenhuma mudança visual aqui — esta é a fundação para o redesign da UI (`PLANO_NOVA_UI_CHAT.md`).

---

## Contexto

O redesign da UI inteira exige uma base limpa: monólitos fatiados, i18n real, git reconciliado.
Fazer o redesign sobre o estado atual multiplicaria conflitos e retrabalho.

## Constraints (reancoragem)

- Stack travada: Tauri v2 + React/Vite + sidecar Node/Bun. Nada disso muda neste plano.
- Fluxo obrigatório: Issue → branch (`chore/<issue>-descricao`) → PR em rascunho → quality gates → merge.
- Proibido push direto na `main`.
- Zero dependências novas nesta fase de limpeza.
- Todo PR atualiza os specs do Playwright **no mesmo PR** se tocar fluxo crítico.

## Estado verificado (2026-08-21)

| Item | Estado |
|---|---|
| Suíte Vitest | ✅ Verde — 26 arquivos, 124 testes, ~2s |
| E2E Playwright | ✅ 1 spec completo (onboarding → Vault → chat → persistência → permissões/agente) |
| `main` local vs `origin/main` | 10 commits à frente, 0 atrás |
| Descoberta-chave | Os 10 commits **já estão no remoto** como tip da branch `feat/129-ui-assistant-ui` (`2fd8474`, idêntico à `main` local). Reconciliação = abrir PR dessa branch |
| Branches locais | 49 no total; 41 já merged na `main`; 8 não merged (avaliar antes de apagar) |
| `gh auth` | ✅ Válido (conta MateusGaio) |

---

## Fase H1 — Reconciliação do git · `chore`

### Passos

1. Criar Issue de housekeeping (template padrão, label `type:enhancement` ou `type:bug` conforme sub-tarefa).
2. Abrir PR: `feat/129-ui-assistant-ui` → `main`.
   - Os 10 commits são trabalho do owner já publicado na branch; o PR formaliza a entrada na `main` conforme regra da seção 2.0 do AGENTS.md.
   - Descrição: `Closes #129` (ou `Refs #129` se a Issue continuar aberta).
   - Validar antes: `git remote -v`, `gh auth status`, `git status --short --branch`, `git diff --check`.
3. Após aprovação e merge (pelo owner): `git checkout main && git pull origin main`.
4. Podar branches merged:
   ```bash
   git branch --merged main | grep -vE "main|\*" | xargs git branch -d
   ```
5. Listar as não merged e decidir caso a caso (nunca `-D` sem revisar):
   ```bash
   git branch --no-merged main
   ```
6. Limpar refs remotas órfãs: `git fetch --prune`.

### Aceite

- [ ] `main` local == `origin/main` (`git rev-list --count main..origin/main` → 0 dos dois lados)
- [ ] Só restam branches locais em uso ativo
- [ ] `git status` limpo

---

## Fase H2 — Decomposição do WorkspaceShell · `type:refactor`

**Alvo:** `src/app/WorkspaceShell.tsx` (1.905 linhas) e depois `ProviderManager.tsx` (1.052 linhas).
Regra de ouro: **zero mudança visual**, comportamento idêntico, testes verdes a cada extração.

### Mapa de extração (fronteiras confirmadas na leitura do código)

| Novo módulo | Conteúdo | ~Linhas |
|---|---|---|
| `src/app/shell/useStreamingChat.ts` | Bloco streaming/generateResponse/submit + refs críticos (`activeSessionIdRef`, `streamingContentRef`, `pendingToolDecision`) | 140 |
| `src/app/shell/SessionsSidebar.tsx` | Sidebar esquerda + menu de ações da sessão | 200 |
| `src/app/shell/ChatHeader.tsx` | Badge/popover de usage + seletor de provedor/modelo | 155 |
| `src/app/shell/MessageList.tsx` | Lista de mensagens, form de edição, action bar, bolha de streaming com cursor | 130 |
| `src/app/shell/Composer.tsx` | Textarea auto-resize + popover de permissões (`ask`/`automatic`/`read-only`) | 150 |
| `src/app/shell/VaultSlot.tsx` | Painel do Vault + handle de resize | 70 |
| `src/app/shell/dialogs/RenameDialog.tsx`, `CommandPalette.tsx` | Diálogos hoje inline | 90 |

### Riscos mapeados (preservar durante a extração)

1. **Guard de sessão:** `activeSessionIdRef` impede vazamento de conteúdo entre sessões durante streaming — qualquer hook extraído deve mantê-lo.
2. **Aprovação de ferramentas:** cruza 3 refs mutáveis (`pendingToolDecision` etc.) — extrair junto no `useStreamingChat`, não espalhar.
3. **Auto-scroll:** `useEffect` roda sem array de deps (todo render) — oportunidade de corrigir com deps corretas sem mudar comportamento observável.

### Ordem sugerida de PRs (um por extração)

1. Hook `useStreamingChat` (maior risco primeiro, enquanto o resto está intacto)
2. `SessionsSidebar`
3. `Composer` + `MessageList`
4. `ChatHeader` + dialogs
5. `VaultSlot`
6. Decomposição do `ProviderManager` (mesma estratégia: hooks + subcomponentes)

### Aceite por PR

- [ ] 124 testes Vitest verdes (nenhum teste alterado, salvo imports)
- [ ] E2E `onboarding-chat.spec.ts` verde
- [ ] `npm run lint && npm run knip && npm run depcruise` verdes
- [ ] Delta visual zero (revisão manual nas telas: onboarding, chat, vault, settings)

---

## Fase H3 — Migração i18n real · `type:refactor`

**Estado atual:** ~270 ternários manuais (`isEnglish ? ... : ...`) — 234 só nos 6 maiores arquivos — e exatamente **1** string via `t()` (`brand.note`). Recursos inline em `src/i18n.ts` (fallback `pt-BR`). Nenhum JSON de tradução.

### Definição de `isEnglish` a eliminar (9 pontos)

`WorkspaceShell.tsx:240` · `App.tsx:56` e `:177` · `ConversationSummaryCard.tsx:21` (prop) · `VaultPanel.tsx:68` e `:468` · `ProviderManager.tsx:114` · `ProviderSetup.tsx:16` · `SoulPicker.tsx:25`

### Passos

1. Estruturar recursos por namespace em `src/i18n.ts` (ou migrar para JSON importado):
   `onboarding.*`, `profileChooser.*`, `chat.*`, `composer.*`, `sessions.*`, `vault.*`, `settings.*`, `usage.*`, `errors.*`.
2. Migrar arquivo por arquivo (um PR por arquivo grande), aproveitando que os módulos já estão fatiados pela H2:

   | Arquivo | Ternários |
   |---|---|
   | `WorkspaceShell.tsx` + módulos `shell/*` | 94 |
   | `ProviderManager.tsx` | 55 |
   | `UsageDashboard.tsx` | 37 |
   | `VaultPanel.tsx` | 21 |
   | `App.tsx` | 20 |
   | `ProviderSetup.tsx` | 7 |
   | Demais (`SoulPicker`, `ConfirmDialog`…) | resto |

3. Remover props `locale`/`isEnglish` que só serviam para escolher texto; `useTranslation()` assume.
4. **Não tocar** na lógica de saudações (`greetings.ts`) — ela tem teste próprio cobrindo 25 idiomas e é intencionalmente independente do locale da UI.
5. Manter comparações legítimas de locale (normalização `setLocale`, `aria-pressed`, className).

### Aceite

- [ ] `grep -rn "isEnglish ?" src/` retorna apenas casos documentados como legítimos
- [ ] Todas as strings de UI resolvidas via `t()` em ambos os locales
- [ ] Knip verde; testes existentes atualizados e verdes; e2e verde

---

## Estratégia de e2e durante todo o plano

Os quality gates fazem o Playwright bloquear merge de PR que toca fluxo crítico. Portanto:

- Cada PR que altera seletores/textos de telas críticas atualiza `e2e/onboarding-chat.spec.ts` **no mesmo PR**.
- Rodar localmente antes de abrir o PR:
  ```bash
  npm run e2e        # sobe dev server na porta 1421 com mock de provedor
  ```
- Se um PR intermediário da H2/H3 não alterar comportamento visível, o spec não muda — é o sinal de que a refactor foi neutra.

## Gates obrigatórios em todos os PRs (resumo do AGENTS.md)

Biome · Knip · dependency-cruiser · commitlint · Vitest · Codecov · Playwright (fluxo crítico).

## Issues a criar antes de executar

| Issue sugerida | Label | Cobertura |
|---|---|---|
| "Reconciliar main com feat/129 e podar branches" | `type:chore` | H1 |
| "Decompor WorkspaceShell em módulos shell/" | `type:refactor` | H2 (PRs 1–5 referenciam) |
| "Decompor ProviderManager" | `type:refactor` | H2 (PR 6) |
| "Migrar strings de UI para react-i18next" | `type:refactor` | H3 |

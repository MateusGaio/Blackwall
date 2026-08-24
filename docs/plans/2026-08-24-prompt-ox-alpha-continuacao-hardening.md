# Prompt de continuação — OX ALPHA — hardening de permissões, harness e provas de UI

> Use este documento inteiro como instrução de execução. Esta é a continuação direta do lote iniciado pelas Issues #208–#214. Não refaça o que já está correto e não declare a missão concluída antes de resolver as divergências encontradas na auditoria independente.

---

## 0. Papel, público-alvo e missão

Você é **OX ALPHA**, atuando como Staff Engineer de segurança, arquitetura de agentes e frontend do Blackwall.

O público-alvo da entrega é:

- Mateus, mantenedor e responsável pelas decisões de produto/segurança;
- revisores dos Draft PRs #213, #215 e #216;
- contribuidores que continuarão as Issues #210, #211 e #214;
- usuários que precisam de um harness local-first previsível, seguro e capaz de finalizar tarefas sem parar silenciosamente.

Sua missão é **corrigir os pontos ainda abertos ou superestimados no relatório anterior**, completar o escopo tecnicamente autorizado e deixar toda limitação restante ligada a uma decisão explícita do mantenedor.

Não faça merge, release, deploy ou alteração de visibilidade do repositório.

### Saída obrigatória

Entregue:

1. commits adicionais nas branches/PRs existentes, sem apagar trabalho já publicado;
2. testes que falhem antes e passem depois para cada correção;
3. atualização das Issues e Draft PRs com evidência real, não inferida;
4. corpus e runner de evals da Issue #211, se as dependências de #210 estiverem prontas;
5. relatório final em português, com no máximo 2.000 palavras, no formato da seção 15.

---

## 1. Como trabalhar

1. Leia tudo antes de editar.
2. Pense passo a passo internamente; publique apenas checkpoints curtos com evidência, decisão, risco e próximo passo.
3. Execute na ordem da seção 11.
4. Não esconda falha atrás de comentário no código ou nome de teste.
5. Um teste só prova exatamente o que ele mede.
6. Se a implementação demonstrar causa diferente, atualize Issue/plano antes de continuar.
7. Não adicione dependência sem provar necessidade e obter aprovação quando exigida.
8. Não use force push, rebase destrutivo ou exclusão de branch sem autorização explícita.

---

## 2. Restrições fixas

Reafirme estas restrições no início de cada checkpoint:

- stack travada: Tauri v2/Rust + React/Vite + sidecar Node/Bun/TypeScript;
- Python somente para LoRA no roadmap do produto;
- licença MIT e cabeçalho do projeto em código novo;
- local-first e zero telemetria por padrão;
- nunca exportar prompt, resposta, arquivo, path, args, stdout, stderr, chave ou identificador pessoal;
- `shell: false`, validação de path real, bloqueio de traversal/symlink e limites de tempo/saída continuam obrigatórios;
- escolher Automático não remove invariantes de segurança;
- não rodar `drizzle-kit generate`; migração é manual conforme o repositório;
- preservar fila FIFO, guards de sessão/epoch, pares tool call/result e cancelamento por Stop;
- UI alterada exige skeleton quando aplicável, progresso, motion intencional e `prefers-reduced-motion`;
- preservar `li.message-user`, `chat-composer`, `provider-chip`, `session-statusline` e contratos acessíveis, salvo migração completa no mesmo PR;
- Biome, Knip, dependency-cruiser, Vitest, build e Playwright crítico bloqueiam conclusão.

---

## 3. Leitura obrigatória e precedência

Leia integralmente:

1. `AGENTS.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `UX_SPEC.md`
5. `SECURITY.md`
6. `CONTRIBUTING.md`
7. `.github/ISSUE_TEMPLATE/*.md`
8. `.github/PULL_REQUEST_TEMPLATE.md`
9. `docs/plans/2026-08-24-prompt-ox-alpha-fluidez-harness-ui.md`
10. este documento

Precedência:

1. solicitação explícita mais recente do mantenedor;
2. segurança/privacidade;
3. `AGENTS.md`;
4. documentos canônicos;
5. este prompt;
6. relatório anterior;
7. implementação atual.

O relatório anterior não é fonte de verdade quando contradiz código ou teste.

---

## 4. Estado inicial conhecido — confirme novamente

Snapshot local observado após a primeira execução:

| Pacote | Branch | Commit(s) observados |
|---|---|---|
| UI 1–7 | `fix/208-vault-comandos-modelos` | `816673b` |
| Permissões 8 | `fix/209-permissoes-automaticas` | `5bdaa68` |
| Harness 9 | `feat/210-agent-loop-resiliente` | `e47e457`, `fd60ddb`, `e646a93` |
| Evals | `chore/211-evals-harness` | branch existe, mas aponta para a base sem commit próprio |

Ancestralidade observada:

- UI e permissões são pacotes paralelos sobre `feat/202-vault-arvore-toggle`;
- harness está empilhado sobre permissões;
- evals ainda não incorpora o harness.

O worktree observado tinha somente estes arquivos não rastreados:

- `docs/plans/2026-08-24-prompt-ox-alpha-fluidez-harness-ui.md`;
- este prompt, depois de criado.

Preserve ambos.

### Estado dos gates já confirmado localmente

- Vitest: 192/192 passando na branch `feat/210-agent-loop-resiliente`;
- Biome: passando;
- Knip: passando;
- dependency-cruiser: passando, 176 módulos e 601 dependências na execução auditada;
- build frontend + sidecar: passando, com aviso não bloqueador de chunk acima de 500 kB.

Esses resultados não substituem nova execução após suas mudanças.

### GitHub

Os links relatados foram:

- épico #212;
- UI #208 / Draft PR #213;
- permissões #209 / Draft PR #215;
- harness #210 / Draft PR #216;
- evals #211;
- sandbox #214.

No ambiente da auditoria, `gh auth status` informou token inválido e os links privados não puderam ser verificados. Revalide. Se continuar inválido:

- trabalhe localmente nas branches corretas;
- não invente estado remoto;
- entregue comandos/texto para o mantenedor atualizar Issues/PRs;
- não tente substituir credenciais nem publicar por outro repositório.

---

## 5. Divergências confirmadas — trate como bugs, não sugestões

### P0 — a janela TOCTOU de permissão não foi fechada

Em `sidecar/src/tools.ts`, `executeTool`:

1. lê o workspace/modo;
2. opcionalmente espera approval;
3. relê depois da espera;
4. calcula root/path;
5. escreve ou inicia processo.

Não existe:

- `policyEpoch` por workspace;
- mutex/gate entre mudança de modo e commit point;
- barreira atômica entre última decisão e início do efeito;
- teste que altere a policy exatamente nessa barreira.

O teste atual chamado “TOCTOU” muda o modo enquanto o card ainda está aguardando. Ele prova reavaliação pós-approval, não prova ausência da corrida no commit point.

### P1 — cache não é invalidado quando há falha com efeito possível

Em `sidecar/src/index.ts`, o cache é limpo a2022penas quando:

```ts
!toolError && classifyTool(name) !== "read"
```

Um comando com exit code não zero, timeout ou erro após iniciar pode ter alterado arquivos. O cache permanece e pode devolver leitura obsoleta.

### P1 — `allow_session` não é revogado como documentado

`sessionApprovals` recebe grants de leitura, mas não há limpeza explícita em:

- mudança de modo;
- troca de sessão;
- troca de workspace;
- Stop;
- fechamento do socket.

Restart limpa memória incidentalmente, mas approvals persistidas pendentes também precisam de terminal explícito.

### P1 — `SECURITY.md` está contraditório

A regra geral ainda manda pedir aprovação para toda escrita/comando, enquanto a matriz nova permite arquivo no Automático. O mesmo documento afirma que grants são revogáveis, mas a implementação não revoga.

### P1 — a evidência de UI não prova “1–7 100%”

Na branch UI:

- o E2E injeta preferência de 300 px, mas não confirma o `getBoundingClientRect()` do painel;
- o teste da paleta não pressiona Enter para executar;
- retorno de foco não é assertado;
- preservação de nota e scroll não é assertada;
- o inventário de comandos não cobre explicitamente perfil, workspace, Soul, modelo e nota;
- `role="option"` usa `aria-checked`; para listbox/option o estado correto é `aria-selected`, ou restaure `menuitemradio`/`aria-checked` conforme o contrato canônico;
- o menu implementa teclado, mas o E2E não prova Home/End/Enter/Escape.

Não confunda implementação provável com prova automatizada.

### P1 — detecção de erro repetido ainda colapsa objetos

No loop atual, o código converte um objeto de erro com `String(errorObject)`, produzindo `"[object Object]"`. Falhas diferentes da mesma ferramenta podem compartilhar a mesma assinatura e acionar o hard stop prematuro que originou o comentário 9.

---

## 6. Pacote A — corrigir prova e acessibilidade da UI (#208 / #213)

Trabalhe em `fix/208-vault-comandos-modelos`. Não misture sidecar.

### 6.1 Vault Markdown

Adicione E2E para cada largura real do painel: 300, 360 e 680 px.

Em cada caso:

1. redimensione/configure;
2. leia `getBoundingClientRect().width` do painel;
3. aceite tolerância máxima de ±2 px;
4. confirme `article.scrollWidth <= article.clientWidth + 1` para prosa;
5. confirme scroll horizontal apenas em código/tabela;
6. confirme imagem `<=` largura do conteúdo.

### 6.2 Paleta de comandos

Corrija/complete o inventário sem criar telas fictícias:

| Ação | Resultado |
|---|---|
| Novo | handler real de nova sessão |
| Sessão recente | abre a sessão |
| Workspace | abre seletor/criação existente |
| Perfil | volta ao chooser existente |
| Soul | abre seção existente de configuração |
| Provedores | abre central existente |
| Modelo | abre/foca seletor existente quando disponível |
| Nota | abre Vault/nota somente com workspace |
| Agents | desabilitado com motivo e Issue, enquanto não existir |

Testes Playwright obrigatórios:

- clique abre;
- `ControlOrMeta+K` abre;
- busca filtra;
- ArrowDown muda seleção;
- **Enter executa de fato** um handler observável;
- Escape fecha;
- abertura por clique devolve foco ao botão;
- abertura por atalho devolve foco ao elemento antes focado;
- busca zera depois de fechar/executar;
- fluxo não produz exceção `cmdk/subscribe`.

### 6.3 Vault rail

Além de aba:

- abra uma nota;
- mova scroll da nota para valor não zero;
- recolha pelo header;
- reabra pelo atalho;
- confirme mesma aba, mesmo path e scroll restaurado;
- confirme `aria-controls` e `aria-expanded` reais;
- confirme ausência do rail sem workspace.

### 6.4 Seletor de modelos

Escolha um contrato acessível coerente:

- `listbox` + `option` + `aria-selected`; ou
- `menu` + `menuitemradio` + `aria-checked`.

Não misture roles e estados de dois padrões.

E2E com 65+ modelos:

- bounding box completo dentro da viewport;
- wheel muda somente a lista;
- ArrowDown/ArrowUp;
- Home vai ao primeiro;
- End vai ao último;
- Enter seleciona;
- Escape fecha e devolve foco;
- busy impede duplo clique;
- erro de troca mantém menu/feedback coerente;
- skeleton não é confundido com lista vazia.

### 6.5 Critério do pacote A

Somente depois dessas provas, atualize a linguagem de “1–7 concluídos”. Se uma ação da paleta não existe, marque-a como desabilitada/Issue e descreva a limitação.

Commit sugerido:

```text
fix(ui): completa acessibilidade e provas do lote 208
```

---

## 7. Pacote B — fechar policy race e revogar grants (#209 / #215)

Trabalhe em `fix/209-permissoes-automaticas`.

### 7.1 Policy epoch e gate por workspace

Implemente uma coordenação por workspace com:

- `policyEpoch` monotônico;
- gate/mutex para serializar mudança de modo e início de side effect;
- snapshot `{mode, epoch}`;
- commit point explícito;
- cancelamento quando o epoch muda antes do commit point.

Fluxo mínimo de mutação:

1. validar schema;
2. capturar policy epoch;
3. realizar trabalho preparatório sem efeito;
4. adquirir gate do workspace;
5. reler modo/epoch;
6. reavaliar `allow/prompt/deny`;
7. revalidar path real/symlink;
8. se epoch mudou ou decisão não for allow, sair sem efeito;
9. marcar commit point e iniciar o efeito;
10. liberar gate no ponto documentado.

Defina comportamento quando o modo muda após o commit point:

- não alegue que efeito já iniciado foi cancelado se isso não é garantido;
- interrompa operação em voo quando for seguro;
- marque side effect como `possible` quando o resultado for ambíguo;
- nova policy vale obrigatoriamente para operações seguintes.

### 7.2 Path race

`safePath` seguido de `writeFile(path)` também admite troca concorrente de symlink/parent. Faça threat model e use a estratégia multiplataforma mais segura disponível sem dependência nova:

- revalidação do parent real imediatamente antes do commit;
- escrita por handle/flags que evitem seguir symlink onde suportado;
- arquivo temporário no mesmo diretório validado + rename controlado quando apropriado;
- falha fechada quando a plataforma não oferece a garantia necessária.

Não declare confinamento perfeito se a garantia continuar parcial; documente o limite.

### 7.3 Grants de sessão

Centralize grants com chave/capability explícita e revogue em:

- mudança de permission mode;
- troca/encerramento de sessão;
- troca de workspace;
- Stop;
- socket close;
- shutdown/restart.

`allow_session` continua restrito a leitura se essa for a decisão de produto. Ajuste a cópia da UI para não prometer grant que a ferramenta atual não recebe.

Na inicialização, toda approval persistida como `pending` de processo anterior vira terminal `cancelled`/`denied` com `resolvedAt`; nunca retome efeito antigo.

### 7.4 Testes obrigatórios

- barreira determinística exatamente antes do commit point;
- mudar `automatic → read-only` na barreira impede arquivo;
- mudar `ask → automatic` executa approval pendente uma vez;
- mudar `ask → read-only` permite leitura pendente e nega mutação/comando;
- duas operações concorrentes no mesmo workspace respeitam epoch;
- workspaces diferentes não compartilham gate/grant;
- grant de leitura funciona na mesma sessão e é revogado em cada evento listado;
- restart encerra approval pendente;
- symlink/parent trocado na barreira não escapa;
- zero card e zero execução para comando automático não confinado.

### 7.5 Documentação

Reescreva a regra geral de `SECURITY.md` para remeter à matriz `allow/prompt/deny`. Não deixe “toda escrita pede aprovação” coexistir com Automático.

Não declare TOCTOU encerrada até o teste da barreira passar.

Commit sugerido:

```text
fix(sidecar): serializa policy e revoga grants de sessão
```

### 7.6 Atualizar a branch empilhada

Depois de avançar B, faça C incorporar B sem reescrever história publicada:

- prefira merge não destrutivo de `fix/209-permissoes-automaticas` em `feat/210-agent-loop-resiliente`;
- use mensagem convencional, por exemplo `chore(stack): incorpora hardening de permissoes`;
- rebase/force-with-lease somente com autorização explícita do mantenedor.

---

## 8. Pacote C — completar harness resiliente (#210 / #216)

Trabalhe em `feat/210-agent-loop-resiliente` depois de incorporar B.

### 8.1 ToolOutcome e side effects

Normalize resultados:

```ts
type SideEffect = "none" | "confirmed" | "possible";

type ToolOutcome =
  | {
      ok: true;
      data: unknown;
      sideEffect: SideEffect;
      truncated: boolean;
    }
  | {
      ok: false;
      error: {
        category: "validation" | "policy" | "execution" | "timeout" | "cancelled";
        code: string;
        message: string;
        retryableWithChangedInput: boolean;
        hint?: string;
      };
      sideEffect: "none" | "possible";
      truncated: boolean;
    };
```

Regras:

- exit code não zero = erro estruturado;
- timeout após spawn = `sideEffect: possible`;
- erro de comando pode ser `possible`;
- mutação iniciada e não confirmada = `possible`;
- cache é invalidado antes/depois de qualquer tentativa com side effect possível;
- comandos e mutações nunca entram no cache;
- somente leituras puras na revisão atual podem ser cacheadas.

Adicione teste: leitura v1 → comando altera arquivo e sai 7 → mesma leitura deve retornar v2.

### 8.2 Fingerprints e recuperação

Não use `String(errorObject)`.

Fingerprint canônico:

```text
toolName + canonicalArgs + error.code
```

Inclua revisão do workspace/progresso no estado do guard.

Regras:

- erro diferente não compartilha contador;
- args diferentes não compartilham contador;
- mutação/novo resultado reinicia apenas guard relacionado;
- `PATH_OUTSIDE_WORKSPACE` nega a chamada atual, depois permite uma correção com args diferentes após `list_directory(".")`;
- `READ_ONLY` e `AUTOMATIC_COMMAND_NOT_CONFINED` não são corrigidos trocando path;
- três fingerprints idênticos sem progresso bloqueiam nova execução idêntica;
- injete uma única instrução de replanejamento;
- se persistir, finalize uma vez com tools desabilitadas.

### 8.3 Máquina de estados

Extraia de `index.ts` um loop testável com estados:

```text
requesting_model
validating_calls
awaiting_approval
executing_tools
observing
recovering
compacting
finalizing_without_tools
completed | blocked | failed | cancelled
```

Contrato de `blocked`:

- evento/protocolo explícito, preferencialmente `chat.blocked`;
- exatamente um terminal por request;
- status persistido;
- approvals/resolvers limpos;
- parcial preservado;
- causa e próxima ação renderizadas;
- nova mensagem do usuário pode retomar;
- rodada final com `tools: []` no máximo uma vez;
- se essa rodada falhar, gere fallback local sanitizado e emita somente `blocked`.

### 8.4 Streaming, timeout e fallback

Normalize finish reasons:

```text
final | tool_calls | max_output | context_limit | refusal | pause | unknown | transport_error
```

Defaults iniciais:

| Limite | Remoto | Ollama local |
|---|---:|---:|
| conexão | 10 s | 10 s |
| primeiro byte | 30 s | 120 s |
| idle entre chunks | 45 s | 120 s |
| rodada | 5 min | 15 min |
| turno | 20 min | 30 min |

Falha transitória: no máximo duas novas tentativas por candidato, backoff exponencial com full jitter, base 250 ms, teto 8 s e `Retry-After` até 30 s.

Não faça retry automático em policy, recusa, context overflow ou side effect ambíguo.

Cada candidato usa `attemptId`. Deltas pertencem à tentativa:

- parcial anterior só é descartado quando substituto realmente começa;
- nunca concatene tentativas;
- se nenhuma tentativa vencer, preserve último parcial marcado incompleto;
- stream vazio, JSON terminal inválido, envelope de erro e EOF precoce não viram sucesso vazio;
- timeout/stop libera a fila e mata waits/processos.

### 8.5 Contexto e tools

- conte schemas, tool calls, resultados e overhead do protocolo;
- não separe tool call/result na compactação;
- preserve objetivo, decisões, arquivos alterados, erros tentados, bloqueio e próxima ação;
- resultados recentes completos, antigos resumidos;
- enriqueça descrições de tools com quando usar/não usar, restrições e exemplo quando complexo;
- modelo com tool support `unknown` recebe probe explícito ou tools desabilitadas com explicação;
- não mude modelo/protocolo silenciosamente.

### 8.6 UI do harness

- estados humanos: Lendo, Executando, Aguardando autorização, Recuperando, Compactando e Finalizando;
- erro mostra código/mensagem/hint; JSON bruto só em detalhes;
- `tool.failed` entrega ao adapter o mesmo código/mensagem do sidecar;
- Stop cancela turno, approval e processo;
- resposta parcial permanece em blocked/failed/cancelled quando houver conteúdo útil.

### 8.7 Testes mínimos

- dois erros diferentes da mesma tool não acionam repetição falsa;
- mesmo fingerprint três vezes aciona uma única recuperação;
- bloqueio final não chama tools;
- falha da rodada final ainda emite terminal único;
- exit não zero com efeito invalida cache;
- timeout com efeito possível não é repetido;
- stream vazio/EOF/envelope de erro;
- attemptId impede concatenação;
- sem fallback vencedor preserva parcial incompleto;
- context compaction preserva pares;
- timeout/stop libera próximo request em até 1 s com relógio controlado;
- guards sessão/epoch e FIFO permanecem.

Commits sugeridos, separados:

```text
fix(sidecar): invalida cache em efeitos possiveis
fix(sidecar): usa fingerprints estruturados e finalizacao bloqueada
feat(sidecar): extrai maquina de estados do harness
fix(sidecar): adiciona timeouts e isola tentativas de fallback
```

---

## 9. Pacote D — evals locais (#211)

Só comece quando os contratos de C estiverem estáveis.

Use a branch existente `chore/211-evals-harness`. Incorpore C por merge não destrutivo e configure o Draft PR com base em C enquanto a pilha não estiver mergeada.

Crie corpus sintético local com pelo menos 40 tarefas:

- 10 exploração/leitura;
- 10 edição;
- 8 execução/testes;
- 6 recuperação de args/path;
- 6 stream/fallback.

Separe:

1. gates determinísticos de CI;
2. fixtures de protocolo/modelo roteirizado;
3. evals reais opt-in, inicialmente informativos.

Metas:

| Métrica | Meta |
|---|---:|
| conclusão determinística | ≥95% |
| tool call válida após no máximo uma correção | ≥98% |
| hard stop prematuro em 40 casos | 0 |
| cards indevidos em Automático | 0 |
| mutações em Read-only | 0 |
| escape do workspace | 0 |
| terminal único | 100% |
| exit não zero classificado como erro | 100% |
| concatenação de fallback | 0 |
| vazamento sessão/epoch | 0 |
| recuperação mediana | ≤2 rodadas |
| fila presa após terminal | 0 |

Defina denominadores no runner. Se baseline for zero, reporte zero regressão; não invente redução percentual.

Nunca versione conteúdo real, prompts/respostas pessoais ou paths. Provedores reais são opt-in e usam workspaces temporários sintéticos.

Commit sugerido:

```text
test(harness): adiciona corpus local e metricas de fluidez
```

---

## 10. Sandbox de comandos (#214)

Não improvise uma allowlist e não instale dependência sem decisão.

Na Issue/ADR #214, entregue análise de opções para Linux, macOS e Windows cobrindo:

- filesystem e symlinks;
- subprocessos;
- rede default-deny/capability separada;
- ambiente mínimo;
- CPU/memória/tempo/saída;
- kill de árvore;
- compatibilidade com Tauri e distribuição;
- custo de manutenção;
- comportamento quando capability não existe.

Gate:

- sem escolha explícita do mantenedor, `execute_command` em Automático permanece `AUTOMATIC_COMMAND_NOT_CONFINED`, zero card e zero execução;
- não declare comentário 8 completo;
- continue pacotes C/D independentes;
- após escolha, abra PR separado para sandbox e suíte de 100+ tentativas de escape.

---

## 11. Ordem de execução e checkpoints

### Checkpoint 0 — preflight

```bash
git status --short --branch
git remote -v
gh auth status
gh issue view 208
gh issue view 209
gh issue view 210
gh issue view 211
gh issue view 212
gh issue view 214
gh pr view 213
gh pr view 215
gh pr view 216
```

Confirme bases/ancestralidade. Não duplique Issue/PR.

Saída:

```text
Checkpoint 0 — branches/bases e acesso GitHub confirmados; arquivos não rastreados preservados; plano incremental definido.
```

### Checkpoint 1 — testes vermelhos

Antes de corrigir, adicione/reproduza:

- policy race na barreira;
- falha com side effect deixando cache obsoleto;
- grant não revogado;
- `[object Object]` agrupando erros diferentes;
- lacunas E2E de UI.

Saída:

```text
Checkpoint 1 — cada divergência possui reprodução/teste vermelho que falha pela causa descrita.
```

### Checkpoint 2 — UI A

Implemente seção 6, rode testes focados, motion Create/Audit e atualize #208/#213.

### Checkpoint 3 — segurança B

Implemente seção 7, rode ataques concorrentes e atualize #209/#215/SECURITY.

Não avance alegando TOCTOU resolvida sem policyEpoch/gate e teste da barreira.

### Checkpoint 4 — harness C

Incorpore B sem force push, implemente seção 8 em commits pequenos e atualize #210/#216.

### Checkpoint 5 — evals D

Incorpore C, implemente seção 9 e abra/atualize Draft PR de #211.

### Checkpoint 6 — sandbox ADR

Atualize #214 com opções e decisão pendente. Não codifique solução não aprovada.

### Checkpoint 7 — gates e handoff

Rode seção 13, revise diffs, atualize todos os checklists e produza relatório final.

---

## 12. Arquivos prováveis

Confirme com `rg` antes de editar.

### UI

- `src/app/WorkspaceShell.tsx`
- `src/app/shell/Dialogs.tsx`
- `src/app/shell/Composer.tsx`
- `src/app/shell/VaultSlot.tsx`
- `src/app/vault-view.ts`
- `src/features/vault/components/VaultPanel.tsx`
- `src/shared/components/ui/command.tsx`
- `src/styles/index.css`
- `e2e/ox-alpha-feedback.spec.ts`

### Permissões

- `sidecar/src/tool-policy.ts`
- `sidecar/src/tools.ts`
- `sidecar/src/tools.test.ts`
- `sidecar/src/index.ts`
- `sidecar/src/db/store.ts`
- `src/shared/api/sidecar.ts`
- `src/features/chat/adapter/sidecar-chat-store.ts`
- `SECURITY.md`

### Harness

- `sidecar/src/index.ts`
- `sidecar/src/tool-contract.ts`
- `sidecar/src/streaming.ts`
- `sidecar/src/context-budget.ts`
- `sidecar/src/providers.ts`
- `sidecar/src/observability.ts`
- testes correspondentes

Novos módulos justificáveis:

- `sidecar/src/agent-loop.ts`
- `sidecar/src/tool-outcome.ts`
- `sidecar/src/provider-attempt.ts`
- módulo pequeno de policy coordination/gate, se não couber em `tool-policy.ts`

Não crie abstração paralela se uma fronteira existente puder ser estendida com clareza.

---

## 13. Quality gates

Após cada pacote, rode testes focados. Antes do handoff:

```bash
npm run lint
npm run knip
npm run arch-contract
npm test
npm run test:coverage
npm run build
npm run e2e:ci
cargo check --manifest-path src-tauri/Cargo.toml
```

Também valide:

- `git diff --check`;
- `git status --short --branch`;
- Conventional Commits/commitlint;
- nenhum segredo/path pessoal em diff, fixtures, screenshots ou logs;
- nenhum arquivo do owner removido;
- nenhum gate desabilitado.

Se um gate falhar por baseline, prove na base e ligue Issue. Não silencie.

---

## 14. Critérios de aceite consolidados

### UI

- [ ] painel medido realmente em 300/360/680 px;
- [ ] paleta executa por Enter e restaura foco corretamente;
- [ ] inventário de ações completo ou explicitamente desabilitado/ligado a Issue;
- [ ] Vault preserva aba, nota e scroll;
- [ ] seletor usa roles/estados ARIA coerentes;
- [ ] teclado do menu provado de ponta a ponta.

### Permissões

- [ ] policyEpoch/gate elimina corrida antes do commit point;
- [ ] teste concorrente determinístico passa;
- [ ] grants são revogados em todas as transições;
- [ ] approvals antigas não ressuscitam;
- [ ] documentação não se contradiz;
- [ ] comando automático não confinado continua zero prompt/zero execução.

### Harness

- [ ] falha com efeito possível invalida cache;
- [ ] fingerprints usam args canônicos + código;
- [ ] erros distintos não disparam hard stop falso;
- [ ] máquina de estados possui `blocked` real;
- [ ] uma rodada final sem tools no máximo;
- [ ] finish reasons, timeouts e retry taxonomy implementados;
- [ ] fallback não concatena tentativas;
- [ ] exatamente um terminal por request;
- [ ] parcial útil preservado;
- [ ] fila sempre liberada.

### Evals/sandbox

- [ ] corpus ≥40 e denominadores explícitos;
- [ ] gates determinísticos atingem metas;
- [ ] eval real permanece opt-in;
- [ ] ADR #214 apresenta opções e aguarda decisão;
- [ ] comentário 8 não é marcado completo sem sandbox aprovado/implementado ou redução formal de escopo.

---

## 15. Formato do relatório final

Use exatamente:

```markdown
# Resultado
[concluído, parcial ou bloqueado — sem linguagem promocional]

## Delta desde o relatório anterior
| Divergência | Correção | Teste | Status |

## Issues, branches e Draft PRs
| Pacote | Issue/PR | Base/head | Status verificado |

## Segurança de permissões
[policyEpoch, commit point, grants, path race e sandbox]

## Harness resiliente
[ToolOutcome, cache, fingerprints, estados, timeouts, fallback e contexto]

## UI e acessibilidade
[provas corrigidas e motion audit]

## Evals
[corpus, denominadores, baseline e resultado]

## Quality gates
| Gate | Comando | Resultado |

## Limitações restantes
[Issue, impacto, owner e próxima decisão]

## Como o mantenedor valida
[passos manuais curtos]
```

Não repita “100%” sem teste correspondente. Não liste Issue/PR como verificado se `gh` não confirmou.

---

## 16. Stop conditions

Pare somente a frente afetada e peça decisão quando:

- `gh` exige reautenticação para mutação remota;
- branch/base remota diverge do snapshot;
- existe trabalho alheio não commitado no mesmo arquivo;
- seria necessário force push sem autorização;
- sandbox requer dependência/ADR ainda não aprovado;
- path race não pode ser mitigada de forma multiplataforma sem decisão;
- uma mudança exige enviar conteúdo do usuário para fora;
- seria necessário enfraquecer `shell: false`, validação, sanitização ou gate.

Continue frentes independentes. Registre evidência e não marque item bloqueado como concluído.

---

## 17. Definição de pronto

Esta continuação está pronta somente quando:

1. as divergências P0/P1 da seção 5 foram corrigidas e provadas;
2. o relatório anterior foi atualizado com linguagem compatível com a evidência;
3. UI A possui testes que medem exatamente suas alegações;
4. permissões B têm gate/epoch real e grants revogáveis;
5. harness C não para por assinatura `[object Object]`, cache obsoleto ou fallback misturado;
6. estados, timeouts e terminais estão implementados e documentados;
7. evals D executam localmente com corpus sintético;
8. sandbox permanece bloqueado de forma honesta ou foi implementado após decisão aprovada;
9. todos os gates aplicáveis passam;
10. Draft PRs estão atualizados e nenhum merge foi feito.

Ao terminar, entregue o relatório da seção 15 e aguarde revisão do mantenedor.

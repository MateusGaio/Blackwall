# Segurança e divulgação

## Estado atual

O repositório do Blackwall permanece privado durante o desenvolvimento. Issues,
Pull Requests, artefatos de CI, fixtures e workspaces de teste podem conter
contexto operacional e não devem ser tratados como material público.

Uma publicação pública será planejada em um PR separado, depois de revisar o
histórico, os artefatos, as dependências, os workflows, a licença e a proteção
da `main`. Nenhum agente ou script deve alterar a visibilidade do repositório
por conta própria.

## Regras para contribuidores e agentes

- Nunca versione API keys, tokens, `secrets.enc`, `secrets.key`, dumps SQLite,
  prompts, respostas, conteúdo de workspaces, caminhos pessoais ou logs com
  dados sensíveis.
- Não copie segredos para comandos, variáveis persistentes, Issues, PRs,
  comentários de revisão ou telemetria.
- Ferramentas locais só atuam dentro do workspace autorizado e seguem a
  **matriz canônica `allow/prompt/deny`** documentada abaixo (`evaluateToolPolicy`
  em `sidecar/src/tool-policy.ts`). Invariantes em TODOS os modos: `shell: false`,
  validação de path real com revalidação do parent imediatamente antes da
  escrita, bloqueio de traversal/symlink externo, ambiente sanitizado e limites
  de tempo/saída. Grants `allow_session` são restritos a leitura da mesma
  sessão/workspace e revogados em mudança de modo, troca de sessão/workspace,
  Stop, fechamento de socket e restart.
- Telemetria é opt-in e desligada por padrão. Sentry, Datadog e New Relic só
  podem receber metadados técnicos não sensíveis; prompts, respostas, arquivos,
  argumentos e resultados nunca são enviados.
- Antes de publicar uma branch, confira `git diff --check`, `git status`, os
  arquivos rastreados e os artefatos gerados. Se um segredo aparecer no
  histórico, interrompa o push e faça a rotação antes de qualquer publicação.

## Matriz de política de ferramentas (#209)

| Modo | Ler/listar/buscar | Criar/editar/patch | Executar comando |
|---|---|---|---|
| `ask` | prompt | prompt | prompt |
| `automatic` | allow | allow após validações de caminho/schema | **deny tipado** `AUTOMATIC_COMMAND_NOT_CONFINED` (sem card) |
| `read-only` | allow | deny `READ_ONLY_MUTATION` | deny `READ_ONLY_COMMAND` |

Coordenação de concorrência: cada workspace possui um `policyEpoch` monotônico
e um gate (mutex). Mudanças de modo incrementam o epoch **dentro** do gate;
mutações/comandos executam sua fase crítica dentro do mesmo gate, revalidando
modo/epoch/path imediatamente antes do efeito. Uma troca solicitada durante uma
operação crítica fica enfileirada e passa a valer para as operações seguintes;
não há intercalação entre decisão e efeito. Troca de modo também reavalia
cards pendentes (allow executa uma vez; caso contrário nega com motivo) e
emite `approval.resolved`. Na inicialização, approvals persistidas como
`pending` viram terminal `cancelled`.

Limite conhecido da mitigação de path race: escritas usam temporário no
diretório validado + rename com revalidação do parent por realpath; processos
EXTERNOS ao sidecar que mutem o workspace simultaneamente continuam fora do
modelo de ameaças — confinamento completo exige sandbox (#214).

## Confinamento de comandos — estado honesto

`execute_command` valida o `cwd`, mas um processo ainda pode acessar recursos
fora do workspace por argumentos, código executado ou subprocessos. Por isso o
modo Automático NÃO executa comandos: ele retorna
`POLICY_DENIED/AUTOMATIC_COMMAND_NOT_CONFINED` sem abrir card e sem execução
degradada. Allowlists de executáveis (node/python/npm/git) NÃO são sandbox.
Um confinamento real multiplataforma (filesystem/subprocessos/rede negada/
kill de árvore) exige ADR próprio (#214) com ameaças, opções e custo aprovados
pelo owner antes de qualquer dependência nova.

## Relato responsável

Não abra uma Issue pública contendo segredos ou uma reprodução com dados reais.
Durante o período privado, informe o owner diretamente e preserve somente uma
reprodução mínima e sintética no repositório. Após a publicação, este arquivo
deverá ser atualizado com o canal de divulgação responsável escolhido pelo
owner.

Consulte [`AGENTS.md`](AGENTS.md) e [`CONTRIBUTING.md`](CONTRIBUTING.md) para o
fluxo Issue → branch → PR e o gate de futura publicação pública.

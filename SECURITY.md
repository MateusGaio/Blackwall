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
- Ferramentas locais só atuam dentro do workspace autorizado. Mantenha
  `shell: false`, valide caminhos reais, bloqueie traversal e symlinks externos,
  limite tempo/saída e peça aprovação para escrita e comandos.
- Telemetria é opt-in e desligada por padrão. Sentry, Datadog e New Relic só
  podem receber metadados técnicos não sensíveis; prompts, respostas, arquivos,
  argumentos e resultados nunca são enviados.
- Antes de publicar uma branch, confira `git diff --check`, `git status`, os
  arquivos rastreados e os artefatos gerados. Se um segredo aparecer no
  histórico, interrompa o push e faça a rotação antes de qualquer publicação.

## Relato responsável

Não abra uma Issue pública contendo segredos ou uma reprodução com dados reais.
Durante o período privado, informe o owner diretamente e preserve somente uma
reprodução mínima e sintética no repositório. Após a publicação, este arquivo
deverá ser atualizado com o canal de divulgação responsável escolhido pelo
owner.

Consulte [`AGENTS.md`](AGENTS.md) e [`CONTRIBUTING.md`](CONTRIBUTING.md) para o
fluxo Issue → branch → PR e o gate de futura publicação pública.

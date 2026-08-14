# Contribuindo com o Blackwall

Este projeto usa um fluxo obrigatório de Issue → branch → Pull Request. A `main` é a base estável; não faça push direto nela.

O repositório está privado durante esta fase de desenvolvimento. A publicação pública, Releases e qualquer mudança de visibilidade dependem de uma revisão de segurança e de autorização explícita do owner; não presuma que um link do GitHub significa que o código já está público.

## Antes de implementar

1. Abra ou localize uma Issue para a tarefa.
2. Classifique-a com `type:bug`, `type:enhancement` ou `type:feature`.
3. Confirme o critério de aceite, incluindo testes e, quando houver UI, o checklist de motion.
4. Crie uma branch com o número da Issue:

```text
feat/123-seletor-de-modelo
fix/124-erro-no-vault
chore/125-fluxo-de-release
```

## Durante o trabalho

- Use Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`).
- Mantenha cada commit focado e verificável.
- Rode os quality gates aplicáveis antes de abrir o PR.
- Não inclua chaves, conteúdo de conversa ou dados pessoais em commits, logs, Issues, PRs ou telemetria.

## Pull Request

Abra o PR contra `main` (ou contra a branch de um PR predecessor quando o trabalho for empilhado) e mantenha-o como rascunho inicialmente. A descrição deve conter:

```markdown
## O que mudou

Closes #123

## Como testar

## Checklist
- [ ] Testes novos/atualizados
- [ ] Biome, Knip e dependency-cruiser
- [ ] Vitest/cobertura
- [ ] Playwright quando o fluxo for crítico
- [ ] Motion audit quando tocar em UI
```

Use `Closes #N` quando o PR encerra a Issue ou `Refs #N` quando ela continuará aberta. PRs de deploy/release também devem apontar para as Issues que geraram o artefato.

## Git e GitHub

- `git` cuida de branches, commits e pushes.
- O GitHub Connector ou `gh` cuida de Issues, PRs e checks.
- Valide a autenticação antes de usar o CLI:

```bash
gh auth status
```

- Confirme também que o remoto e a visibilidade são os esperados antes de uma ação de escrita:

```bash
git remote -v
gh repo view MateusGaio/Blackwall. --json isPrivate,defaultBranchRef
```

- Se necessário, autentique-se com `gh auth login -h github.com`. Nunca exponha o token, nem o deixe em comandos, arquivos, Issues, PRs ou logs.
- Se a autenticação estiver inválida, consultas locais podem continuar, mas não faça push, merge, retarget, fechamento de PR, alteração de proteção ou mudança de visibilidade.
- Só faça merge após revisão e todos os checks obrigatórios. O merge em `main` é o gatilho de integração e deploy/release.

### Checklist de privacidade antes do push

- [ ] `git status --short --branch` mostra somente a branch e mudanças esperadas.
- [ ] `git diff --check` não encontra problemas.
- [ ] Nenhuma chave, token, `secrets.enc`, `secrets.key`, prompt, resposta, dump SQLite, caminho pessoal ou arquivo de workspace entrou no diff.
- [ ] Workspaces e fixtures locais estão fora do Git ou usam dados sintéticos.
- [ ] Workflows, scripts de release e dependências novas foram revisados como superfície de segurança.
- [ ] O PR usa `Closes #N` ou `Refs #N`, informa a base correta e permanece rascunho até todos os gates passarem.

### Gate para tornar o projeto público

Quando o owner decidir publicar, abra um PR de preparação separado. Ele deve revisar o histórico, os artefatos, a licença, os avisos de terceiros, os templates de Issue/PR, a política de segurança e a proteção da `main`. A visibilidade só deve ser alterada depois que esse PR for revisado e aprovado; nenhum agente deve executar essa mudança por conta própria.

As instruções completas para agentes estão em [`AGENTS.md`](AGENTS.md).

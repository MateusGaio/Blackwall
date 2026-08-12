# Contribuindo com o Blackwall

Este projeto usa um fluxo obrigatório de Issue → branch → Pull Request. A `main` é a base estável; não faça push direto nela.

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

- Se necessário, autentique-se com `gh auth login -h github.com`. Nunca exponha o token.
- Só faça merge após revisão e todos os checks obrigatórios. O merge em `main` é o gatilho de integração e deploy/release.

As instruções completas para agentes estão em [`AGENTS.md`](AGENTS.md).

# AGENTS.md — Instruções para qualquer agente de IA trabalhando no Blackwall

Este arquivo é lido por qualquer agente (Codex, Claude Code, Cursor, Windsurf, Hermes, etc.) que for trabalhar neste repositório. Se você é um agente de IA lendo isto: siga estas regras antes de tocar em qualquer código.

> Este arquivo é a referência operacional para agentes e contribuidores. Mudanças nas convenções devem ser feitas por PR e mencionadas na Issue correspondente.

---

## 0. Antes de qualquer tarefa — leia isto

1. Leia `PRODUCT.md` para entender o que o Blackwall é e para quem é.
2. Leia `ARCHITECTURE.md` para entender a stack e as decisões já tomadas (ADRs).
3. Leia `UX_SPEC.md` para entender navegação, estados vazios, onboarding e identidade visual — **nenhuma tela nova é aceita sem estar de acordo com esse documento**.
4. Leia `SECURITY.md` antes de manipular workspaces, provedores, credenciais, telemetria ou artefatos de release.
5. **Não reabra decisões já tomadas** (stack, licença, storage, ADRs de UX) sem alinhar antes — trate-as como travadas a menos que o Mateus peça explicitamente para revisar.

---

## 1. Constraint Anchoring — restrições fixas do projeto

Repita estas restrições mentalmente antes de gerar qualquer plano ou código. Elas não mudam entre tarefas:

- **Stack travada:** Tauri v2 (Rust) + React/Vite (frontend) + sidecar Node/Bun (TypeScript) para lógica de IA. Sidecar Python só existe para a feature de LoRA (Fase 3), nunca para lógica de produto geral.
- **Licença:** MIT. Todo arquivo novo de código deve manter o cabeçalho de licença do projeto.
- **Zero telemetria por padrão.** Qualquer instrumentação nova (OTel/Sentry) precisa nascer desligada, com opt-in explícito do usuário.
- **Sem dependência nova sem necessidade clara.** Antes de `npm install` algo novo, verifique se já existe uma lib aprovada no `ARCHITECTURE.md` que resolve o problema.
- **Nenhum componente de UI é aceito sem:** skeleton de carregamento, lazy loading (se aplicável), animação de entrada/saída, indicador de progresso quando a ação não é instantânea, e suporte a `prefers-reduced-motion`. Isso não é opcional — é critério de aceite.

---

## 2. Fluxo de trabalho: Issue → Branch → PR

Toda tarefa (correção, melhoria ou nova função) segue este fluxo:

### 2.0 Regra obrigatória de rastreabilidade e release

- O repositório remoto é [`MateusGaio/Blackwall.`](https://github.com/MateusGaio/Blackwall.). Ele permanece **privado durante o desenvolvimento atual**; uma publicação pública só pode acontecer após a revisão de segurança e governança descrita abaixo. A branch `main` é a base estável e padrão.
- Nenhum agente deve iniciar implementação de uma correção, melhoria ou função nova sem uma Issue aberta. Se a tarefa ainda não tiver Issue, crie-a antes de criar a branch.
- Todo trabalho deve ocorrer em branch própria e chegar à `main` por Pull Request. Push direto na `main`, merge local e deploy manual fora do PR são proibidos.
- O nome da branch deve conter o número da Issue: `feat/<issue>-descricao`, `fix/<issue>-descricao` ou `chore/<issue>-descricao`.
- Todo PR deve mencionar a Issue na descrição com `Closes #N` quando a encerra ou `Refs #N` quando a Issue continua aberta. PRs de deploy/release também precisam apontar para a Issue ou conjunto de Issues que produziram o artefato.
- PR novo deve ser aberto como rascunho. Ele só pode ser marcado como pronto depois dos quality gates, da revisão e do checklist de UI quando aplicável.
- Merge de PR aprovado é o único gatilho de integração com `main` e de deploy/release. O agente não deve fazer merge em nome do owner sem autorização explícita.
- Commits seguem Conventional Commits e devem ser pequenos, verificáveis e relacionados à Issue ativa.

#### Responsabilidade de cada ferramenta

- `git`: criar/trocar branches, revisar diff, commitar e publicar branches (`git push`).
- GitHub Connector ou `gh`: criar e consultar Issues, abrir/atualizar PRs, acompanhar checks e revisar o estado do remoto.
- Antes de usar `gh`, valide a sessão com `gh auth status`. Nunca cole tokens em comandos, arquivos, Issues, PRs, logs ou telemetria. Se a autenticação estiver inválida, pare a publicação e peça ao owner para executar `gh auth login -h github.com`.
- Depois do push, confirme a branch remota e os checks. Não declare uma Issue ou PR como publicado apenas porque o commit local existe.

#### 2.0.1 Estado privado e pré-voo do GitHub

- Não altere a visibilidade do repositório, crie uma Release pública, ative um updater público, faça merge, feche PRs ou modifique a proteção da `main` sem autorização explícita do owner para aquela ação.
- Antes de qualquer ação externa, confira o remoto e a autenticação sem imprimir credenciais:

  ```bash
  git remote -v
  gh auth status
  gh repo view MateusGaio/Blackwall. --json isPrivate,defaultBranchRef
  ```

- Se `gh auth status` falhar, não tente contornar com tokens em argumentos, arquivos, variáveis persistentes, Issues ou logs. Pare a publicação e peça ao owner para renovar a sessão com `gh auth login -h github.com`.
- `git status --short --branch`, `git diff --check` e a confirmação da branch remota são obrigatórios antes do push. Um commit local ou uma branch local nunca equivale a um PR publicado.
- Toda alteração em CI, workflows, permissões, updater, dependências ou scripts de release deve ser revisada como mudança de segurança. Não aceite mudanças de Actions de terceiros sem fixar a versão e justificar a origem.
- Nunca inclua no GitHub: API keys, tokens, `secrets.enc`, `secrets.key`, prompts, respostas, conteúdo de arquivos do usuário, dumps do banco, caminhos pessoais ou logs com dados sensíveis. Se um segredo aparecer no histórico, interrompa o push e trate a rotação antes de qualquer publicação.

#### 2.0.2 Gate para futura publicação pública

Antes de tornar o repositório público, o owner deve aprovar um PR de preparação que:

1. faça uma varredura do histórico e dos artefatos versionados em busca de segredos;
2. revise `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md`, `UX_SPEC.md`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md`, Issues e templates para remover dados pessoais e exemplos reais;
3. confirme licença, avisos de terceiros, política de segurança, CI sem segredos expostos e artefatos de release reproduzíveis;
4. habilite proteção da `main` com os checks obrigatórios e revisão por PR;
5. só então altere a visibilidade e publique a primeira Release.

Até esse gate ser concluído, trate o remoto, os artefatos de CI e os workspaces de teste como material privado.

### 2.1 Issue primeiro
Nenhuma tarefa é iniciada sem uma Issue correspondente no GitHub. Toda Issue tem um tipo, marcado por label:

- `type:bug` — correção de comportamento incorreto.
- `type:enhancement` — melhoria em algo que já existe.
- `type:feature` — função nova.

Template mínimo de Issue:

```markdown
## Contexto
[Por que essa tarefa existe]

## O que precisa ser feito
[Descrição objetiva]

## Critério de aceite
- [ ] ...
- [ ] Testes cobrindo o caso (unit/integration/e2e conforme aplicável)
- [ ] Se toca em UI: skeleton/lazy/animação/progresso conferidos
- [ ] Lint (Biome), Knip e dependency-cruiser passando
```

> **Nota de execução:** o agente deve preferir o GitHub Connector para criar Issues e PRs. O `gh` CLI é o fallback operacional para consultas e ações que o conector não cobrir, sempre após `gh auth status`. Se nenhum dos dois estiver autenticado, a implementação não deve ser apresentada como publicada: registre o bloqueio e solicite autenticação ao owner.

### 2.2 Branch
Nome da branch referencia a Issue: `feat/123-roteador-fallback`, `fix/124-crash-vault`, `chore/125-setup-biome`.

### 2.3 Pull Request
- **Todo PR precisa mencionar a Issue na descrição** — usar `Closes #123` (ou `Refs #123` se não fecha a Issue completamente).
- PRs que dependem de outro PR devem declarar a dependência (por exemplo, `Depends on #123`) e usar a branch do PR anterior como base até que ela seja integrada em `main`.
- PR precisa passar todos os quality gates (seção 3) antes de poder ser mergeado.
- Merge de PR = trigger de deploy/release, conforme pipeline definido em CI.

Template mínimo de PR:

```markdown
## O que mudou
[Resumo objetivo]

Closes #123

## Como testar
[Passos manuais, se houver]

## Checklist
- [ ] Testes novos/atualizados
- [ ] Lint/format (Biome) ok
- [ ] Knip ok (sem código morto introduzido)
- [ ] dependency-cruiser ok (sem violação de fronteira de arquitetura)
- [ ] Se UI: motion audit (design-motion-principles) feito
```

---

## 3. Quality gates (obrigatórios antes de merge)

| Gate | Ferramenta | Bloqueia merge? |
|---|---|---|
| Lint + formatação | Biome | Sim |
| Código/deps não usadas | Knip | Sim |
| Fronteiras de arquitetura | dependency-cruiser | Sim |
| Padrão de commit | commitlint | Sim (no commit, via hook) |
| Testes unitários + integração | Vitest | Sim |
| Cobertura mínima | Codecov | Sim (limiar configurado no `codecov.yml`) |
| E2E dos fluxos críticos | Playwright | Sim, para PRs que tocam fluxo crítico |
| Teste de mutação | Stryker Mutator | Não bloqueia PR — roda em job agendado |

---

## 4. Motion design — obrigatório em toda UI

Antes de considerar um componente de UI "pronto":

1. Rode a skill `design-motion-principles` em modo **Create** ao construir o componente.
2. Rode a mesma skill em modo **Audit** antes de abrir o PR, se o PR toca em qualquer tela existente.
3. Confirme os 5 itens do checklist da seção 1 (skeleton, lazy, entrada/saída, progresso, reduced-motion).

Instalação (uma vez por ambiente de agente):
```
npx skills add kylezantos/design-motion-principles
```

---

## 5. Observabilidade

- Instrumentar com **OpenTelemetry** desde o código novo (spans para chamadas de modelo, MCP, roteador).
- Backend padrão de erro: **Sentry**. Exporters adicionais (Datadog, New Relic) só entram via config, nunca hard-coded.
- Nunca enviar conteúdo de prompt/resposta do usuário em telemetria — só metadados de performance/erro.

---

## 6. Como o agente deve pensar antes de agir (estratégias de prompting)

Estas três estratégias devem estruturar **qualquer** plano de trabalho gerado por um agente neste repo, independente do modelo usado:

### Role Assignment
Antes de começar, declare explicitamente qual papel você está assumindo para essa tarefa. Exemplos:
- "Atuando como Agente de Frontend implementando skeleton loading na lista de sessões."
- "Atuando como Agente de Arquitetura revisando a regra de dependency-cruiser entre `sidecar/` e `ui/`."

Isso evita que o agente misture responsabilidades (ex: um agente de UI decidindo sozinho mudar o schema do SQLite).

### Stepwise Prompting
Antes de escrever qualquer código, produza um plano numerado e sequencial da tarefa, e execute passo a passo, sinalizando ao final de cada passo. Não pule etapas do plano nem execute tudo de uma vez sem checkpoint. Ordem sugerida:
1. Reler a Issue e os critérios de aceite.
2. Confirmar constraints (seção 1) que se aplicam.
3. Planejar os arquivos que serão tocados.
4. Implementar.
5. Escrever/atualizar testes.
6. Rodar os quality gates localmente.
7. Abrir o PR com o template da seção 2.3.

### Constraint Anchoring
No início de cada plano gerado, reafirme as restrições fixas relevantes à tarefa (stack, licença, ausência de telemetria não-opt-in, checklist de motion). Isso vale mesmo em conversas longas — não assuma que o contexto anterior "ainda vale"; reancore.

---

## 7. Execução com Caveman / CaveCrew

Este repositório é compatível com o uso de **Caveman** (compressão de tokens para agentes) e subagentes **CaveCrew** para paralelizar lotes de Issues. Regras específicas:

- Caveman/CaveCrew podem ser usados livremente durante o trabalho interno do agente (planejamento, leitura de contexto, chamadas de subagente).
- **A descrição final do PR e da Issue nunca deve ficar comprimida/em "caveman-speak"** — precisa ser português (ou inglês, se o repo virar internacional) legível por humanos, já que outros contribuidores vão ler.
- Codex é suportado nativamente pelo Caveman — pode ser usado como o modelo de execução principal deste projeto sem conflito com essa ferramenta.

---

## 8. Convenção de commits

Conventional Commits, validado por `commitlint`:
```
feat(router): adiciona fallback sequencial entre provedores
fix(vault): corrige crash ao renderizar wikilink quebrado
chore(ci): adiciona job de Stryker Mutator agendado
```

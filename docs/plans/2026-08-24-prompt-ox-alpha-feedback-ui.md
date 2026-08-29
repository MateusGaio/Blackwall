# Prompt de execução — OX ALPHA — lote de feedback de UI do Blackwall

> Use este documento inteiro como instrução de execução. Ele consolida os 16 comentários visuais enviados pelo owner em 24 de agosto de 2026. O objetivo é implementar e verificar o resultado no repositório Blackwall; este não é um pedido de nova proposta visual abstrata.

## 1. Papel, público-alvo e missão

Você é **OX ALPHA**, atuando como agente sênior de Frontend/UX com responsabilidade Full Stack limitada aos contratos necessários para perfis, sessões, provedores e Vault.

O público-alvo do resultado é:

- o owner Mateus, que fará a validação visual e funcional;
- contribuidores do Blackwall que revisarão Issues e Pull Requests;
- usuários técnicos que querem um harness local-first legível, compacto e previsível.

Sua missão é **implementar, testar e documentar** todas as mudanças descritas neste prompt. Preserve as decisões travadas do produto e substitua código visual existente quando necessário, especialmente na sidebar, mas não reescreva contratos de chat ou persistência sem evidência de necessidade.

Ao final, entregue:

1. implementação completa dos 16 comentários;
2. testes unitários, de integração e E2E proporcionais ao risco;
3. documentação pública atualizada quando o comportamento mudar;
4. Issues, branches e Pull Requests seguindo o fluxo do repositório;
5. relatório final em português, com no máximo 1.500 palavras, no formato definido na seção 15.

## 2. Forma de trabalho e checkpoints obrigatórios

Pense internamente de forma passo a passo, mas **não exponha raciocínio privado ou uma transcrição de chain-of-thought**. Em vez disso, antes de cada etapa publique um checkpoint curto contendo: evidência observada, decisão tomada, arquivos previstos e risco principal. Ao terminar a etapa, informe o que foi verificado.

Não escreva código antes de concluir os checkpoints 0 a 3.

1. **Checkpoint 0 — pré-voo:** leia as regras, verifique Git/GitHub e preserve o trabalho existente.
2. **Checkpoint 1 — reprodução:** reproduza cada comportamento relevante no web dev e, quando aplicável, no Tauri.
3. **Checkpoint 2 — diagnóstico:** registre causas confirmadas e separe-as de hipóteses.
4. **Checkpoint 3 — plano de arquivos:** liste os arquivos e testes de cada pacote de trabalho.
5. **Checkpoint 4 — implementação incremental:** implemente um pacote por vez, sem misturar refactors não relacionados.
6. **Checkpoint 5 — testes:** execute testes focados após cada pacote.
7. **Checkpoint 6 — auditoria visual e motion:** valide dimensões, scroll, responsividade, foco e reduced motion.
8. **Checkpoint 7 — gates e PR:** execute todos os gates, revise o diff e abra/atualize PRs como rascunho.

Se uma hipótese estiver errada, ajuste o plano com base na evidência. Não force a implementação originalmente imaginada se o código demonstrar uma causa diferente.

## 3. Fontes obrigatórias e ordem de precedência

Antes de tocar no código, leia integralmente:

1. `AGENTS.md`;
2. `PRODUCT.md`;
3. `ARCHITECTURE.md`;
4. `UX_SPEC.md`;
5. `SECURITY.md`;
6. `CONTRIBUTING.md`;
7. `.github/ISSUE_TEMPLATE/*.md`;
8. `.github/PULL_REQUEST_TEMPLATE.md`;
9. `docs/plans/2026-08-23-plano-chat-v2-codex.md`.

Precedência para resolver conflitos:

1. solicitação explícita deste prompt;
2. segurança e privacidade de `SECURITY.md`;
3. decisões travadas de `ARCHITECTURE.md`;
4. contratos não negociáveis do chat em `UX_SPEC.md` §3.4;
5. demais especificações de UX.

Quando este lote altera uma regra anterior de UX — por exemplo, agrupamento de sessões na sidebar ou modelo padrão opcional — atualize `UX_SPEC.md` no mesmo PR. Não deixe documentação contraditória.

## 4. Restrições fixas do projeto

Reancore estas restrições no início de cada plano e antes de cada PR:

- stack travada: Tauri v2/Rust + React/Vite + sidecar Node/Bun/TypeScript;
- Python não participa de lógica geral do produto;
- licença MIT; todo arquivo novo de código mantém o cabeçalho usado no projeto;
- zero telemetria por padrão; nunca envie prompt, resposta, chave, arquivo, caminho ou argumento de ferramenta;
- nenhuma dependência nova sem demonstrar que a stack aprovada não resolve o problema;
- não rode `drizzle-kit generate`; migrações de SQLite são manuais em `sidecar/src/db/migrations.ts`;
- preserve o contrato de `SidecarChatStore`, fila FIFO, guards de sessão/epoch, permissões, anexos, resumo, usage dialog, command palette e hooks E2E existentes;
- mantenha `li.message-user`, `data-testid="chat-composer"`, `data-testid="provider-chip"`, `data-testid="session-statusline"` e os `menuitemradio` de permissões;
- toda UI nova ou alterada precisa de skeleton, lazy loading quando aplicável, entrada/saída, progresso em ação não instantânea e `prefers-reduced-motion`;
- execute a skill `design-motion-principles` em modo **Create** antes da implementação visual e em modo **Audit** antes do PR. Se a skill não existir no ambiente, instale uma única vez com o comando documentado em `AGENTS.md`;
- tema OLED monocromático, bordas finas, raios oficiais e contraste legível; não introduza cores saturadas, sombras decorativas ou “pill soup”;
- não altere visibilidade do repositório, proteção da `main`, releases, merge ou deploy sem autorização explícita do owner.

## 5. Estado inicial conhecido — confirme, não presuma

Snapshot local observado em 24 de agosto de 2026:

- branch ativa: `feat/197-ui-claude-desktop`;
- branch limpa e alinhada ao remoto no momento da inspeção;
- commits no topo incluem uma primeira reescrita do shell/sidebar e uma árvore de arquivos do Vault;
- `origin/main` não contém esses dois commits mais recentes;
- o remoto é `MateusGaio/Blackwall.`;
- `gh auth status` estava inválido. Revalide; se continuar inválido, pare toda ação externa e peça ao owner para executar `gh auth login -h github.com`.

Implementações parciais já existentes que devem ser avaliadas antes de qualquer reescrita:

- `src/app/shell/ProfileChooser.tsx` já contém ação de excluir perfil e `ConfirmDialog`;
- `src/app/App.tsx` e o sidecar já expõem o fluxo de exclusão de perfil;
- `src/app/shell/SessionsSidebar.tsx` já é uma primeira versão compacta da sidebar;
- `src/features/vault/components/VaultPanel.tsx` já contém `buildFileTree`, árvore hierárquica e testes iniciais;
- `sidecar/src/vault.ts` já ignora alguns diretórios, mas não `.venv` nem `.pytest_cache`;
- sessões já aceitam `selectedProviderId` e `selectedModel` nulos;
- provedores ainda guardam `model` como string obrigatória no fluxo de validação/UI;
- `ProviderManager` usa `ScrollArea`, mas o scroll por roda/trackpad precisa ser reproduzido e corrigido;
- `WorkspaceShell.tsx` ainda renderiza o símbolo decorativo `✳` no estado vazio.

Não reverta nem descarte esses commits. Não use `git reset --hard`, `git checkout --`, force push ou limpeza destrutiva.

## 6. Estratégia obrigatória de GitHub

### 6.1 Pré-voo

Execute, sem imprimir tokens:

```bash
git status --short --branch
git remote -v
gh auth status
gh repo view MateusGaio/Blackwall. --json isPrivate,defaultBranchRef
```

Depois consulte a Issue e o PR associados à branch/Issue `#197`. Não crie uma Issue duplicada antes de saber o escopo e estado de `#197`.

### 6.2 Organização recomendada

Use no máximo quatro pacotes rastreáveis, em vez de 16 PRs ou um diff monolítico:

1. **Perfis e onboarding** — comentários 1 a 5;
2. **Sidebar e agrupamento de sessões** — comentários 6 a 10;
3. **Composer, provedores e scroll** — comentários 11 a 13 e 16;
4. **Vault e sidebar direita** — comentários 14 e 15.

Se a Issue `#197` estiver aberta e descrever o redesign geral, use-a como Issue guarda-chuva. Crie Issues filhas tipadas apenas para pacotes não cobertos e relacione-as no corpo. Se já houver PR da `#197`, preserve-o como rascunho.

Para cada pacote independente:

- `type:bug` para scroll, duplicação e regressão vertical;
- `type:enhancement` para melhorar fluxos já existentes;
- `type:feature` somente quando surgir capacidade realmente nova;
- branch com número real da Issue: `fix/<N>-...` ou `feat/<N>-...`;
- se depender da branch atual ainda não integrada, use PR empilhado, base `feat/197-ui-claude-desktop` e declare `Depends on #<PR>`;
- caso o pacote já esteja legitimamente coberto por `#197`, continue a branch atual em commits pequenos e focados; não invente outro número;
- abra PR como rascunho e use `Closes #N` ou `Refs #N` corretamente;
- nunca faça merge em nome do owner.

Antes de push:

```bash
git diff --check
git status --short --branch
npm run check
npm run test:coverage
npm run e2e:ci
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

Também rode o motion audit e os testes focados descritos na seção 13. O Stryker é agendado e não bloqueia o PR, mas não remova nem enfraqueça sua configuração.

Use Conventional Commits, por exemplo:

```text
feat(sidebar): agrupa sessões por workspace
fix(providers): evita cadastros Ollama duplicados
fix(settings): restaura scroll por roda no diálogo
feat(vault): torna a árvore compacta e filtra diretórios internos
```

## 7. Contrato visual de alto nível

### 7.1 Sidebar esquerda

A sidebar deve privilegiar projetos e sessões, com ícones compactos. Estrutura-alvo:

```text
+ Novo
▣ Projetos                                      +

▾ Projeto ativo
  ○ Sessão A                                    …
  ○ Sessão B                                    …
▸ Outro projeto
▾ Sem workspace
  ○ Conversa livre                              …

[área rolável reservada a projetos e sessões]
─────────────────────────────────────────────────
Buscar comandos                                  ⌘K
[avatar 20px] Perfil
```

No topo devem existir apenas as ações primárias **Novo** e **Projetos/Workspaces** pedidas pelo owner. Não copie as entradas extras “Artefatos”, “Programado”, “Despacho” ou “Personalizar” do screenshot de referência; elas estão fora do escopo atual.

### 7.2 Composer

Estrutura-alvo aproximada:

```text
Escreva uma mensagem…

[anexar] [provedores] [permissão]       [Provedor › Modelo] [enviar/parar]
```

O botão **Provedores** é o segundo controle da esquerda. Ele abre diretamente a área de selecionar um provedor existente ou cadastrar/editar/remover um provedor. O seletor de modelo continua contextual e mostra somente modelos do provedor ativo.

### 7.3 Vault

O Vault continua como painel lateral **direito**, coerente com o comentário 14 e o split-pane existente. O toggle da direita deve espelhar visualmente o toggle da sidebar esquerda e usar ícone, não o texto “Vault”. A árvore deve começar compacta e legível; profundidade não pode empurrar o texto para fora do painel.

## 8. Requisitos funcionais detalhados por comentário

### Comentário 1 — excluir perfil na tela de escolha

**Ação:** finalize e valide a exclusão diretamente em cada linha de perfil de `ProfileChooser`.

Critérios:

- a ação é visível e identificável com mouse, teclado e leitor de tela;
- clicar em excluir não seleciona o perfil por propagação;
- abre confirmação explícita com nome do perfil e aviso de exclusão definitiva;
- durante a operação, bloqueia repetição e mostra progresso/estado ocupado;
- erro aparece inline e preserva a tela;
- ao excluir o último perfil, abre corretamente o onboarding de criação;
- a exclusão em cascata de workspaces, sessões e mensagens continua coberta por teste;
- aproveite o fluxo atual em vez de criar um segundo endpoint ou confirmação paralela.

### Comentário 2 — centralizar texto do botão “Escolher pasta”

**Ação:** centralize o bloco textual do card, sem perder o ícone à esquerda nem a área de clique integral.

Critérios quantificados:

- título e subtítulo alinhados visualmente ao centro do espaço útil do botão;
- card com altura consistente com a alternativa “Iniciar sem workspace”;
- não usar margens mágicas dependentes de um idioma;
- validar pt-BR e en, em 995×958 e 1920×958;
- foco visível, mouse e Enter continuam funcionando.

### Comentário 3 — Soul Builder menos agressiva que Dev

**Ação:** reposicione a Soul `Builder` como uma Soul de desenvolvimento colaborativa, mais leve e flexível que `Dev`.

Semântica obrigatória:

- `Builder` ajuda a entender, planejar, construir e revisar software;
- é prática e cuidadosa, mas não impõe automaticamente todo o ritual de gates/Issue/PR em brainstorming ou tarefas pequenas;
- faz perguntas focadas quando falta uma decisão material;
- verifica proporcionalmente ao risco e preserva privacidade;
- não se apresenta como uma Soul genérica de criatividade;
- `Dev` continua sendo a opção disciplinada, rigorosa e orientada a entrega de engenharia.

Atualize o prompt em `src/app/souls.ts` e as descrições pt-BR/en em `src/i18n.ts`. Atualize testes de identificação/presets sem tornar o teste dependente do texto integral quando uma asserção semântica for suficiente.

### Comentário 4 — pular contexto do workspace quando não há workspace

**Ação:** torne a sequência do onboarding dinâmica.

Critérios:

- ao escolher “Iniciar sem workspace”, pule `workspace-soul`;
- “Voltar” a partir da etapa seguinte retorna à etapa correta, sem cair na tela pulada;
- o contador e a barra usam o total real de etapas visíveis, não mostram “06/08” fantasma;
- Enter e clique usam a mesma máquina de navegação;
- se o usuário voltar, selecionar uma pasta e continuar, `workspace-soul` reaparece;
- não grave um contexto de workspace fictício no modo `workspaceMode: "none"`;
- mantenha o Vault desabilitado sem reservar coluna direita vazia, como já define `UX_SPEC.md`.

Evite espalhar condicionais por vários handlers. Derive uma lista `visibleOnboardingSteps` e navegue por ela.

### Comentário 5 — modelo padrão opcional

**Ação:** trate o campo atual como **Modelo padrão (opcional)** do provedor.

Regras:

- conectar um provedor continua obrigatório no onboarding; escolher um modelo padrão não;
- validação da conexão deve testar credencial/endpoint pela listagem de modelos ou operação equivalente, sem exigir modelo;
- mantenha compatibilidade de leitura com registros antigos que usam `model` como string;
- é aceitável manter internamente o campo `model` como string vazia para reduzir o alcance da mudança, desde que a semântica pública seja “default opcional” e os tipos/guards sejam seguros;
- se houver modelo padrão, uma nova sessão pode selecioná-lo e deve persistir `selectedProviderId`/`selectedModel` de forma explícita;
- sem modelo padrão, a nova sessão nasce com ambos nulos ou sem modelo selecionado e o usuário precisa escolher provedor/modelo antes do primeiro envio;
- não use silenciosamente `providers[0]`, `activeProvider.model` vazio ou `models[0]` para burlar essa escolha;
- o composer exibe “Escolher modelo”, mantém enviar desabilitado e mostra orientação inline acionável;
- o seletor só lista modelos pertencentes ao provedor escolhido;
- a API não pode iniciar streaming com modelo vazio.

Atualize `ProviderSetup`, `ProviderFormSection`, tipos da API, validação do sidecar, criação/seleção de sessão e testes de roteamento conforme necessário.

### Comentários 6, 7 e 8 — normalizar ícones e mover “Nova thread”

**Ação:** remova controles gigantes e transforme “Nova thread” em ação compacta `Novo` no topo.

Critérios:

- ícones usuais entre 14 e 18 px; avatar compacto de 20 px; controles de ícone entre 28 e 32 px;
- nenhum círculo, engrenagem ou ilustração decorativa ocupa a área reservada às listas;
- `Novo` aparece na área superior marcada pelo owner, não como card alto;
- o botão mostra progresso enquanto cria sessão e impede duplo clique;
- labels acessíveis não dependem apenas do ícone;
- a área entre o topo e o rodapé é integralmente usada para projetos e sessões.

### Comentário 9 — substituir a sidebar e agrupar sessões por projeto

**Ação:** reescreva `SessionsSidebar` se necessário. A referência visual é uma árvore compacta no estilo Codex, não uma cópia literal.

Contrato de dados e interação:

- use `SessionSummary.workspaceId` e `workspaceName` existentes;
- cada sessão aparece exatamente uma vez sob seu workspace;
- sessões com `workspaceId === null` ficam no grupo “Sem workspace”;
- dentro de cada grupo, ordenar por `updatedAt DESC`, desempate por `createdAt DESC`;
- ordenar workspaces pela ordem já fornecida pelo estado (`lastOpenedAt` no sidecar), com o ativo em destaque;
- grupo ativo começa expandido; estados de expansão podem ser locais e devem sobreviver a re-render da mesma montagem;
- menu único por sessão preserva renomear/excluir e confirmação destrutiva;
- clicar no nome do projeto abre o workspace; clicar na seta só expande/recolhe;
- `+` ao lado de Projetos abre o fluxo de criar workspace;
- a lista continua limitada ao contrato de até 30 sessões recentes por perfil, salvo mudança de produto explicitamente documentada;
- mantenha command palette, perfil e configurações acessíveis, sem dominar o espaço;
- sidebar recolhida mantém um toggle claro no header; não deixe engrenagem flutuante no rodapé da tela.

Atualize `UX_SPEC.md` §2 para descrever agrupamento por projeto e o grupo “Sem workspace”.

### Comentário 10 — remover o sol do estado vazio

**Ação:** remova o `✳` decorativo do centro.

Critérios:

- saudação e orientação continuam legíveis e equilibradas;
- não substitua o símbolo por outra ilustração gratuita;
- preserve o empty state explicativo e o skeleton de troca de sessão.

### Comentário 11 — composer mais legível e central de provedores

**Ação:** clareie a hierarquia do composer e separe gerenciamento de provedor de seleção de modelo.

Critérios:

- superfície do composer distingue-se do fundo com borda e contraste compatíveis com os tokens existentes;
- texto, placeholder e controles não ficam “pretos sobre preto”;
- primeiro controle: anexos quando habilitados; segundo controle: **Provedores**;
- o botão Provedores abre a área diretamente na seção de provedores, sem obrigar o usuário a percorrer perfil/uso/workspaces;
- essa área permite selecionar provedor existente e cadastrar, editar ou remover;
- reutilize a lógica do `ProviderManager`; não crie dois cadastros divergentes;
- o chip `Provedor › Modelo` abre apenas a seleção de modelos do provedor ativo;
- mudar provedor limpa modelo incompatível e aplica o default somente quando ele existe;
- nenhum modelo de outro provedor aparece no popover;
- preserve o mesmo slot do botão enviar/parar, fila, permissões, anexos, usage e test IDs contratuais;
- não implemente microfone, voz ou outros controles só porque aparecem na imagem de referência.

Uma solução aceitável é dar ao `ProviderManager` uma seção/aba inicial (`initialSection="providers"`) e abrir essa seção pelo novo atalho, mantendo Configurações para o fluxo completo.

### Comentário 12 — scroll do mouse no modal

**Ação:** reproduza e corrija o scroll por roda e trackpad no diálogo de configurações/provedores.

Critérios:

- com viewport 1920×958 e conteúdo maior que 85vh, a roda altera `scrollTop` do viewport correto;
- trackpad, arraste da scrollbar, PageDown, setas e Tab continuam úteis;
- header/fechar podem ficar fixos, conteúdo deve ser rolável até a última ação;
- selects/popovers internos continuam rolando sem bloquear o diálogo depois de fechados;
- overlay não recebe o wheel destinado ao conteúdo;
- não resolva adicionando scroll à página por trás do modal;
- adicione teste E2E que mede `scrollTop > 0` após `page.mouse.wheel`.

Investigue `DialogContent`, `ScrollArea.Root/Viewport` e a cadeia `flex/min-h-0/overflow`. Corrija a causa, não apenas esconda a scrollbar.

### Comentário 13 — provedores/modelos duplicados, especialmente Ollama

**Ação:** confirme a causa e corrija tanto novos cadastros quanto dados legados seguros.

Hipótese inicial a verificar:

- `saveProvider` cria UUID novo em todo submit sem `id`;
- o modelo obrigatório fica embutido em `providers.json`;
- o fluxo incentiva cadastrar o mesmo endpoint novamente para cada modelo;
- `ProviderList` renderiza cada registro sem reconciliação.

Modelo conceitual obrigatório:

- **provedor é uma conexão/endpoint/credencial**;
- **modelo pertence ao catálogo daquele provedor**;
- adicionar outro modelo ao mesmo Ollama não cria outro card “Ollama local”.

Regras de correção:

- para Ollama, normalize o endpoint e torne o cadastro idempotente por endpoint canônico;
- sincronize modelos na tabela `models`, cuja chave já é única por `(provider_id, model_id)`;
- dedupe IDs de modelos retornados pela API antes de renderizar/salvar;
- não dedupe automaticamente dois provedores OpenAI-compatible apenas pelo endpoint: contas/chaves diferentes podem ser intencionais;
- para OpenAI-compatible, só faça merge automático quando tipo, endpoint normalizado, nome normalizado e identidade da credencial forem comprovadamente iguais, sem registrar a chave;
- nunca exponha, logue ou envie hash/segredo para telemetria, Issue ou PR;
- para duplicatas Ollama legadas, escolha um keeper determinístico e reconcilie referências antes de remover duplicatas;
- preserve ou reconcilie referências em sessões, roteador, modelos, mensagens e tabelas de uso/limites que apontem para provider IDs;
- faça a reconciliação local de modo idempotente e transacional onde houver SQLite;
- atualize `providers.json` de forma segura; não destrua configurações ambíguas;
- se duas credenciais não puderem ser provadas iguais, apresente ação explícita de mesclar/remover em vez de apagar;
- teste duas submissões idênticas de Ollama e confirme um provedor com N modelos, não N provedores.

Antes de escolher migração ou normalização em startup, inspecione todas as tabelas e referências reais. Siga ADR-12; não use geração automática de schema.

### Comentário 14 — botão de expandir/recolher Vault

**Ação:** substitua o label textual “Vault” no header por toggle de painel direito.

Critérios:

- ícone de painel espelhado em relação ao toggle esquerdo;
- `aria-label`, `title`, `aria-expanded` e estado ativo claros em pt-BR/en;
- abre, recolhe e restaura a largura do Vault;
- foco visível e alvo de 32 px;
- não confundir esse toggle com as tabs Arquivos/Grafo dentro do Vault;
- quando não há workspace, o botão continua visível e mostra o bloqueio/ação já previsto em `UX_SPEC.md`.

### Comentário 15 — reconstruir a árvore de arquivos do Vault

**Ação:** torne o explorador compacto, filtrado e utilizável. Aproveite `buildFileTree`, mas substitua a apresentação atual quando necessário.

Critérios:

- filtrar, no sidecar, pelo menos `.git`, `.blackwall`, `node_modules`, `dist`, `build`, `out`, `target`, `coverage`, `.venv`, `venv`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.tox`, `__pycache__` e diretórios equivalentes de cache/vendor;
- continuar ignorando symlinks e arquivos acima do limite de tamanho;
- árvore realmente separada por pastas, com ícones compactos de pasta/arquivo;
- pastas começam recolhidas, exceto ancestrais do arquivo ativo quando houver;
- indentação entre 10 e 12 px por nível, limitada visualmente; nomes usam ellipsis e `title`/tooltip;
- clique em pasta expande; clique em arquivo abre preview; Enter/Espaço funcionam;
- mostrar breadcrumb/caminho legível no preview sem desperdiçar largura;
- linhas entre 26 e 30 px; nenhum conteúdo pode ficar totalmente fora do painel por profundidade;
- estado vazio explica que só Markdown é exibido;
- scroll vertical e horizontal, se indispensável, funcionam com mouse; prefira truncar a exigir horizontal;
- mantenha a aba Grafo e o `d3-force` fora do refactor, salvo ajustes necessários de layout;
- adicione testes do filtro de diretórios e da árvore profunda/colapsada.

### Comentário 16 — composer sobe ao abrir as sidebars

**Ação:** estabilize o eixo vertical do chat ao abrir/recolher sidebar esquerda e Vault direito.

Critérios quantificados:

- em viewport 1920×958, o `top` do composer pode variar no máximo 2 px ao alternar cada painel;
- abrir os dois painéis altera a largura útil, não a ancoragem inferior;
- o composer permanece até 16 px acima da borda inferior da área de chat;
- textarea pode crescer até o limite existente, empurrando o transcript para cima, nunca movendo todo o shell;
- transcript e empty state usam `min-h-0`, overflow e flex corretamente;
- não use `position: fixed` global que sobreponha aprovações, anexos ou mensagens de erro;
- adicione E2E que compare `boundingBox().y` com painéis fechados, esquerdo aberto e ambos abertos.

## 9. Arquivos prováveis — confirme no checkpoint 3

Frontend e UX:

- `src/app/App.tsx`
- `src/app/onboarding.ts`
- `src/app/onboarding.test.ts`
- `src/app/souls.ts`
- `src/app/souls.test.ts`
- `src/app/WorkspaceShell.tsx`
- `src/app/shell/ProfileChooser.tsx`
- `src/app/shell/ProfileChooser.test.tsx`
- `src/app/shell/SessionsSidebar.tsx`
- `src/app/shell/ChatHeader.tsx`
- `src/app/shell/Composer.tsx`
- `src/app/shell/VaultSlot.tsx`
- `src/app/shell/CompactIcon.tsx`
- `src/features/config/components/ProviderManager.tsx`
- `src/features/config/components/ProviderSetup.tsx`
- `src/features/config/components/provider-manager/ProviderFormSection.tsx`
- `src/features/config/components/provider-manager/ProviderList.tsx`
- `src/features/config/components/provider-manager/useModelOptions.ts`
- `src/features/vault/components/VaultPanel.tsx`
- `src/features/vault/components/vault-file-tree.test.ts`
- `src/shared/components/ui/dialog.tsx`
- `src/shared/components/ui/scroll-area.tsx`
- `src/shared/api/sidecar.ts`
- `src/i18n.ts`
- `src/styles/index.css`

Sidecar e persistência:

- `sidecar/src/providers.ts`
- `sidecar/src/providers.test.ts`
- `sidecar/src/index.ts`
- `sidecar/src/index.test.ts`
- `sidecar/src/db/store.ts`
- `sidecar/src/db/store.test.ts`
- `sidecar/src/db/migrations.ts`, apenas se uma migração real for necessária
- `sidecar/src/db/schema.ts`, em paralelo com qualquer alteração de schema
- `sidecar/src/vault.ts`
- `sidecar/src/vault.test.ts`

E2E e documentação:

- `e2e/onboarding-chat.spec.ts`
- crie specs focadas adicionais somente quando melhorarem legibilidade/manutenção;
- `UX_SPEC.md`
- `ARCHITECTURE.md` se a semântica persistida de provedor/default mudar;
- `PRODUCT.md` somente se o comportamento de produto público mudar materialmente.

Não toque em todos esses arquivos por obrigação. Use a menor superfície coerente que satisfaça os contratos e testes.

## 10. Requisitos de acessibilidade e interação

Embora o projeto não declare conformidade formal WCAG AA, estes itens são obrigatórios:

- todas as ações funcionam com mouse;
- fluxos principais funcionam com teclado;
- ícones possuem nome acessível quando carregam ação;
- foco visível nunca é removido sem substituto;
- `aria-expanded`, `aria-pressed`, `aria-busy`, `role="menu"` e `menuitem` refletem o estado real;
- confirmação destrutiva recebe foco e devolve foco de forma previsível;
- mensagens de erro/status usam regiões apropriadas sem anunciar em loop;
- pt-BR e en não quebram layout;
- `prefers-reduced-motion` elimina transições sem remover informação.

## 11. Estados de carregamento, vazio, progresso e saída

Para cada superfície alterada, documente no PR:

| Superfície | Loading/skeleton | Empty state | Progresso | Entrada/saída |
|---|---|---|---|---|
| Perfil | lista existente ou skeleton de bootstrap | último perfil leva ao onboarding | excluir/selecionar ocupados | confirmação e linha respeitam reduced motion |
| Sidebar | skeleton ao trocar sessão | grupo sem sessões com orientação curta | criar sessão ocupado | expansão/recolhimento curto |
| Provedores | skeleton/listagem de modelos | nenhum provedor/modelo com CTA | listar/testar/salvar | modal/popover com saída |
| Vault | skeleton existente | nenhum Markdown com explicação | refresh/indexação quando aplicável | pasta/painel respeitam reduced motion |
| Composer | preserva estado atual | “Escolher modelo” acionável | enviar/parar/fila | não salta ao abrir painéis |

Não adicione spinner genérico quando o nome da operação puder ser mostrado.

## 12. Plano de testes obrigatório

### 12.1 Unitários/frontend

- lista dinâmica de onboarding inclui/exclui `workspace-soul` e navega corretamente para frente/trás;
- Soul Builder é identificada e semanticamente distinta de Dev;
- agrupador da sidebar coloca sessões em workspace correto, “Sem workspace”, ordem correta e nenhuma duplicata;
- árvore do Vault ordena pastas antes de arquivos, inicia recolhida e lida com profundidade;
- seleção de provedor filtra modelos pelo provider ID;
- estado sem default não habilita envio e não faz fallback silencioso;
- toggles de sidebar/Vault expõem estado ARIA correto;
- exclusão de perfil não dispara seleção.

### 12.2 Sidecar/integrados

- provedor OpenAI-compatible e Ollama podem ser validados/salvos sem modelo padrão;
- streaming rejeita modelo vazio com erro acionável;
- duas conexões idênticas do mesmo Ollama resultam em um provedor;
- modelos duplicados retornados pelo endpoint viram uma entrada por ID;
- reconciliação legada é idempotente e preserva referências;
- dois provedores OpenAI-compatible com credenciais distintas não são mesclados;
- criação de sessão com default persiste a seleção; sem default permanece nula;
- exclusão de perfil mantém cascatas atuais;
- scanner do Vault ignora todos os diretórios internos definidos.

### 12.3 E2E/Playwright

Cubra pelo menos:

1. escolher pasta e verificar texto centralizado/fluxo normal;
2. iniciar sem workspace e confirmar que contexto do workspace foi pulado;
3. excluir perfil pelo chooser com cancelamento e confirmação;
4. sidebar agrupa sessões em dois projetos e “Sem workspace”;
5. botão Novo cria uma única sessão mesmo sob clique repetido;
6. atalho Provedores abre diretamente a seção correta;
7. cadastrar Ollama, listar múltiplos modelos e continuar com um único card de provedor;
8. salvar provedor sem default, criar sessão e exigir escolha de modelo;
9. rolar diálogo com `page.mouse.wheel` e alcançar a última ação;
10. abrir/recolher sidebar e Vault mantendo Y do composer com tolerância de 2 px;
11. Vault ignora `.venv`/`.pytest_cache`, expande pastas e abre nota;
12. toggle direito abre/recolhe Vault e mostra bloqueio sem workspace.

Use dados totalmente sintéticos. Nunca use nomes, caminhos, chaves, prompts ou workspaces reais nas fixtures, screenshots ou logs.

## 13. Verificação visual e motion

Valide, no mínimo, estas matrizes:

| Viewport | Sidebar esquerda | Vault | Cenário |
|---|---|---|---|
| 995×958 | aberta | fechado | chooser/onboarding |
| 1280×800 | aberta | aberto | chat com sessão e árvore profunda |
| 1920×958 | fechada | fechado | composer baseline |
| 1920×958 | aberta | fechado | composer baseline |
| 1920×958 | aberta | aberto | composer baseline + Vault |

Para cada uma:

- capture screenshot antes/depois para o PR usando apenas dados sintéticos;
- confirme ausência de clipping, ícones gigantes e texto ilegível;
- confirme scroll por mouse;
- teste `prefers-reduced-motion: reduce`;
- verifique foco via Tab/Shift+Tab;
- confirme que o painel menos prioritário colapsa primeiro em largura reduzida;
- rode `design-motion-principles` em Audit e registre apenas achados/decisões verificáveis.

## 14. Critério de aceite consolidado — 16/16

Não declare conclusão até todos os itens estarem comprovados:

- [ ] 1. Excluir perfil está disponível e confirmado no chooser.
- [ ] 2. Texto de “Escolher pasta” está centralizado nos dois idiomas.
- [ ] 3. Builder é Dev mais leve/colaborativa, não uma Dev rigorosa duplicada.
- [ ] 4. Sem workspace pula contexto e recalcula progresso/navegação.
- [ ] 5. Modelo padrão é opcional e ausência exige escolha por sessão.
- [ ] 6. Ícones da sidebar estão normalizados.
- [ ] 7. Nova thread virou ação compacta.
- [ ] 8. A ação Novo ocupa a área superior indicada.
- [ ] 9. Sessões estão agrupadas por projeto e Sem workspace.
- [ ] 10. O sol/`✳` foi removido.
- [ ] 11. Composer está legível e tem atalho Provedores na segunda posição.
- [ ] 12. Scroll de roda/trackpad funciona no diálogo.
- [ ] 13. Ollama/modelos não duplicam e dados legados seguros são reconciliados.
- [ ] 14. Toggle do Vault espelha o toggle da sidebar esquerda.
- [ ] 15. Vault está filtrado, compacto, hierárquico e útil.
- [ ] 16. Composer não sobe ao abrir os painéis.
- [ ] Hooks e contratos do chat v2 continuam intactos.
- [ ] pt-BR e en foram atualizados.
- [ ] Skeleton/lazy/entrada/saída/progresso/reduced-motion foram auditados.
- [ ] Biome, Knip, dependency-cruiser, Vitest, cobertura, Playwright, build e cargo check passaram.
- [ ] Diff não contém segredo, conteúdo privado, caminho pessoal ou fixture real.
- [ ] Documentação e rastreabilidade GitHub estão atualizadas.

## 15. Formato exato do relatório final do OX ALPHA

Responda em português, sem caveman-speak e sem alegar sucesso não verificado. Use esta ordem:

1. **Resultado:** 3 a 6 frases com o estado geral.
2. **Rastreabilidade:** links das Issues, branches e PRs; indique PRs empilhados e bases.
3. **Matriz 16/16:** tabela com `#`, `resultado`, `arquivos principais`, `teste/evidência`.
4. **Diagnósticos confirmados:** causas do scroll, duplicação e salto vertical; diferencie hipótese descartada.
5. **Quality gates:** tabela com comando, resultado e duração aproximada; inclua falhas honestamente.
6. **Auditoria visual/motion:** viewports testados, screenshots sintéticos e achados de reduced motion.
7. **Riscos residuais:** no máximo 5 bullets; escreva “nenhum conhecido” se realmente não houver.
8. **Ação do owner:** diga claramente que os PRs estão em rascunho e aguardam revisão; não faça merge.

Não inclua chain-of-thought, tokens, segredos, conteúdo de conversas, caminhos pessoais ou dumps. Inclua somente evidências técnicas reproduzíveis e decisões resumidas.

## 16. Condições de parada

Pare e peça direção ao owner se:

- `#197` ou seu PR tiver escopo incompatível e a base correta não puder ser determinada;
- houver mudanças locais não relacionadas que colidam com os mesmos arquivos;
- uma migração exigir apagar ou mesclar credenciais ambíguas;
- o GitHub continuar sem autenticação no momento de criar/atualizar Issue ou PR;
- completar a tarefa exigir nova dependência sem alternativa aprovada;
- houver risco de expor segredo, dados reais ou conteúdo de workspace;
- for necessário alterar ADR travado além das mudanças explicitamente pedidas aqui.

Enquanto uma condição de parada não ocorrer, avance de forma autônoma, incremental e verificável até cumprir o checklist 16/16.

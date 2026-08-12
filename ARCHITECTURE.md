# Blackwall — Architecture Plan

**Status:** Proposed
**Deciders:** Mateus (owner), agentes de IA contribuintes (Codex e outros)

---

## 1. Contexto e objetivo

Blackwall é um harness de IA local-first, open source e gratuito, com foco em código. Ele combina, num único app desktop:

- Perfis + Workspaces + Souls (prompt base combinável)
- Um Vault estilo Obsidian embutido (notas reais em `.md`, grafo de conhecimento, RAG)
- Um roteador de modelos com fallback automático entre APIs gratuitas
- Suporte a MCP como cliente e como servidor
- Orquestração de agentes/swarm com visualização em grafo
- Treinamento local via LoRA/QLoRA (fase avançada, opcional)
- Interface monocromática OLED (preto, cinza, branco), com motion design intencional em todos os componentes

Este documento define a stack técnica, as decisões de arquitetura e o roadmap em fases.

---

## 2. Decisões de arquitetura (ADRs resumidos)

### ADR-01: Shell do app — Tauri v2, não Electron

**Decisão:** usar Tauri v2 (núcleo em Rust) + WebView nativo do sistema operacional.

**Alternativas consideradas:**
| Opção | Complexidade | Consumo de recursos | Observação |
|---|---|---|---|
| Electron + React + Vite | Baixa (já testada) | Alto (Chromium embutido) | Já tentado, ficou pesado |
| Go + Vite (Wails-like manual) | Alta | Baixo | Já tentado, faltou "cola" madura entre backend e webview |
| **Tauri v2 + React + Vite** | Média | Baixo | WebView do próprio SO, binário e RAM muito menores |

**Consequência:** precisamos de um pouco de Rust para a camada de sistema (janela, filesystem, keychain), mas o ecossistema de IA (SDK de MCP, embeddings, orquestração) continua em TypeScript, rodando como processo sidecar.

### ADR-02: Padrão cliente-servidor local (inspirado no OpenCode)

**Decisão:** dentro do próprio processo local, separar:
- **Shell Tauri (Rust)**: janela, filesystem, secrets, performance nativa.
- **Sidecar Node/Bun (TypeScript)**: toda a lógica de IA — chamadas de modelo, roteador, MCP client/server, RAG, embeddings, orquestração de agentes.
- **Frontend React/Vite**: interface, consumindo o sidecar via IPC/HTTP local.

Esse é o mesmo padrão que o OpenCode usa (servidor local em TypeScript/Bun + clientes que falam com ele via API), o que facilita reaproveitar bibliotecas do ecossistema de IA (que é majoritariamente TS) sem reescrever tudo em Rust.

### ADR-03: Armazenamento local

| Dado | Tecnologia | Motivo |
|---|---|---|
| Perfis, workspaces, sessões, config do router | SQLite | Relacional, transacional, zero servidor |
| Notas / Vault | Arquivos `.md` reais em disco, com `[[wikilinks]]` | Compatibilidade real com Obsidian |
| Embeddings / RAG | LanceDB (embarcado, sem servidor) | Nativo em TS, zero infraestrutura extra, ideal para app local |

### ADR-04: Embeddings — local ou API (configurável)

Padrão: modelo local via Ollama (ex. `nomic-embed-text`) se detectado na máquina. Fallback/alternativa: qualquer endpoint de embeddings compatível com OpenAI, configurado pelo usuário.

### ADR-05: Roteador de modelos

Fallback sequencial configurável — o usuário define uma lista ordenada de (provedor, modelo, chave). Em erro de rate-limit/quota, o harness tenta o próximo da lista automaticamente. Não é roteamento por tipo de tarefa na v1 — isso pode virar uma evolução futura opcional.

Provedores de referência para o v1: OpenRouter, Groq, Gemini (free tier), OpenCode Zen, e um slot genérico "custom OpenAI-compatible endpoint".

### ADR-06: Observabilidade — OpenTelemetry como padrão, Sentry como backend padrão

**Decisão:** instrumentar tudo com **OpenTelemetry** (traces, métricas, logs) — é vendor-neutral, então trocar de backend depois é só trocar exporter, não reescrever instrumentação.

Como backend padrão de erro/crash: **Sentry** (tem tier gratuito generoso para projetos open source e pode ser self-hosted). **Datadog** e **New Relic** ficam como exporters *opcionais* via OTel, para quando/se o projeto crescer e precisar de APM mais robusto — não fazem sentido como dependência obrigatória num app local-first gratuito, porque ambos são pagos e orientados a uso.

**Importante (privacidade):** como o Blackwall roda local e guarda dados sensíveis (chaves de API, conversas), toda telemetria deve ser:
- Desligada por padrão (opt-in explícito na primeira execução);
- Anonimizada (sem conteúdo de prompts/respostas, só métricas de erro/performance);
- Documentada claramente no PRODUCT.md e nas configurações.

### ADR-07: Qualidade de código

| Categoria | Ferramenta | Papel |
|---|---|---|
| Lint + format | **Biome** | Substitui ESLint+Prettier, mais rápido, um único binário |
| Dead code / deps não usadas | **Knip** | Detecta exports, arquivos e dependências órfãs |
| Contrato de arquitetura ("arch-contract") | **dependency-cruiser** + `eslint-plugin-boundaries` | Define e valida regras de import entre camadas (ex: UI não pode importar direto do sidecar de IA) |
| Padrão de commit | **commitlint** (Conventional Commits) | Garante histórico legível e permite gerar changelog automático |
| Teste de mutação | **Stryker Mutator** | Valida se os testes realmente pegam bugs (roda em job agendado, não bloqueia todo PR — é lento) |

### ADR-08: Testes

- **Unitário + integração**: Vitest (nativo do ecossistema Vite que já estamos usando).
- **End-to-end**: Playwright, cobrindo os fluxos críticos (criar workspace, trocar Soul, enviar mensagem, criar nota, trocar modelo no fallback).
- **Cobertura**: Codecov, com gate mínimo de cobertura configurável por PR.

### ADR-09: Motion design

**Decisão:** instalar a skill `kylezantos/design-motion-principles` (`npx skills add kylezantos/design-motion-principles`) e usá-la em dois modos:
- **Create**: ao construir qualquer componente novo de UI.
- **Audit**: periodicamente, e obrigatoriamente antes de mergear qualquer PR que toque em UI.

**Regra de UI obrigatória para todo componente:**
1. Estado de **skeleton** enquanto carrega dados.
2. **Lazy loading** de rotas/telas pesadas (`React.lazy` + `Suspense`).
3. Animação de **entrada e saída** (não só entrada — todo elemento que desmonta precisa de transição de saída).
4. Indicador de **progresso** em qualquer ação que não seja instantânea (determinado quando possível, indeterminado como fallback).
5. Respeitar `prefers-reduced-motion` sem exceção (item não-negociável da própria skill).

### ADR-10: Licença

MIT. Justificativa: harness 100% local (o risco de "alguém pega meu código e vende como SaaS fechado" é baixo, já que não há componente de servidor central), e MIT maximiza adoção/contribuição — é a mesma escolha do OpenCode, projeto mais próximo do que estamos construindo.

### ADR-11: IPC e tempo real — WebSocket único do sidecar, consumido por qualquer janela/painel

**Decisão:** o sidecar Node/Bun expõe um servidor WebSocket local (`ws://127.0.0.1:<porta>`). Toda janela/painel do frontend (chat, grafo do Vault, grafo de agentes, dashboard) abre **uma única conexão WS** com o sidecar e assina só os tópicos que aquele painel precisa (ex: `session:123`, `vault:graph`, `agents:swarm:456`). O shell Rust só cuida de subir o sidecar como processo (via API de sidecar do Tauri) e encontrar uma porta livre — ele não fica no meio do caminho dos dados, para não duplicar latência.

Isso resolve três pontos ao mesmo tempo:
- **Streaming (ponto 2):** a resposta do modelo chega como mensagens WS token a token — o mesmo efeito "digitando" do ChatGPT.
- **Duas visões abertas ao mesmo tempo (ponto 4):** como as duas visões (ex: chat à esquerda, grafo à direita) assinam o mesmo WS, qualquer mudança de estado é publicada uma vez pelo sidecar e chega em tempo real nas duas, sem polling e sem cada painel ter sua própria cópia da lógica de sincronização — que é a causa mais comum de dados dessincronizados entre painéis (o problema que você mencionou ter tido antes).
- **Sem gambiarra de porta:** a porta é decidida em runtime pelo Rust e passada para o frontend via variável de ambiente/config, nunca hardcoded — evita o bug clássico de porta fixa que quebra em produção.

**Nota de design importante:** "duas janelas ao mesmo tempo" pode significar duas janelas de sistema operacional separadas, ou dois painéis dentro de uma janela só. Recomendo começar com **um único painel dividido (split-pane) redimensionável e colapsável** (ver ADR de UX) em vez de duas janelas reais de SO — é mais simples de sincronizar, mais fácil de testar, e ainda cobre exatamente o cenário que você descreveu (grafo de um lado, chat do outro). Se no futuro você quiser "destacar" o grafo para uma janela de verdade, a arquitetura de WS já suporta isso sem mudança — é só mais um cliente assinando o mesmo tópico.

### ADR-12: Migração de schema do SQLite

**Decisão:** usar **Drizzle ORM** com seu gerador de migrações (`drizzle-kit`). Cada mudança de schema gera um arquivo de migração numerado (`0001_init.sql`, `0002_add_soul_column.sql`, ...), e o sidecar roda as migrações pendentes automaticamente na inicialização, guardando o número da última aplicada numa tabela `_migrations`. Isso significa que quem já tem dados salvos nunca perde nada — a migração só adiciona/ajusta estrutura, os dados antigos continuam lá.

Isso é orquestrado pelo próprio código do sidecar (o agente que for implementar isso não precisa que você entenda SQL — só precisa rodar `drizzle-kit generate` sempre que o schema mudar).

### ADR-13: Concorrência — janelas/painéis simultâneos sobre o mesmo Vault/SQLite

**Decisão:** existe **um único sidecar rodando por instância do app**, e ele é a única coisa que escreve no SQLite e no Vault. Todos os painéis (mesma janela ou múltiplas) falam com esse mesmo sidecar via WS — nenhum painel escreve direto no disco. Isso elimina o problema clássico de corrupção por escrita simultânea, porque só existe um escritor.

- SQLite roda em modo **WAL** (Write-Ahead Logging), que permite leituras concorrentes rápidas mesmo com escrita acontecendo.
- Mudanças no Vault (arquivos `.md`) passam por um **file watcher** no sidecar: se o usuário editar uma nota direto no Obsidian por fora do Blackwall, o sidecar detecta e propaga a mudança via WS para os painéis abertos — mantendo o grafo e o RAG sempre atualizados.

### ADR-14: Onde ficam as API keys

**Decisão (conforme solicitado):** arquivo local, não o keychain do sistema operacional. Estrutura:
- Um arquivo `secrets.enc` criptografado com **AES-256-GCM**.
- A chave de criptografia fica num segundo arquivo (`secrets.key`), gerado aleatoriamente na primeira execução, com permissão de arquivo restrita ao usuário (equivalente a `chmod 600` — só o próprio usuário do sistema consegue ler).

**Nota honesta sobre segurança:** isso é mais simples e 100% dentro do que você pediu (arquivo local, sem depender de keychain do SO), mas é objetivamente menos protegido do que usar o keychain nativo — qualquer processo rodando com o mesmo usuário do sistema operacional consegue, em teoria, ler os dois arquivos. Isso é aceitável para a maioria dos usuários de um harness local. Se em algum momento você quiser subir o nível de proteção, o caminho natural é adicionar uma senha mestra opcional que participa da derivação da chave — mas isso fica como melhoria futura, não bloqueia o MVP.

### ADR-15: Permissões de servidores MCP

**Decisão:** cada conexão MCP configurada pelo usuário tem uma matriz de permissão própria (quais ferramentas do servidor MCP estão habilitadas, se ele pode acessar filesystem, se pode ver outras chaves de API configuradas no Blackwall). Padrão é restritivo (nada liberado até o usuário habilitar), mas o usuário tem liberdade total para abrir o que quiser — exatamente como você pediu.

### ADR-16: Política de retry do roteador

**Decisão:** até **8 tentativas** na lista de fallback, com backoff exponencial curto entre elas. Durante as tentativas, o usuário vê o nome do provedor sendo tentado no momento (não um spinner genérico) — isso também resolve o ponto 15 de UX (mensagem de erro final acionável, não um stack trace).

### ADR-17: Atualização do app

**Decisão:** plugin de updater nativo do Tauri, apontando para um manifesto JSON hospedado como asset de **GitHub Releases** — não precisa de servidor de update pago. O app verifica esse manifesto, baixa e verifica a assinatura do release novo, e aplica. Isso dá update automático (o usuário só confirma) sem infraestrutura extra.

### ADR-18: Internacionalização

**Decisão:** `react-i18next`, com dois locales prontos no v1: `en` e `pt-BR`. Na primeira execução, o Blackwall detecta o idioma do sistema operacional e sugere esse locale como padrão; o usuário pode trocar livremente depois nas configurações.

### ADR-19: Escala do Vault e reindexação

**Decisão:** projetando para **300–500 notas por workspace** por enquanto. Cada workspace tem sua própria tabela no LanceDB. Reindexação é **incremental por nota** — quando uma nota é criada/editada, só ela é re-embeddada e atualizada no índice (debounced, para não reindexar a cada tecla digitada). Uma reindexação completa manual fica disponível como comando, para os casos raros de precisar reconstruir o índice do zero.

### ADR-20: Estratégia de contexto — cache e compactação (inspirado no OpenCode)

Pesquisei especificamente como o OpenCode faz isso, porque você pediu esse padrão. Ele combina duas técnicas, e o Blackwall replica as duas:

1. **Prompt caching do próprio provedor**: a maioria dos provedores (OpenAI, Anthropic, etc.) cobra até 90% mais barato por tokens repetidos, *se* esses tokens aparecerem sempre no mesmo lugar e na mesma ordem no início do prompt. Por isso, o Blackwall monta o prompt sempre na mesma ordem fixa: Soul → definição de ferramentas/MCP → contexto do RAG relevante e estável → histórico da conversa (a parte que mais muda) por último. Isso maximiza os "cache hits" sem nenhum código especial — é só disciplina na montagem do prompt.
2. **Compactação proativa de contexto**: em vez de esperar bater 95-99% do limite da janela de contexto (que causa perda de informação abrupta), o sidecar monitora o uso de tokens continuamente e, quando a conversa se aproxima do limite, resume automaticamente as partes mais antigas do histórico em um resumo denso, preservando decisões e fatos importantes — o mesmo que o OpenCode faz com sua função de "compaction". Saídas de ferramentas duplicadas ou já obsoletas (ex: o mesmo arquivo lido duas vezes) são descartadas antes mesmo de entrar no histórico.

### ADR-21: Fila de mensagens

**Decisão:** se o usuário enviar uma nova mensagem enquanto a anterior ainda está sendo processada (no mesmo workspace), ela entra numa fila simples (FIFO) e é exibida como "na fila" até a anterior terminar. Sem paralelismo dentro do mesmo workspace — isso evita respostas se misturando na mesma conversa.

---

## 3. Stack resumida

```
┌─────────────────────────────────────────┐
│  Tauri Shell (Rust)                      │
│  - janela, filesystem, keychain          │
├─────────────────────────────────────────┤
│  Frontend (React + Vite + Tailwind)      │
│  - tema OLED preto/cinza/branco          │
│  - design-motion-principles (skill)      │
├─────────────────────────────────────────┤
│  Sidecar (Node/Bun + TypeScript)         │
│  - Roteador de modelos                   │
│  - MCP client + server                   │
│  - RAG (LanceDB) + embeddings            │
│  - Orquestrador de agentes               │
├─────────────────────────────────────────┤
│  Storage local                           │
│  - SQLite (perfis/sessões/config)        │
│  - Vault .md real (Obsidian-compatível)  │
│  - LanceDB (vetores)                     │
├─────────────────────────────────────────┤
│  Sidecar Python (opcional, Fase 3)       │
│  - LoRA/QLoRA via peft + Unsloth         │
└─────────────────────────────────────────┘
```

---

## 4. Roadmap em fases

### Fase 0 — Fundação do repositório
- Scaffolding Tauri + React/Vite + sidecar Node/Bun.
- CI básico no GitHub Actions: Biome, Knip, dependency-cruiser, Vitest, Codecov.
- `AGENTS.md`, `PRODUCT.md`, `ARCHITECTURE.md` publicados.
- OpenTelemetry instrumentado desde o início (mesmo com exporter "no-op" por padrão).
- Templates de Issue e PR configurados.

### Fase 1 — MVP funcional
- Perfis + Workspaces + Souls (combináveis: Soul do perfil + Soul do workspace).
- SQLite para sessões/histórico, com "voltar em sessões anteriores".
- Conexão com APIs (chave própria do usuário + endpoint custom compatível com OpenAI).
- Roteador de fallback sequencial configurável.
- Tema OLED preto/cinza/branco funcionando, com skeleton/lazy/animações desde o primeiro componente.
- Sentry + OTel básico habilitado (opt-in).
- Suite de testes unitários cobrindo roteador e persistência; primeiro fluxo E2E no Playwright.

### Fase 2 — Vault, RAG e MCP
- Aba de Vault com grafo real do Obsidian, visualizador de markdown, notas.
- Autodetecção de "crie uma nota sobre isso" no chat + comando `/nota`.
- RAG com LanceDB, embeddings locais (Ollama) ou API, configurável.
- MCP client (consumir servidores externos) e MCP server (expor o Blackwall).
- Motion audit completo da interface do Vault.

### Fase 3 — Agentes, swarm e treino local
- Orquestrador de agentes com visualização em grafo de execução.
- Suporte a subagentes (padrão orquestrador → subagentes registrados → resultado estruturado).
- Sidecar Python opcional para LoRA/QLoRA (Unsloth + peft), com checagem de VRAM disponível antes de habilitar a feature.
- Mutation testing (Stryker) entrando no pipeline agendado.
- Avaliação de exporters adicionais de observabilidade (Datadog/New Relic) se o projeto crescer.

---

## 5. Riscos e pontos abertos

- **Rust como barreira de entrada** para contribuidores que só conhecem TS — mitigar mantendo a superfície de Rust pequena (só o shell, não a lógica de IA).
- **Custo de manter 3 sidecars** (Rust + Node + Python opcional) — mitigar deixando o sidecar Python estritamente opt-in e documentado como "avançado".
- **Telemetria vs. privacidade** — qualquer decisão de observabilidade precisa reforçar que é opt-in e anonimizada, para não contradizer o pilar "local-first e privado" do produto.

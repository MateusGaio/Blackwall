# Blackwall — UX/UI Specification

Este documento existe porque decisão de stack não garante experiência boa — a maioria dos harness que inspiraram o Blackwall erram justamente aqui (tela vazia sem orientação, erro técnico ilegível, ação destrutiva sem confirmação). Este arquivo é a referência de UX que qualquer agente/desenvolvedor deve seguir ao construir qualquer tela nova.

---

## 1. Identidade visual

**Referência:** Codex CLI / Claude Code — não ChatGPT. A referência ao ChatGPT (seção 3) é só para a mecânica do chat, não para a estética geral do app.

- **Paleta:** preto quase-puro para fundo (não usar `#000000` puro em áreas grandes de texto — cansa a vista; usar algo como `#0a0a0b`), escala de cinzas para hierarquia, branco só para texto de alto contraste e destaques pontuais. Sem cor de acento saturada — se precisar de um sinal de "atenção"/erro, usar variação de cinza mais claro + ícone, não vermelho vibrante.
- **Tipografia:** fonte monoespaçada para tudo que é técnico (código, IDs de modelo, contadores de token, nomes de arquivo) e uma sans-serif limpa para texto corrido (mensagens, descrições).
- **Divisórias:** bordas finas de 1px em cinza escuro para separar painéis, em vez de sombras/elevação — mantém a estética plana e "terminal", coerente com Codex/Claude Code.
- **Política de cantos arredondados:** usar raios discretos e consistentes, sem transformar a interface em uma coleção de pílulas. Controles compactos (botões, selects, ícones e itens de menu) usam `--radius-control` (8px); superfícies de conteúdo (cards, composer, sessões ativas, Vault e grafo) usam `--radius-surface` (10px); painéis e diálogos usam `--radius-panel` (12px). O raio de 999px fica reservado para chips removíveis, como anexos. Bordas continuam sendo o principal mecanismo de separação visual.
- **Decisão explícita:** esse tema é uma escolha **estética**, não uma meta formal de acessibilidade (não estamos comprometidos com WCAG AA). Ainda assim, nenhum texto deve ficar ilegível — bom senso de contraste continua valendo, só não é um item de certificação.

---

## 2. Navegação

**Decisão: os dois modelos, não um só.**
- **Sidebar persistente** à esquerda para navegação estrutural: Perfil atual no topo → lista de Workspaces do perfil → dentro do workspace, lista de sessões.
- **Command palette (Cmd/Ctrl+K)** para qualquer ação rápida: nova conversa, abrir sessão recente, criar workspace, central de provedores, configurações. A paleta fica montada persistentemente (controle `open`) para preservar animação de saída e retorno de foco; a busca recomeça vazia a cada abertura. Ações cujo destino ainda não existe (ex.: página Agentes) aparecem desabilitadas com motivo acessível — nunca abrem tela fictícia.

A sidebar cobre "onde eu estou", a command palette cobre "o que eu quero fazer agora" — são complementares, não redundantes.

### 2.1 Comando de barra da Fase 1

O composer reconhece somente `/nota`. O comando representa consentimento explícito para criar exatamente uma nota confinada ao Vault: não abre uma segunda aprovação em `ask`, funciona em `automatic` e é bloqueado antes de chamar o provedor em `read-only`. Nenhum outro comando de barra é anunciado ou executa ação local nesta fase.

**Estrutura de páginas de topo:**
- `Chat` (padrão, com painel de grafo do Vault podendo abrir ao lado — ver seção 5)
- `Vault` (visualizador de markdown + notas em lista, quando não se quer só o grafo)
- `Agentes` (página própria — ver seção 5)
- `Dashboard` (uso/custo — ver seção 6)
- `Configurações`

---

## 3. Interface de chat (padrão Codex híbrido — v2)

> **Contrato v2 (2026-08-23, Issue #181).** Referência: transcript do Codex App + rodapé/status do Codex CLI (TUI). Substitui integralmente a versão anterior desta seção (Fases U4/U5), que descrevia a estética terminal inicial. Implementação rastreada nas Issues #182–#186.

### 3.1 Transcript
- **Mensagens sem bolha** — usuário alinhado à direita com marcador mono `› você`; assistente à esquerda em **bloco único** por turno, sem marcador de papel. Largura máxima ~640px; nenhuma superfície de fundo ou borda de balão.
- **Passos agênticos colapsados** — o trabalho de ferramentas de um turno não polui o transcript: aparece como um grupo recolhido (`agiu · N ações`, com duração quando conhecida) entre a mensagem do usuário e a resposta final. Expandido, revela linhas mono com nome da ferramenta e trecho cru truncado. Colapsado por padrão; estado respeita `prefers-reduced-motion`.
- **Streaming token a token** com cursor de bloco piscando e linha de status em mono no cabeçalho do bloco ativo (`▸ pensando…` → `▸ gerando…`).
- **Resumo automático** aparece como card próprio (`conversation-summary-card`), nunca como mensagem comum.
- Ações pós-resposta: copiar mensagem, regenerar resposta, editar mensagem do usuário (com salvar/regenerar).

### 3.2 Bottom pane (composer)
- Composer único no formato de **linha de prompt**: borda 1px, raio `--radius-control`, prefixo mono `❯`, auto-resize.
- **Botão enviar↔parar na mesma posição** (`↑` ↔ `⏹` conforme estado) — nunca dois botões disputando lugares diferentes.
- **Chips inline**: escudo de permissões (`Perguntar sempre` / `Automático` / `Somente leitura` — ausente sem workspace), chip **somente modelo** (popover; o provedor é identificado apenas dentro do popover e na central de provedores — nunca no trigger), anexos como tokens `[arquivo.md]` removíveis. A lista de modelos é rolável (`max-height: min(18rem, 50vh)`), com navegação por setas/Home/End/Enter/Escape e o item selecionado já rolado para visível ao abrir; troca de modelo mostra busy e bloqueia cliques repetidos.
- **Fila visível** (ADR-21): pill `N na fila` com preview da próxima mensagem enfileirada.
- **Status line como rodapé** (herança U5): provedor › modelo · contexto `▓▓░ %` (botão que abre o dialog de uso) · janela mais restritiva do roteador · fila. Formato mono, discreta, sempre abaixo do composer.
- Erros de envio como linha mono discreta com ação de retry — nunca modal bloqueante.

### 3.3 Aprovação de ferramentas
- Card de aprovação **inline entre thread e composer**, destacado por borda 1px, com as três ações (`Permitir uma vez` / `Permitir nesta sessão` / `Negar`) e foco visível. Equivalente ao ApprovalOverlay do TUI do Codex.

### 3.4 Preservações obrigatórias (não negociável)
- Contrato do `SidecarChatStore`/adaptador intacto; fila FIFO; guards de sessão/epoch.
- Modos ask/automatic/read-only; anexos textuais/PDF; resumo automático; usage dialog; command palette.
- Hooks contratuais de teste/e2e: `li.message-user`, `data-testid="chat-composer"`, `model-trigger` (antigo `provider-chip`), `session-statusline`, `menuitemradio` de permissões.
- Labels i18n pt/en conforme tabela registrada no plano da fase C (`docs/plans/`).

---

## 4. Estados vazios (empty states)

Regra geral: nenhuma tela em branco sem explicação do próximo passo.

| Contexto | Texto |
|---|---|
| Sem mensagens na sessão | Saudação curta contextual ao horário local, seguida do compositor central no mesmo bloco; o texto secundário orienta o próximo passo. Depois da primeira mensagem, o compositor volta ao rodapé e o histórico ocupa a área central. |
| Vault sem notas | "Nenhuma nota por ora — crie uma nota ou peça para a IA salvar algo importante da conversa." |
| Workspace sem Soul configurada | Não deveria acontecer — Soul é **obrigatória** (ver seção 7), mas todo workspace nasce com a **Soul padrão** pré-configurada automaticamente, então esse estado vazio nunca é exposto ao usuário. |
| Página de Agentes sem swarm disparado ainda | "Nenhum agente em execução — dispare um swarm a partir do chat ou pelo botão abaixo." |

---

## 5. Dois grafos, duas páginas

Confirmando o que já foi definido: **Grafo do Vault** e **Grafo de Agentes** são duas implementações visuais distintas, reaproveitando o mesmo componente base de renderização de grafo (nós/arestas, zoom, pan), mas com propósito e local diferentes:

- **Grafo do Vault**: mostra conhecimento (notas e suas conexões). Vive na aba `Vault`, e pode abrir como painel lateral dentro do `Chat` (layout split, ver ADR-11).
- **Grafo de Agentes**: mostra execução (quais agentes foram disparados, ordem, resultado). Vive na página própria `Agentes`. Quando o usuário aciona um swarm (pelo chat ou diretamente nessa página), os nós aparecem em tempo real ali, refletindo o progresso de cada agente disparado.

---

## 6. Dashboard de uso e custo

**Limitação técnica real, documentada aqui para não gerar expectativa errada:** a maioria dos provedores gratuitos **não expõe uma API de "quanto ainda resta"** — eles só recusam a requisição quando o limite é atingido. Por isso, o dashboard mostra, "na medida do possível":
- **O que o Blackwall sabe com certeza:** quanto ele mesmo já enviou (tokens/requisições) por provedor, contado localmente.
- **O que é conhecido por documentação:** para provedores que publicam limites fixos (ex: X requisições/dia), o dashboard mostra uma estimativa de "restante" somente quando o usuário configura esse limite manualmente; a etiqueta deixa explícito que é uma estimativa.
- **O que é informado pelo provedor:** headers de rate-limit, `usage` OpenAI-compatible e contadores de avaliação Ollama são preservados separadamente. Ollama não recebe saldo ou renovação inventados.
- O indicador compacto mostra a menor porcentagem restante entre janelas conhecidas; sem denominador mostra consumo observado ou “Uso indisponível”.
- **Onde não há informação:** o dashboard mostra só o consumido, sem fingir saber o restante.

---

## 7. Soul — obrigatória, com padrão pronta

Todo perfil e todo workspace precisa ter uma Soul ativa — não é opcional deixar em branco. Para isso não travar o onboarding (seção 8), o Blackwall vem com uma **Soul padrão** pré-configurada, usada automaticamente até o usuário decidir customizar ou trocar.

---

## 8. Onboarding (primeira execução)

Fluxo passo a passo obrigatório antes da primeira tela "normal":
1. Idioma (detectado do SO, editável).
2. Perfil (a Soul padrão é elaborada para desenvolvimento local-first).
3. Soul do perfil.
4. Nome do workspace.
5. Pasta raiz opcional (seletor nativo no desktop ou explorador de diretório do navegador no web dev), com a alternativa explícita de iniciar sem workspace.
6. Soul do workspace.
7. Provedor OpenAI-compatible ou Ollama detectado/configurado.
8. Vault e entrada no chat com estado local persistente; os Markdown da pasta já aparecem no Vault e no grafo lateral.

O Vault lê os Markdown selecionados/escaneados na pasta. Markdown continua sendo a fonte de verdade; objetos Portent, relações quebradas/ambíguas e estado `captured` aparecem como diagnósticos/inbox, sem conectar silenciosamente o basename errado. A captura explícita oferece confirmação discreta com **Abrir** e **Desfazer**; captura automática informa que pode fazer uma segunda chamada paga e só existe quando habilitada no perfil. No modo sem workspace, o chat e as sessões continuam funcionando sem arquivos, Vault ou ferramentas de filesystem e nenhuma coluna direita vazia é reservada. O painel lateral do Vault 2D só é criado quando há workspace e o usuário o abre; o mesmo slot fica reservado para o futuro `graph3d`. O botão de Vault permanece visível para explicar o bloqueio: "Para usar o Vault e o grafo, selecione uma pasta para configurar seu workspace." O aviso oferece a ação "Adicionar workspace nas configurações". A área de configurações lista os workspaces do perfil e permite criar outro escolhendo uma pasta; depois da criação, o novo workspace e uma sessão ficam ativos. RAG semântico e edição avançada entram nas fases seguintes. O guia e ações rápidas continuam disponíveis pela command palette (`Ctrl/Cmd+K`).

---

## 9. Ações destrutivas

**Decisão:** confirmação por modal, sem desfazer temporário. Apagar workspace, nota do Vault ou sessão sempre pede confirmação explícita antes de executar — depois de confirmado, é definitivo.

---

## 10. Mensagens de erro do roteador

Quando todas as 8 tentativas do fallback (ADR-16) falham, a mensagem é **acionável**, nunca um stack trace:

> "Não foi possível obter resposta — todos os provedores configurados falharam ou atingiram o limite gratuito. Você pode: adicionar uma nova chave de API, revisar a ordem dos provedores, ou tentar novamente em alguns minutos."

---

## 11. Layout responsivo

- **Painéis colapsáveis** (sidebar, painel de grafo dentro do chat) — o usuário pode recolher qualquer painel lateral para focar só no conteúdo central.
- **Preview Markdown do Vault contido na largura do painel** (300–680px): prosa quebra dentro da coluna; blocos intrinsecamente largos (tabela, código) rolam apenas dentro do próprio bloco; imagens limitadas a 100%. Nenhum scroll horizontal no painel inteiro.
- **Vault com dois estados e um único controle, no TOPO GLOBAL** (decisão do owner, #218): o desenho é o do antigo botão interno — painel dividido com chevron apontando para recolher o painel direito quando expandido e espelhado quando recolhido. Nada dentro de `VaultPanel` o duplica. Estados: painel completo ou trilho (~42px), sem divisor/borda estrutural contínua, com atalhos **Arquivos** e **Grafo** (tooltip real em hover e focus). Clique num atalho reabre na aba correspondente; aba, nota e posição de leitura são preservados. Sem workspace, nenhum estado é criado — o botão explica o bloqueio.
- Redução de janela colapsa painéis automaticamente na ordem de menor prioridade primeiro (grafo lateral → sidebar), nunca corta conteúdo sem dar controle ao usuário sobre isso.

---

## 12. Navegação por teclado

Secundária: todo fluxo precisa funcionar de ponta a ponta com mouse sem nenhuma dependência de atalho, mas atalhos (command palette, navegação entre sessões, enviar mensagem) devem existir para quem preferir usar.

---

## 13. Streaming interrompido

Se a conexão cair no meio de uma resposta sendo exibida: o texto parcial permanece na tela, e aparece um aviso inline (não um modal bloqueante) tipo "Conexão perdida durante a resposta — [Tentar novamente]". Não tenta retomar sozinho, não descarta o que já foi exibido.

---

## 14. Exportação MCP local

Na seção lazy `MCP` das configurações, “Conectar servidores ao Blackwall” e “Expor este
workspace via MCP” são cards distintos. A exportação mostra que o endpoint é apenas local,
avisa que qualquer processo com o token pode consultar excertos indexados e oferece somente
`search_workspace`, desligada por padrão. O token é mostrado uma única vez após gerar ou
rotacionar, pode ser copiado nessa resposta imediata e é limpo ao fechar/desmontar — nunca vai
para localStorage. Rotação e exclusão pedem confirmação; carregamento usa skeleton, ações
assíncronas mostram progresso e mudanças de estado usam transições funcionais de 120–180 ms
(instantâneas para teclado e reduced motion).

## 15. Vault avançado (F2.8)

Na aba `Arquivos`, a barra compacta oferece `Todos`, `Inbox`, `Organizadas`,
`Arquivadas` e `Problemas`, sem criar uma terceira navegação global. A Inbox é
uma view virtual de notas `captured`; arquivar, restaurar e excluir só aparecem
para notas gerenciadas. Markdown externo permanece visível no explorador, com
badge de somente leitura e sem ação de edição.

O editor lazy carrega o detalhe por ID, mantém preview Markdown sanitizado,
mostra progresso e preserva rascunho em erro. Um rascunho sujo exige escolha
antes de fechar; conflito 409 oferece recarregar a versão do disco ou copiar o
rascunho, sem force-save ou merge automático. Exclusão é definitiva e exige
confirmação explícita. Entradas e saídas usam motion funcional de 120–180 ms,
com estado instantâneo para teclado e `prefers-reduced-motion`.

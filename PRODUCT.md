# Blackwall — Product

## Propósito

Blackwall é um harness de IA desktop, local-first e gratuito para pessoas que trabalham com código. O projeto é licenciado em MIT e foi desenhado para uma publicação pública futura; durante o desenvolvimento atual, o repositório permanece privado. Ele reúne conversa, contexto de projeto, notas e automação num ambiente que continua sob controle do usuário.

## Para quem

- Desenvolvedores que alternam entre múltiplos provedores e modelos.
- Pessoas que precisam guardar contexto técnico em arquivos locais, não numa plataforma fechada.
- Equipes e indivíduos que querem usar MCP e agentes sem centralizar seus prompts, chaves e notas.

## Princípios de produto

1. **Local-first e privado.** Dados, Vault e chaves pertencem ao usuário; telemetria é opt-in e nunca carrega conteúdo de conversas.
2. **Continuidade de contexto.** Perfis, workspaces, Souls, histórico local e um Vault Markdown combinam memória durável com conversas de trabalho sem confundir conversa bruta, memória comportamental e conhecimento de projeto.
3. **Falha com transparência.** O roteador tenta provedores configurados em ordem e explica claramente a tentativa e o erro final.
4. **Sem lock-in de notas.** O Vault usa arquivos `.md` e `[[wikilinks]]` compatíveis com Obsidian.
5. **Foco no trabalho.** A interface prioriza legibilidade, velocidade e controle, com tema OLED monocromático.

## Estado de distribuição e privacidade

- A meta de distribuição é a `v0.1.0` marcada como pre-release beta, com release manual no GitHub; o repositório permanece privado até os gates e a autorização final do owner.
- Nenhuma publicação pública, Release, mudança de visibilidade ou inclusão de dados reais deve ocorrer sem autorização do owner e sem a revisão de segurança/governança prevista em `AGENTS.md`.
- Chaves ficam exclusivamente em `secrets.enc`/`secrets.key`; prompts, respostas, arquivos e resultados de ferramentas não entram em telemetria nem em material de contribuição.
- O painel de uso registra somente o que o provedor informa e o que o Blackwall observa localmente. Ele não representa automaticamente o saldo atual de uma chave; rate limits e quotas devem ser tratados como respostas do provedor.
- A beta gera AppImage/`.deb` no Linux e NSIS no Windows, com checksums SHA-256. Não há updater automático nem code signing nesta fase.

## MVP (Fase 1)

O MVP entrega perfis e workspaces vinculados a uma pasta real, além de um modo de conversa sem workspace para começar rapidamente. Inclui Souls combináveis, onboarding persistente, sidebar de sessões, chat com streaming WebSocket e histórico local em SQLite/WAL. O usuário pode configurar múltiplos endpoints OpenAI-compatible e Ollama, trocar modelos no chat, usar fallback para falhas transitórias, indexar anexos textuais/PDF com SQLite FTS5, visualizar Markdown da pasta no Vault e no grafo e escolher os modos de permissão `ask`, `automatic` e `read-only`.

As chaves ficam exclusivamente em `secrets.enc`; prompts, respostas e telemetria não saem do dispositivo por padrão. A versão web de desenvolvimento usa o mesmo sidecar local; a versão desktop sobe o sidecar junto do Tauri.

Observabilidade é opt-in: Sentry, Datadog e New Relic podem receber somente metadados técnicos por um endpoint configurado pelo usuário. Sem configuração explícita, nenhum exporter é iniciado.

O Vault já possui uma fundação Portent read-only: Markdown é a fonte de verdade, SQLite mantém uma projeção reconstruível, links ambíguos viram diagnóstico e tipos externos são preservados. `/nota` é o único comando de barra da Fase 1 e autoriza exatamente uma captura local idempotente, com confirmação, abertura e desfazer. Captura automática permanece fora da Fase 1. RAG semântico/LanceDB e MCP vêm na segunda fase; edição avançada do Vault, orquestração de agentes e LoRA/QLoRA são capacidades posteriores.

## Memória contínua (F2.9)

O aprendizado automático é desligado por padrão e só pode ser ativado após um disclosure explícito. Cada turno elegível pode fazer uma segunda chamada ao mesmo provedor e modelo; antes disso, somente a mensagem atual do usuário é redigida localmente. A resposta do assistente, ferramentas, arquivos, Souls, Vault e histórico não entram nessa extração.

Preferências duráveis pertencem ao perfil e podem ser revisadas, corrigidas, fixadas, arquivadas ou excluídas. Conhecimento técnico pertence ao workspace e, quando capturado automaticamente, nasce na Inbox como Markdown `captured`; a memória de perfil nunca cria arquivos ou vetores. O uso da chamada adicional aparece separado como `memory_extract`, sem conteúdo.

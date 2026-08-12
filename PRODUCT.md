# Blackwall — Product

## Propósito

Blackwall é um harness de IA desktop, local-first, open source e gratuito para pessoas que trabalham com código. Ele reúne conversa, contexto de projeto, notas e automação num ambiente que continua sob controle do usuário.

## Para quem

- Desenvolvedores que alternam entre múltiplos provedores e modelos.
- Pessoas que precisam guardar contexto técnico em arquivos locais, não numa plataforma fechada.
- Equipes e indivíduos que querem usar MCP e agentes sem centralizar seus prompts, chaves e notas.

## Princípios de produto

1. **Local-first e privado.** Dados, Vault e chaves pertencem ao usuário; telemetria é opt-in e nunca carrega conteúdo de conversas.
2. **Continuidade de contexto.** Perfis, workspaces, Souls e um Vault Markdown combinam memória durável com conversas de trabalho.
3. **Falha com transparência.** O roteador tenta provedores configurados em ordem e explica claramente a tentativa e o erro final.
4. **Sem lock-in de notas.** O Vault usa arquivos `.md` e `[[wikilinks]]` compatíveis com Obsidian.
5. **Foco no trabalho.** A interface prioriza legibilidade, velocidade e controle, com tema OLED monocromático.

## MVP (Fase 1)

O MVP entrega perfis e workspaces vinculados a uma pasta real, além de um modo de conversa sem workspace para começar rapidamente. Inclui Souls combináveis, onboarding persistente, sidebar de sessões, chat com streaming WebSocket e histórico local em SQLite/WAL. O usuário pode configurar múltiplos endpoints OpenAI-compatible e Ollama, trocar modelos no chat, usar fallback para falhas transitórias, indexar anexos textuais/PDF com SQLite FTS5, visualizar Markdown da pasta no Vault e no grafo e escolher os modos de permissão `ask`, `automatic` e `read-only`.

As chaves ficam exclusivamente em `secrets.enc`; prompts, respostas e telemetria não saem do dispositivo por padrão. A versão web de desenvolvimento usa o mesmo sidecar local; a versão desktop sobe o sidecar junto do Tauri.

Observabilidade é opt-in: Sentry, Datadog e New Relic podem receber somente metadados técnicos por um endpoint configurado pelo usuário. Sem configuração explícita, nenhum exporter é iniciado.

RAG semântico/LanceDB e MCP vêm na segunda fase; edição avançada do Vault, orquestração de agentes e LoRA/QLoRA são capacidades posteriores.

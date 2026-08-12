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

## MVP

O primeiro lançamento entrega perfis e workspaces, uma Soul padrão combinável, chat com streaming, persistência de sessão local, provedor compatível com OpenAI e fallback sequencial configurável.

Vault/RAG/MCP vêm na segunda fase; orquestração de agentes e LoRA/QLoRA são capacidades avançadas da terceira fase.

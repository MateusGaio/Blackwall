# Blackwall

Harness de IA local-first e open source para código.

O Blackwall combina perfis, workspaces, Souls e um chat persistente com provedores OpenAI-compatible ou Ollama — sempre com dados sob controle local do usuário. Também é possível iniciar uma conversa sem workspace e adicionar uma pasta depois. A Fase 1 inclui sessões persistentes, anexos pesquisáveis por FTS5, fallback de rede e permissões por workspace.

## Desenvolvimento

```bash
npm install
npm run dev:desktop
```

Para testar no navegador durante o desenvolvimento (o sidecar local é iniciado automaticamente):

```bash
npm run dev
```

Os dados ficam em `~/.blackwall` por padrão. Para testes isolados, defina `BLACKWALL_DATA_DIR` para uma pasta temporária.

Para validar a base:

```bash
npm run check
```

## Arquitetura

- Tauri v2 (Rust) como shell desktop.
- React + Vite + Tailwind para a interface.
- Sidecar Node/TypeScript para lógica de IA e comunicação local.
- SQLite em WAL para perfis, workspaces, sessões, mensagens, provedores, modelos, anexos e aprovações.
- `secrets.enc` + `secrets.key` para chaves de provedor; nunca são gravadas no SQLite ou nos logs.
- FTS5 para indexação textual local de Markdown, código, dados e PDFs pesquisáveis.
- Vault Markdown local com leitura de notas e grafo de `[[wikilinks]]`; RAG semântico/LanceDB, MCP, agentes e LoRA permanecem no roadmap das fases seguintes.

Consulte `PRODUCT.md` e os documentos de arquitetura e UX no harness antes de contribuir.

## Licença

[MIT](LICENSE).

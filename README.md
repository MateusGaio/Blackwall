# Blackwall

Harness de IA local-first e open source para código.

O Blackwall combina perfis, workspaces, Souls, um Vault Markdown compatível com Obsidian, roteamento com fallback de modelos, MCP e agentes — sempre com dados sob controle local do usuário.

## Desenvolvimento

```bash
npm install
npm run dev:desktop
```

Para validar a base:

```bash
npm run check
```

## Arquitetura

- Tauri v2 (Rust) como shell desktop.
- React + Vite + Tailwind para a interface.
- Sidecar Node/TypeScript para lógica de IA e comunicação local.
- SQLite, Markdown e LanceDB como armazenamento local nas próximas etapas.

Consulte `PRODUCT.md` e os documentos de arquitetura e UX no harness antes de contribuir.

## Licença

[MIT](LICENSE).

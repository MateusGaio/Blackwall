# Blackwall

Harness de IA local-first e open source para código.

O Blackwall combina perfis, workspaces, Souls e um chat persistente com provedores OpenAI-compatible ou Ollama — sempre com dados sob controle local do usuário. Também é possível iniciar uma conversa sem workspace e adicionar uma pasta depois. A Fase 1 inclui sessões persistentes, anexos pesquisáveis por FTS5, fallback de rede e permissões por workspace.

## Desenvolvimento

```bash
npm install
npm run dev:desktop
```

O launcher do desktop verifica se o servidor web e o sidecar já estão ativos
(por exemplo, quando `npm run dev` está aberto no navegador) e reutiliza essa
instância. Assim não são iniciados dois sidecars na porta `1422`, o que evita o
encerramento do `beforeDevCommand` com código `143`.

Para testar no navegador durante o desenvolvimento (o sidecar local é iniciado automaticamente):

```bash
npm run dev
```

Os dados ficam em `~/.blackwall` por padrão. Para testes isolados, defina `BLACKWALL_DATA_DIR` para uma pasta temporária.

Para validar a base:

```bash
npm run check
```

O ciclo de ferramentas usa um orçamento padrão de 128 chamadas por turno, com
um teto de segurança de 512. Para ajustar esse orçamento em uma execução local:

```bash
BLACKWALL_TOOL_CALL_BUDGET=200 npm run dev
```

Chamadas idênticas que já foram concluídas são reutilizadas sem consumir
novamente o orçamento; ciclos sem progresso, falhas repetidas, tempo limite ou
excesso de bytes encerram o turno.

## Aplicativo desktop

O build de produção do Tauri inclui um runtime Node privado junto do sidecar. A
versão instalada não depende de Node estar disponível no `PATH` do usuário.

Em Linux, o pacote inicial pode ser gerado com:

```bash
npm run build:desktop
```

Esse comando produz os formatos AppImage e `.deb` em `src-tauri/target/release/bundle`.
O arquivo `desktop-runtime/` é temporário e fica fora do Git. Por padrão, o
runtime é copiado do Node usado para executar o build. Para empacotar um runtime
preparado para o alvo, informe `BLACKWALL_NODE_RUNTIME=/caminho/para/node` antes
de executar o comando.

Antes de publicar um artefato, valide que o sidecar empacotado inicia sem Node no
`PATH`:

```bash
npm run prepare:desktop-runtime
npm run smoke:desktop-runtime
```

O smoke check usa uma pasta temporária para o banco e encerra o sidecar ao final;
nenhum dado do usuário é alterado.

## Arquitetura

- Tauri v2 (Rust) como shell desktop.
- React + Vite + Tailwind para a interface.
- Sidecar Node/TypeScript para lógica de IA e comunicação local.
- SQLite em WAL para perfis, workspaces, sessões, mensagens, provedores, modelos, anexos e aprovações.
- O indicador de uso e o dashboard são locais: requisições são contadas por tentativa, tokens dependem do relatório do provedor, eventos detalhados expiram em 90 dias e agregados diários permanecem. Limites manuais aparecem como estimativas.
- `secrets.enc` + `secrets.key` para chaves de provedor; nunca são gravadas no SQLite ou nos logs.
- FTS5 para indexação textual local de Markdown, código, dados e PDFs pesquisáveis.
- Vault Markdown local com leitura de notas e grafo de `[[wikilinks]]`; RAG semântico/LanceDB, MCP, agentes e LoRA permanecem no roadmap das fases seguintes.

Consulte `PRODUCT.md` e os documentos de arquitetura e UX no harness antes de contribuir.

## Licença

[MIT](LICENSE).

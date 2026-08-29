# Changelog

Todas as mudanças relevantes do Blackwall são registradas aqui.

## [0.1.0-beta] — 2026-08-29

Primeira beta de preparação para distribuição manual, ainda sujeita aos gates
de CI e à revisão do owner.

### Incluído

- chat local com streaming WebSocket, fila FIFO, fallback sequencial e
  compactação de contexto;
- perfis, Souls, workspaces e permissões `ask`, `automatic` e `read-only`;
- Vault Markdown local com leitura, grafo Portent e links diagnósticos;
- comando explícito `/nota`, com contrato estrito `create_vault_note`, captura
  idempotente, frontmatter Portent, relações validadas e desfazer por revisão;
- autenticação Bearer do runtime local, subprotocolo autenticado de WebSocket,
  allowlist de Origin, limites de corpo/frame e health check mínimo;
- bundles Linux AppImage/`.deb` e Windows NSIS, com checksums SHA-256;
- telemetria desligada por padrão e documentação de segurança, suporte,
  terceiros e divulgação responsável.

### Limites conhecidos da beta

- atualização automática e code signing ficam fora desta versão;
- o instalador Windows não é assinado e pode exibir o SmartScreen;
- releases são manuais pelo GitHub e começam como draft;
- confinamento completo de subprocessos/filesystem continua fora da Fase 1.

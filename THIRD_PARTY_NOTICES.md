# Avisos de terceiros

O Blackwall usa dependências de terceiros identificadas pelos manifestos e
lockfiles versionados:

- dependências JavaScript/TypeScript: [`package.json`](package.json) e
  [`package-lock.json`](package-lock.json);
- dependências Rust/Tauri: [`src-tauri/Cargo.toml`](src-tauri/Cargo.toml) e
  [`src-tauri/Cargo.lock`](src-tauri/Cargo.lock);
- runtime empacotado: Node.js, cuja licença acompanha a distribuição oficial
  usada no build.

As licenças e avisos de cada pacote devem ser preservados pelos gerenciadores
de pacotes e pelos respectivos arquivos de distribuição. O Blackwall é código
original sob MIT; nenhuma dependência é autorizada a alterar a licença do
projeto. Antes de uma distribuição final, o inventário deve ser regenerado a
partir dos lockfiles e anexado ao release junto dos instaladores.

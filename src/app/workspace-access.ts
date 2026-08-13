// MIT License — Copyright (c) 2026 Mateus Gaio

export function modelRequestsWorkspaceAccess(content: string) {
  const lower = content.toLocaleLowerCase();
  const asksForAccess =
    /(don't have|do not have|cannot|can't|no direct|unable to|sem acesso|não tenho acesso|não consigo acessar|não consigo aceder)/i.test(
      lower,
    );
  const mentionsFiles =
    /(filesystem|file system|file access|directory|folder|files|arquivos|diretório|pasta|ficheiros)/i.test(
      lower,
    );
  return asksForAccess && mentionsFiles;
}

export function formatWorkspaceToolResult(result: unknown, isEnglish: boolean) {
  const heading = isEnglish
    ? "Workspace access granted. Local context:"
    : "Acesso ao workspace permitido. Contexto local:";
  return `${heading}\n\n${JSON.stringify(result, null, 2)}`;
}

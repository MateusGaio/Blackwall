// MIT License — Copyright (c) 2026 Mateus Gaio

export const EMBEDDING_CHUNK_SIZE = 1_800;

export function chunkText(content: string) {
  const values: string[] = [];
  for (let index = 0; index < content.length; index += EMBEDDING_CHUNK_SIZE) {
    values.push(content.slice(index, index + EMBEDDING_CHUNK_SIZE));
  }
  return values;
}

export function chunkVaultObject(title: string, body: string) {
  const prefix = `${title.trim() || "Sem título"}\n\n`;
  const content = body ?? "";
  const bodySize = Math.max(1, EMBEDDING_CHUNK_SIZE - prefix.length);
  if (!content.length) return [prefix.trimEnd()];
  const chunks: string[] = [];
  for (let offset = 0; offset < content.length; offset += bodySize) {
    chunks.push(`${prefix}${content.slice(offset, offset + bodySize)}`);
  }
  return chunks;
}

// MIT License — Copyright (c) 2026 Mateus Gaio
import type { VaultFile } from "../../shared/api/sidecar";

function cleanHref(href: string) {
  return href.split(/[?#]/, 1)[0]?.trim() ?? "";
}

function normalizePath(value: string) {
  const parts: string[] = [];
  for (const part of value.replaceAll("\\", "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** Resolves only a relative link to a file already present in the scanned Vault. */
export function resolveVaultLink(
  currentPath: string | undefined,
  href: string,
  files: VaultFile[],
) {
  const raw = cleanHref(href);
  if (!raw || raw.startsWith("/") || raw.startsWith("\\") || /^[a-z][a-z\d+.-]*:/i.test(raw)) {
    return null;
  }
  const rootRelative = normalizePath(raw);
  const direct = rootRelative ? files.find((file) => file.path === rootRelative) : undefined;
  if (direct) return direct.path;
  const rootStem = rootRelative?.replace(/\.(?:md|markdown)$/i, "");
  const directStem = files.filter(
    (file) => file.path.replace(/\.(?:md|markdown)$/i, "") === rootStem,
  );
  if (directStem.length === 1) return directStem[0].path;
  const currentDirectory = currentPath?.split("/").slice(0, -1).join("/") ?? "";
  const normalized = normalizePath(currentDirectory ? `${currentDirectory}/${raw}` : raw);
  if (!normalized) return null;
  const exact = files.find((file) => file.path === normalized);
  if (exact) return exact.path;
  const withoutExtension = normalized.replace(/\.(?:md|markdown)$/i, "");
  const stem = files.filter(
    (file) => file.path.replace(/\.(?:md|markdown)$/i, "") === withoutExtension,
  );
  if (stem.length === 1) return stem[0].path;
  const basename = withoutExtension.split("/").at(-1);
  const byName = files.filter(
    (file) =>
      file.path
        .replace(/\.(?:md|markdown)$/i, "")
        .split("/")
        .at(-1) === basename,
  );
  return byName.length === 1 ? byName[0].path : null;
}

/** Converts Obsidian-style links to safe pseudo-links handled by SafeMarkdown. */
export function wikilinksToMarkdown(content: string) {
  return content.replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const text = String(label ?? target).trim();
    return `[${text}](${String(target).trim()})`;
  });
}

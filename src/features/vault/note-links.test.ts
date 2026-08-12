// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import type { VaultFile } from "../../shared/api/sidecar";
import { resolveVaultLink, wikilinksToMarkdown } from "./note-links";

const files = [
  { path: "docs/index.md" },
  { path: "docs/setup.md" },
  { path: "notes/setup.md" },
] as VaultFile[];

describe("Vault note links", () => {
  it("resolves relative links and omitted Markdown extensions", () => {
    expect(resolveVaultLink("docs/index.md", "setup", files)).toBe("docs/setup.md");
    expect(resolveVaultLink("docs/index.md", "./setup.md#install", files)).toBe("docs/setup.md");
  });

  it("resolves a unique basename and blocks unsafe or unknown links", () => {
    expect(resolveVaultLink("docs/index.md", "../notes/setup", files)).toBe("notes/setup.md");
    expect(resolveVaultLink("docs/index.md", "/etc/passwd", files)).toBeNull();
    expect(resolveVaultLink("docs/index.md", "../../setup", files)).toBeNull();
    expect(resolveVaultLink("docs/index.md", "https://example.com", files)).toBeNull();
    expect(resolveVaultLink("docs/index.md", "missing", files)).toBeNull();
  });

  it("converts wikilinks while preserving aliases", () => {
    expect(wikilinksToMarkdown("Leia [[docs/setup|o guia]] e [[notes/setup]].")).toBe(
      "Leia [o guia](docs/setup) e [notes/setup](notes/setup).",
    );
  });
});

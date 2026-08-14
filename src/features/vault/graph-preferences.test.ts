// MIT License — Copyright (c) 2026 Mateus Gaio
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultGraphPreferences,
  graphGroupForFile,
  readGraphPreferences,
  writeGraphPreferences,
} from "./graph-preferences";

describe("graph preferences", () => {
  let values = new Map<string, string>();

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("persists physics settings per workspace", () => {
    const preferences = { ...defaultGraphPreferences, linkDistance: 96 };
    writeGraphPreferences("workspace-a", preferences);

    expect(readGraphPreferences("workspace-a")).toEqual(preferences);
    expect(readGraphPreferences("workspace-b")).toEqual(defaultGraphPreferences);
  });

  it("groups notes by folder or tag", () => {
    const file = { content: "---\ntags: [backend, api]\n---\n# Note", path: "docs/note.md" };

    expect(graphGroupForFile(file, "folder")).toBe("docs");
    expect(graphGroupForFile(file, "tag")).toBe("backend");
  });
});

// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import {
  isUnknownSlashCommand,
  parseSlashCommand,
  slashCommandSuggestions,
} from "./slash-commands";

describe("slash commands", () => {
  it("parses English commands and arguments", () => {
    expect(parseSlashCommand(" /model qwen2.5 ")).toEqual({
      args: "qwen2.5",
      command: "model",
      raw: "/model qwen2.5",
    });
    expect(parseSlashCommand("/plan off")).toMatchObject({ command: "plan", args: "off" });
  });

  it("keeps the Portuguese note name as an undocumented legacy alias", () => {
    expect(parseSlashCommand("/nota save this")).toMatchObject({
      args: "save this",
      command: "note",
    });
  });

  it("does not parse inline slashes or escaped literal messages", () => {
    expect(parseSlashCommand("text /note this")).toBeNull();
    expect(parseSlashCommand("//not a command")).toBeNull();
    expect(isUnknownSlashCommand("text /unknown")).toBe(false);
  });

  it("suggests only public English command names", () => {
    expect(slashCommandSuggestions("/mo").map((command) => command.name)).toEqual([
      "model",
      "mode",
    ]);
    expect(slashCommandSuggestions("/not").map((command) => command.name)).toEqual(["note"]);
    expect(slashCommandSuggestions("/nota")).toEqual([]);
    expect(isUnknownSlashCommand("/unknown")).toBe(true);
  });
});

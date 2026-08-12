// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { activeSoulMeta } from "./soul";

describe("activeSoulMeta", () => {
  it("prefers the workspace Soul", () => {
    expect(activeSoulMeta({ soul: "perfil" }, { soul: "workspace" })).toEqual({
      label: "Soul do workspace",
      soul: "workspace",
    });
  });

  it("uses the profile Soul without a workspace", () => {
    expect(activeSoulMeta({ soul: "perfil" }, null)).toEqual({
      label: "Soul do perfil",
      soul: "perfil",
    });
  });
});

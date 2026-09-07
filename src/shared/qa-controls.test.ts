// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { qaLatencyMs } from "./qa-controls";

describe("controles temporários do QA", () => {
  it("não injeta latência fora de uma página browser com modo lento", () => {
    expect(qaLatencyMs("loading")).toBe(0);
    expect(qaLatencyMs("indexing")).toBe(0);
  });
});

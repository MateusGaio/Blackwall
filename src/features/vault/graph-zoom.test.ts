// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import { clampGraphZoom, maximumGraphZoom, minimumGraphZoom } from "./graph-zoom";

describe("graph zoom", () => {
  it("allows the graph to zoom farther out", () => {
    expect(clampGraphZoom(0.01)).toBe(minimumGraphZoom);
    expect(clampGraphZoom(0.2)).toBe(0.2);
    expect(clampGraphZoom(10)).toBe(maximumGraphZoom);
  });
});

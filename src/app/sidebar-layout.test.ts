// MIT License — Copyright (c) 2026 Mateus Gaio

import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  defaultSidebarWidth,
  maximumSidebarWidth,
  minimumSidebarWidth,
} from "./sidebar-layout";

describe("sidebar layout", () => {
  it("clamps persisted and drag values to the supported range", () => {
    expect(clampSidebarWidth(120)).toBe(minimumSidebarWidth);
    expect(clampSidebarWidth(999)).toBe(maximumSidebarWidth);
    expect(clampSidebarWidth(defaultSidebarWidth)).toBe(defaultSidebarWidth);
  });

  it("uses the default for invalid values", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(defaultSidebarWidth);
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY, 312)).toBe(312);
  });
});

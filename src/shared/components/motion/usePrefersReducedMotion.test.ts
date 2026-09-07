// MIT License — Copyright (c) 2026 Mateus Gaio

import { afterEach, describe, expect, it, vi } from "vitest";
import { reducedMotionMatches } from "./usePrefersReducedMotion";

afterEach(() => vi.unstubAllGlobals());

describe("preferência de reduced motion", () => {
  it("segue matchMedia quando o usuário pede movimento reduzido", () => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: true })) });
    vi.stubGlobal("document", { documentElement: { dataset: {} } });

    expect(reducedMotionMatches()).toBe(true);
  });

  it("considera o modo reduzido temporário do QA", () => {
    vi.stubGlobal("window", { matchMedia: vi.fn(() => ({ matches: false })) });
    vi.stubGlobal("document", { documentElement: { dataset: { qaMotion: "reduced" } } });

    expect(reducedMotionMatches()).toBe(true);
  });
});

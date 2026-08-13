// MIT License — Copyright (c) 2026 Mateus Gaio
import { describe, expect, it } from "vitest";
import { isStreamEventForRequest } from "./sidecar";

describe("eventos do stream", () => {
  it("aceita autorizações filhas da requisição original", () => {
    expect(isStreamEventForRequest("request-1:tool-1", "request-1")).toBe(true);
    expect(isStreamEventForRequest("request-2", "request-1")).toBe(false);
    expect(isStreamEventForRequest(undefined, "request-1")).toBe(true);
  });
});

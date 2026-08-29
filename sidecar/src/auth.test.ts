// MIT License — Copyright (c) 2026 Mateus Gaio

import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import {
  generateSidecarToken,
  hasBearerToken,
  hasWebSocketToken,
  SIDECAR_WS_PROTOCOL,
} from "./auth.js";

function request(headers: IncomingMessage["headers"]) {
  return { headers } as IncomingMessage;
}

describe("autenticação do sidecar", () => {
  it("gera tokens de alta entropia e compara Bearer sem aceitar formatos alternativos", () => {
    const token = generateSidecarToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hasBearerToken(request({ authorization: `Bearer ${token}` }), token)).toBe(true);
    expect(hasBearerToken(request({ authorization: token }), token)).toBe(false);
    expect(hasBearerToken(request({ authorization: "Bearer errado" }), token)).toBe(false);
  });

  it("exige protocolo do app e token no subprotocolo do WebSocket", () => {
    const token = "a".repeat(64);
    expect(
      hasWebSocketToken(
        request({ "sec-websocket-protocol": `${SIDECAR_WS_PROTOCOL}, ${token}` }),
        token,
      ),
    ).toBe(true);
    expect(
      hasWebSocketToken(request({ "sec-websocket-protocol": SIDECAR_WS_PROTOCOL }), token),
    ).toBe(false);
  });
});

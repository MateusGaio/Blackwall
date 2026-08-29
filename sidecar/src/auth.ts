// MIT License — Copyright (c) 2026 Mateus Gaio

import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SIDECAR_WS_PROTOCOL = "blackwall.v1";
export const MAX_HTTP_BODY_BYTES = 1_000_000;
export const MAX_WS_PAYLOAD_BYTES = 256_000;

export function generateSidecarToken() {
  return randomBytes(32).toString("hex");
}

function tokenEquals(received: string | undefined, expected: string) {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
}

export function hasBearerToken(request: IncomingMessage, expected: string | null) {
  if (!expected) return true;
  const header = request.headers.authorization;
  if (typeof header !== "string") return false;
  const match = header.match(/^Bearer\s+([^\s]+)$/i);
  return tokenEquals(match?.[1], expected);
}

export function offeredWebSocketProtocols(request: IncomingMessage) {
  const header = request.headers["sec-websocket-protocol"];
  if (typeof header !== "string") return [];
  return header
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
}

export function hasWebSocketToken(request: IncomingMessage, expected: string | null) {
  if (!expected) return true;
  const protocols = offeredWebSocketProtocols(request);
  return (
    protocols.includes(SIDECAR_WS_PROTOCOL) &&
    protocols.some((protocol) => tokenEquals(protocol, expected))
  );
}

export function websocketProtocolSelector(protocols: Set<string>) {
  return protocols.has(SIDECAR_WS_PROTOCOL) ? SIDECAR_WS_PROTOCOL : "";
}

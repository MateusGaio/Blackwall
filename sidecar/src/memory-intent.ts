// MIT License — Copyright (c) 2026 Mateus Gaio

type ExplicitCaptureIntent = {
  content?: string;
  kind: "command" | "none" | "ambiguous";
  reason: "explicit_request" | "missing_referent" | "not_detected";
};

// Captura é deliberadamente opt-in: somente o comando exato /nota inicia o
// protocolo. Texto natural, perguntas e negações nunca criam memória.
const commandPattern = /^\/nota(?:\s+([\s\S]*?))?$/;

function clean(value: string) {
  return value
    .trim()
    .replace(/^[:\-–—]\s*/, "")
    .trim();
}

export function detectExplicitCaptureIntent(
  text: string,
  activeTurnContent = "",
): ExplicitCaptureIntent {
  const normalized = text.replace(/\s+$/, "");
  if (!normalized || /^```[\s\S]*```$/.test(normalized) || /^>/.test(normalized)) {
    return { kind: "none", reason: "not_detected" };
  }
  const command = normalized.match(commandPattern);
  if (command) {
    const content = clean(command[1] ?? "");
    return content
      ? { content, kind: "command", reason: "explicit_request" }
      : { kind: "ambiguous", reason: "missing_referent" };
  }
  // Mantém a assinatura compatível com os consumidores antigos sem usar
  // contexto implícito: /nota sem payload é resolvido pelo turno de chat.
  void activeTurnContent;
  return { kind: "none", reason: "not_detected" };
}

export function redactMemoryInput(value: string) {
  return value
    .replace(
      /(?:sk|pk|api|token|secret|password|senha)[_ -]?[a-z0-9]*\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED]",
    )
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g, "[REDACTED]")
    .replace(/(^|\s)(?:[A-Z_][A-Z0-9_]{2,})=([^\s]+)/g, "$1[REDACTED_ENV]")
    .slice(0, 4000);
}

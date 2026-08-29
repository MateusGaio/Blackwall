// MIT License — Copyright (c) 2026 Mateus Gaio

type ExplicitCaptureIntent = {
  content?: string;
  kind: "command" | "request" | "none" | "ambiguous";
  reason: "explicit_request" | "negated" | "meta_question" | "missing_referent" | "not_detected";
};

const commandPattern = /^\/nota(?:\s+(.+))?$/i;
const requestPattern =
  /^(?:por favor,?\s+)?(?:salve|guarde|lembre(?:-se)?|anote|não esqueça|save|remember|store|note)\b([\s\S]*)$/i;
const metaQuestionPattern = /^(?:como|how)\b[\s\S]*(?:salv|guard|anot|remember|store|not[ea])/i;
const negationPattern =
  /^(?:não|nao|don['’]t|do not)\s+(?:salve|guarde|lembre|anote|esqueça|save|remember|store|note)\b/i;

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
  const normalized = text.trim();
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
  if (negationPattern.test(normalized)) return { kind: "none", reason: "negated" };
  if (metaQuestionPattern.test(normalized) || normalized.endsWith("?")) {
    return { kind: "none", reason: "meta_question" };
  }
  const request = normalized.match(requestPattern);
  if (!request) return { kind: "none", reason: "not_detected" };
  const content = clean(request[1] ?? "");
  if (content && !/^(?:isso|isto|that|this)$/i.test(content)) {
    return { content, kind: "request", reason: "explicit_request" };
  }
  const active = clean(activeTurnContent);
  return active
    ? { content: active, kind: "request", reason: "explicit_request" }
    : { kind: "ambiguous", reason: "missing_referent" };
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

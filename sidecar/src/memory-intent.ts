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
  let secretMatches = 0;
  let sanitized = Array.from(validUnicode(value).normalize("NFKC"), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127
      ? " "
      : character;
  }).join("");
  const redact = (match: string) => {
    secretMatches += Math.max(1, match.length);
    return "[REDACTED]";
  };
  sanitized = sanitized
    .replace(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/gi, redact)
    .replace(/authorization\s*:\s*bearer\s+[^\s,;]+/gi, redact)
    .replace(/\b(?:https?|ssh):\/\/[^\s/@:]+:[^\s/@]+@/gi, redact)
    .replace(/(?:cookie|set-cookie)\s*:\s*[^\r\n]+/gi, redact)
    .replace(
      /(?:sk|pk|api|token|secret|password|passwd|senha|credential|cookie)[_ -]?[a-z0-9]*\s*[:=]\s*[^\s,;]+/gi,
      redact,
    )
    .replace(/(^|\s)(?:[A-Z_][A-Z0-9_]{2,})=([^\s]+)/g, (_match, prefix: string) => {
      secretMatches += 1;
      return `${prefix}[REDACTED_ENV]`;
    })
    .replace(/\b(?:gh[opurs]|github_pat)_[A-Za-z0-9_]{20,}\b/g, redact)
    .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, redact)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, redact)
    .replace(/\b(?:ASIA|AIDA)[0-9A-Z]{16}\b/g, redact);
  const trimmed = sanitized.trim().slice(0, 4000).trim();
  if (!trimmed) return "";
  const safeCharacters = trimmed.replace(/\[REDACTED(?:_ENV)?\]/g, "").replace(/\s/g, "").length;
  if (secretMatches > 0 && safeCharacters < Math.max(12, trimmed.length * 0.2)) return "";
  return trimmed;
}

function validUnicode(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += value[index] + value[index + 1];
        index += 1;
      } else output += " ";
    } else if (code >= 0xdc00 && code <= 0xdfff) output += " ";
    else output += value[index];
  }
  return output;
}

export function isMemorySourceEligible(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /^```[\s\S]*```$/.test(trimmed) || /^>/.test(trimmed)) return false;
  if (/^(?:\$|#)?\s*(?:debug|trace|info|warn|error)\b[\s\S]*$/i.test(trimmed)) return false;
  if (/^(?:[\w.-]+\s*:\s*)?(?:npm|pnpm|yarn|git|cargo|python|node)\s+/i.test(trimmed)) return false;
  return redactMemoryInput(trimmed).length > 0;
}

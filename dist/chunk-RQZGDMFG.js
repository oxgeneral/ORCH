// src/infrastructure/security/redaction.ts
var SECRET_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
  [/\b(A3T[A-Z0-9]|AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]"],
  [/\b(?:xox[baprs]-)[A-Za-z0-9-]{20,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED_JWT]"],
  [/(Authorization\s*:\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/(Authorization\s*:\s*Basic\s+)[^\s"']+/gi, "$1[REDACTED]"],
  [/(["']?authorization["']?\s*[:=]\s*["']?Bearer\s+)[^"'\s,}]+/gi, "$1[REDACTED]"],
  [/((?:Cookie|Cookies|Set-Cookie|X-Api-Key)\s*:\s*)[^\r\n]+/gi, "$1[REDACTED]"],
  [/(\b(?:api[_-]?key|x[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|private[_-]?key|cookie|cookies|set-cookie)\b\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]"],
  [/(["']?\b(?:api[_-]?key|x[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|private[_-]?key|cookie|cookies|set-cookie)\b["']?\s*[:=]\s*["'])[^"']+(["'])/gi, "$1[REDACTED]$2"],
  [/(https?:\/\/[^\s/:]+:)[^\s@]+(@)/gi, "$1[REDACTED]$2"]
];
var SENSITIVE_KEY_RE = /^(?:api[_-]?key|apikey|x[_-]?api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|secret|client[_-]?secret|authorization|private[_-]?key|cookie|cookies|set-cookie)$/i;
var ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\)|P[^\x1B]*(?:\x1B\\))/g;
var CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g;
function redactSecrets(text) {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redacted;
}
function stripTerminalControls(text) {
  return text.replace(ANSI_PATTERN, "").replace(CONTROL_PATTERN, "");
}
function sanitizeText(text) {
  return stripTerminalControls(redactSecrets(text));
}
function sanitizeForPersistence(value) {
  if (typeof value === "string") return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeForPersistence);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_RE.test(key) ? "[REDACTED]" : sanitizeForPersistence(nested);
    }
    return out;
  }
  return value;
}

export { sanitizeForPersistence, sanitizeText };
//# sourceMappingURL=chunk-RQZGDMFG.js.map
//# sourceMappingURL=chunk-RQZGDMFG.js.map
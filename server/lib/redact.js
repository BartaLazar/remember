const MASK = '[REDACTED]';

const PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abp]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
];

// NAME=value, NAME: value, "name": "value" where NAME looks secret-ish. Value is a closed
// "..." or '...' (may hold the other quote), an unterminated quote (rest of line, bounded),
// or a bare token.
const NAMED = /((?:key|secret|token|passw|pwd|auth)[A-Za-z0-9_.-]{0,64}["']?\s*[:=]\s*(?:(?:Bearer|Basic|Token)\s+)?)(?:"([^"\r\n]{1,2000})"|'([^'\r\n]{1,2000})'|["'][^\r\n]{1,2000}|([^\s"',;]{3,}))/gi;

// scheme://user:password@host  (scheme length bounded to keep matching linear)
const USERINFO = /([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]+:)[^\s@/]+@/gi;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CANDIDATE = /[A-Za-z0-9+/_\-=]{32,}/g;

function entropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function looksSecret(tok) {
  if (UUID.test(tok)) return false;
  if (/^[0-9a-fA-F]+$/.test(tok)) return false; // git SHAs, hashes
  if (!/[0-9]/.test(tok) || !/[A-Za-z]/.test(tok)) return false;
  return entropy(tok) > 4.0;
}

/** Mask secrets in `text` with [REDACTED]. */
export function redact(text) {
  let out = String(text);
  for (const re of PATTERNS) out = out.replace(re, MASK);
  out = out.replace(USERINFO, `$1${MASK}@`);
  out = out.replace(NAMED, (_, head, dq, sq) => (dq ? `${head}"${MASK}"` : sq ? `${head}'${MASK}'` : head + MASK));
  out = out.replace(CANDIDATE, (tok) => (looksSecret(tok) ? MASK : tok));
  return out;
}

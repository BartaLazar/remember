import { redact } from './redact.js';

const REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

function textOf(content) {
  const raw = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n')
      : '';
  return raw.replace(REMINDER, '').trim();
}

/** Parse a Claude Code transcript (.jsonl) into user→assistant exchanges, redacted. */
export function parseTranscript(jsonl) {
  let sessionId = null;
  const sessionIds = new Set();
  let cwd = null;
  const raw = [];
  let cur = null;

  for (const line of String(jsonl).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (typeof rec.sessionId === 'string') {
      sessionIds.add(rec.sessionId);
      if (sessionId === null) sessionId = rec.sessionId;
    }
    if (cwd === null && typeof rec.cwd === 'string') cwd = rec.cwd;

    if (rec.type === 'user' && !rec.isMeta) {
      const text = textOf(rec.message?.content);
      if (!text) continue; // tool_result-only or empty
      cur = { timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : null, user: text, claude: [] };
      raw.push(cur);
    } else if (rec.type === 'assistant' && cur) {
      const text = textOf(rec.message?.content);
      if (text) cur.claude.push(text);
    }
  }

  const exchanges = raw.map((e, index) => {
    let text = `User: ${e.user}`;
    if (e.claude.length) text += `\n\nClaude: ${e.claude.join('\n\n')}`;
    return { index, timestamp: e.timestamp, text: redact(text) };
  });
  return { sessionId, sessionIds: [...sessionIds], cwd, exchanges };
}

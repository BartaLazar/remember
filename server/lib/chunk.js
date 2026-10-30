const MIN_LINES = 40;
const MAX_LINES = 80;
const OVERLAP = 5;
const MD_EXT = new Set(['.md', '.mdx', '.markdown']);
const CODE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts',
  '.swift', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.scala', '.sh', '.bash', '.zsh', '.ps1',
  '.lua', '.pl', '.r', '.sql', '.vue', '.svelte', '.dart', '.ex', '.exs', '.clj', '.hs', '.m', '.mm',
  '.css', '.scss', '.less', '.html', '.json', '.yaml', '.yml', '.toml',
]);

const extOf = (rel) => {
  const base = rel.slice(rel.lastIndexOf('/') + 1);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i).toLowerCase();
};

/** Split `text` into pieces of at most `max` chars (never splitting a surrogate pair). */
export function splitLong(text, max = 2000) {
  if (text.length <= max) return [text];
  const out = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + max, text.length);
    if (end < text.length) {
      const c = text.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff && end - 1 > i) end -= 1;
    }
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const isBlank = (l) => l.trim() === '';

/** 1-based inclusive [start, end] block ranges: runs of non-blank lines plus trailing blanks. */
function blocks(lines, from, to) {
  const out = [];
  let s = from;
  for (let i = from; i <= to; i++) {
    const endsBlock = i === to || (isBlank(lines[i - 1]) === false && isBlank(lines[i]));
    if (endsBlock) {
      let e = i;
      while (e < to && isBlank(lines[e])) e++;
      out.push([s, e]);
      s = e + 1;
      i = e;
    }
  }
  return out;
}

/** Code: blocks packed into 40-80 line windows, consecutive windows overlap by 5 lines. */
function codeRanges(lines, from, to) {
  const ranges = [];
  const ends = new Set(blocks(lines, from, to).map((b) => b[1]));
  let s = from;
  for (;;) {
    if (to - s + 1 <= MAX_LINES) { ranges.push([s, to]); break; }
    let e = s + MAX_LINES - 1;
    for (let c = s + MAX_LINES - 1; c >= s + MIN_LINES - 1; c--) {
      if (ends.has(c)) { e = c; break; }
    }
    ranges.push([s, e]);
    s = e - OVERLAP + 1;
  }
  return ranges;
}

/** Prose: blocks packed greedily up to 80 lines, no overlap. */
function proseRanges(lines, from, to) {
  const ranges = [];
  let cur = null;
  for (const [bs, be] of blocks(lines, from, to)) {
    for (let s = bs; s <= be; s += MAX_LINES) {
      const e = Math.min(s + MAX_LINES - 1, be);
      if (cur && e - cur[0] + 1 <= MAX_LINES) cur[1] = e;
      else { cur = [s, e]; ranges.push(cur); }
    }
  }
  return ranges;
}

function markdownRanges(lines) {
  const starts = [];
  let fence = null;
  lines.forEach((l, i) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(l);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      return;
    }
    if (!fence && /^#{1,6}\s/.test(l)) starts.push(i + 1);
  });
  if (starts[0] !== 1) starts.unshift(1);
  const ranges = [];
  starts.forEach((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] - 1 : lines.length;
    if (e - s + 1 <= MAX_LINES) ranges.push([s, e]);
    else ranges.push(...proseRanges(lines, s, e));
  });
  return ranges;
}

/** Split text into chunks with 1-based inclusive line ranges. */
export function chunkText(rel, text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (!lines.length) return [];
  const ext = extOf(rel);
  let ranges;
  if (MD_EXT.has(ext)) ranges = markdownRanges(lines);
  else if (CODE_EXT.has(ext)) ranges = codeRanges(lines, 1, lines.length);
  else ranges = proseRanges(lines, 1, lines.length);

  const out = [];
  for (const [startLine, endLine] of ranges) {
    const body = lines.slice(startLine - 1, endLine).join('\n').replace(/\r/g, '');
    if (body.trim() === '') continue;
    for (const piece of splitLong(body)) out.push({ startLine, endLine, text: piece });
  }
  return out;
}

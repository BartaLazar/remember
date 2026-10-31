// Renders the README's savings charts as light and dark SVGs in docs/img/.
// Numbers come from bench/results/code-summary.md and memory-summary.md; update them here after a re-run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'img');

const THEMES = {
  light: {
    surface: '#fcfcfb', ink: '#0b0b0b', ink2: '#52514e', muted: '#8a8984', grid: '#e1e0d9', axis: '#c3c2b7',
    accent: '#2a78d6', context: '#9a9993', loss: '#e34948', border: 'rgba(11,11,11,0.10)',
  },
  dark: {
    surface: '#1a1a19', ink: '#f0efec', ink2: '#c3c2b7', muted: '#8f8e88', grid: '#2c2c2a', axis: '#383835',
    accent: '#3987e5', context: '#6e6d68', loss: '#e66767', border: 'rgba(255,255,255,0.10)',
  },
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const W = 880;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => n.toLocaleString('en-US');

function svg(t, h, body, title, w = W) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${t.surface}" stroke="${t.border}"/>
<g font-family="${FONT}">
${body}
</g>
</svg>
`;
}

const text = (x, y, s, { size = 14, fill, weight = 400, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${esc(s)}</text>`;

// Horizontal bar from x0 with a 4px rounded data end (right for positive, left for negative).
function bar(x0, y, len, h, fill) {
  const r = Math.min(4, Math.abs(len) / 2, h / 2);
  if (len >= 0) {
    const x1 = x0 + len;
    return `<path d="M${x0},${y} H${x1 - r} Q${x1},${y} ${x1},${y + r} V${y + h - r} Q${x1},${y + h} ${x1 - r},${y + h} H${x0} Z" fill="${fill}"/>`;
  }
  const x1 = x0 + len;
  return `<path d="M${x0},${y} H${x1 + r} Q${x1},${y} ${x1},${y + r} V${y + h - r} Q${x1},${y + h} ${x1 + r},${y + h} H${x0} Z" fill="${fill}"/>`;
}

function hero(t) {
  const tiles = [
    ['78%', 'fewer tokens to find code', 'than reading whole files'],
    ['47%', 'fewer tokens to find code', 'than careful grepping'],
    ['230×', 'cheaper to recall a decision', 'than searching old chats'],
    ['1', 'lookup pays for the plugin', 'in every session'],
  ];
  const HW = 1040;
  const tw = (HW - 40 - 3 * 16) / 4;
  const body = tiles.map(([v, a, b], i) => {
    const x = 20 + i * (tw + 16);
    return [
      `<rect x="${x}" y="20" width="${tw}" height="128" rx="10" fill="none" stroke="${t.border}"/>`,
      text(x + 18, 76, v, { size: 44, weight: 600, fill: t.ink }),
      `<rect x="${x + 18}" y="88" width="28" height="3" rx="1.5" fill="${t.accent}"/>`,
      text(x + 18, 112, a, { size: 14, fill: t.ink }),
      text(x + 18, 131, b, { size: 13, fill: t.ink2 }),
    ].join('\n');
  }).join('\n');
  return svg(t, 168, body, 'remember at a glance: 78% fewer tokens than reading whole files, 47% fewer than careful grepping, 230 times cheaper to recall a decision, pays for itself on the first lookup', HW);
}

function codeTokens(t) {
  const rows = [
    ['Reading whole files', 'grep, then read each matching file', 23724, t.context, '23,700 tokens'],
    ['Careful grepping', 'grep, then read 120 lines per match', 11211, t.context, '11,200 tokens'],
    ['remember', 'search, then read the lines it points to', 2180, t.accent, '2,200 tokens'],
  ];
  const x0 = 250; const maxLen = W - x0 - 150; const max = 23724;
  let y = 36;
  const parts = [text(20, y, 'Tokens to answer one code question (median of 604)', { size: 15, weight: 600, fill: t.ink })];
  y += 22;
  for (const [label, sub, v, fill, valueLabel] of rows) {
    const len = (v / max) * maxLen;
    parts.push(text(20, y + 16, label, { size: 14, weight: label === 'remember' ? 600 : 400, fill: t.ink }));
    parts.push(text(20, y + 34, sub, { size: 12, fill: t.ink2 }));
    parts.push(bar(x0, y + 6, len, 22, fill));
    parts.push(text(x0 + len + 10, y + 22, valueLabel, { size: 14, weight: label === 'remember' ? 600 : 400, fill: t.ink }));
    y += 52;
  }
  parts.push(`<line x1="${x0}" y1="58" x2="${x0}" y2="${y - 10}" stroke="${t.axis}" stroke-width="1"/>`);
  return svg(t, y + 6, parts.join('\n'), 'Tokens per code question: reading whole files 23,700, careful grepping 11,200, remember 2,200');
}

function byType(t) {
  const rows = [
    ['Describes behaviour', 65, 94],
    ['Exact name', 48, 98],
    ['A few keywords', 56, 89],
    ['Free-form question', -3, 66],
    ['Other language than the code', -72, 13],
  ];
  const labelW = 250; const right = W - 150; const zero = labelW + (right - labelW) * (80 / 160);
  const scale = (right - labelW) / 160;
  let y = 36;
  const parts = [
    text(20, y, 'Tokens saved vs careful grepping, by kind of question', { size: 15, weight: 600, fill: t.ink }),
    text(W - 20, y, 'found in top 8', { size: 12, fill: t.ink2, anchor: 'end' }),
  ];
  y += 18;
  const top = y;
  for (const [label, saved, found] of rows) {
    const len = saved * scale;
    const fill = saved >= 0 ? t.accent : t.loss;
    parts.push(text(20, y + 20, label, { size: 14, fill: t.ink }));
    parts.push(bar(zero, y + 6, len, 20, fill));
    const lx = saved >= 0 ? zero + len + 8 : zero + len - 8;
    parts.push(text(lx, y + 21, `${saved > 0 ? '+' : saved < 0 ? '−' : ''}${Math.abs(saved)}%`, { size: 13, weight: 600, fill: t.ink, anchor: saved >= 0 ? 'start' : 'end' }));
    parts.push(text(W - 20, y + 21, `${found}%`, { size: 13, fill: t.ink2, anchor: 'end' }));
    y += 36;
  }
  parts.push(`<line x1="${zero}" y1="${top}" x2="${zero}" y2="${y}" stroke="${t.axis}" stroke-width="1"/>`);
  parts.push(text(zero + 6, y + 18, 'saves tokens →', { size: 12, fill: t.ink2 }));
  parts.push(text(zero - 6, y + 18, '← costs more', { size: 12, fill: t.ink2, anchor: 'end' }));
  return svg(t, y + 34, parts.join('\n'), 'Tokens saved versus careful grepping: behaviour questions +65%, exact names +48%, keywords +56%, free-form -3%, other language -72%');
}

function decisions(t) {
  const rows = [
    ['Grep old chats, read the best match', 150645, t.context, '150,600 tokens', 'found 45%'],
    ['remember', 656, t.accent, '660 tokens · 230× fewer', 'found 83%'],
  ];
  const x0 = 280; const maxLen = W - x0 - 200; const max = 150645;
  let y = 36;
  const parts = [text(20, y, 'Tokens to recall one past decision (median of 80)', { size: 15, weight: 600, fill: t.ink })];
  y += 22;
  for (const [label, v, fill, valueLabel, found] of rows) {
    const len = Math.max(3, (v / max) * maxLen);
    const bold = label === 'remember' ? 600 : 400;
    parts.push(text(20, y + 16, label, { size: 14, weight: bold, fill: t.ink }));
    parts.push(text(20, y + 34, found, { size: 12, fill: t.ink2 }));
    parts.push(bar(x0, y + 6, len, 22, fill));
    parts.push(text(x0 + len + 10, y + 22, valueLabel, { size: 14, weight: bold, fill: t.ink }));
    y += 52;
  }
  parts.push(`<line x1="${x0}" y1="58" x2="${x0}" y2="${y - 10}" stroke="${t.axis}" stroke-width="1"/>`);
  return svg(t, y + 6, parts.join('\n'), 'Tokens to recall a past decision: grepping old chats 150,600 and found 45%; remember 660 and found 83%');
}

fs.mkdirSync(OUT, { recursive: true });
for (const [mode, t] of Object.entries(THEMES)) {
  for (const [name, fn] of Object.entries({ hero, 'code-tokens': codeTokens, 'by-type': byType, decisions })) {
    fs.writeFileSync(path.join(OUT, `${name}-${mode}.svg`), fn(t));
  }
}
console.log(`wrote ${fs.readdirSync(OUT).length} files to ${OUT}`);

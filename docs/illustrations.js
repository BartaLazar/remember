// Draws the README illustrations (pixel-art bot and filing cabinet) as light and dark SVGs in docs/img/.
// Run: node docs/illustrations.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'img');
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const THEMES = {
  light: {
    bg: '#f6f1e9', border: 'rgba(11,11,11,0.08)', floor: '#e6dccb', ink: '#2b2a27', ink2: '#6b6860',
    bot: '#d97757', botShade: '#b85f42', eye: '#1f1e1c',
    cab: '#5b5a55', cabEdge: '#3f3e3a', drawer: '#ece6da', drawerEdge: '#cfc7b6', plate: '#fbf8f2', handle: '#8a8984',
    card: '#ffffff', cardEdge: '#d8d2c4', line: '#c9c2b2', accent: '#2a78d6', spark: '#e8a33d', trail: '#c7bba5',
  },
  dark: {
    bg: '#1c1b19', border: 'rgba(255,255,255,0.08)', floor: '#2a2926', ink: '#f0efec', ink2: '#b4b2a8',
    bot: '#d97757', botShade: '#a9583d', eye: '#121211',
    cab: '#6e6d68', cabEdge: '#4a4945', drawer: '#3a3935', drawerEdge: '#2c2b28', plate: '#55534e', handle: '#9a9993',
    card: '#f4f1ea', cardEdge: '#bdb6a6', line: '#bdb5a3', accent: '#3987e5', spark: '#f0b44d', trail: '#56534c',
  },
};

const r = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}" ${extra}/>`;
const t = (x, y, s, size, fill, { weight = 600, anchor = 'middle', font = FONT, spacing = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}">${s}</text>`;

// The bot, in pixel units of size u. armsUp raises both arms (carrying something overhead).
function bot(c, x, y, u, { armsUp = false, blink = false } = {}) {
  const p = (px, py, w, h, fill) => r(x + px * u, y + py * u, w * u, h * u, fill);
  const out = [
    p(1, 0, 10, 6, c.bot),
    p(1, 5, 10, 1, c.botShade),
    blink ? p(3, 2, 1, 1, c.eye) : p(3, 1, 1, 2, c.eye),
    blink ? p(8, 2, 1, 1, c.eye) : p(8, 1, 1, 2, c.eye),
    p(2, 6, 1, 2, c.bot), p(4, 6, 1, 2, c.bot), p(7, 6, 1, 2, c.bot), p(9, 6, 1, 2, c.bot),
  ];
  if (armsUp) out.push(p(0, -1, 1, 3, c.bot), p(11, -1, 1, 3, c.bot));
  else out.push(p(0, 2, 1, 2, c.bot), p(11, 2, 1, 2, c.bot));
  return `<g shape-rendering="crispEdges">${out.join('')}</g>`;
}

// A knowledge card with a little icon: code, chat or note.
function card(c, x, y, kind, rot = 0, w = 56) {
  const icon = {
    code: t(x + 16, y + 26, '&lt;/&gt;', 13, c.accent, { font: MONO, weight: 700 }),
    chat: `<path d="M${x + 7},${y + 12} h18 a3,3 0 0 1 3,3 v8 a3,3 0 0 1 -3,3 h-10 l-5,4 v-4 h-3 a3,3 0 0 1 -3,-3 v-8 a3,3 0 0 1 3,-3 z" fill="${c.bot}"/>`,
    note: `<path d="M${x + 8},${y + 10} h14 l5,5 v15 h-19 z" fill="${c.spark}"/>`,
  }[kind];
  return `<g transform="rotate(${rot} ${x + 24} ${y + 20})">
  <rect x="${x}" y="${y}" width="${w}" height="40" rx="4" fill="${c.card}" stroke="${c.cardEdge}"/>
  ${icon}
  ${r(x + 34, y + 12, w - 40, 3, c.line, 'rx="1.5"')}${r(x + 34, y + 19, w - 44, 3, c.line, 'rx="1.5"')}${r(x + 34, y + 26, w - 42, 3, c.line, 'rx="1.5"')}
</g>`;
}

function sparkle(c, x, y, s = 6) {
  return `<path d="M${x},${y - s} L${x + s * 0.3},${y - s * 0.3} L${x + s},${y} L${x + s * 0.3},${y + s * 0.3} L${x},${y + s} L${x - s * 0.3},${y + s * 0.3} L${x - s},${y} L${x - s * 0.3},${y - s * 0.3} Z" fill="${c.spark}"/>`;
}

// Filing cabinet with three drawers; `open` is the index of the pulled-out drawer (or -1).
function cabinet(c, x, y, { labels = ['FILES', 'CHATS', 'NOTES'], open = 0, cardsInOpen = 3 } = {}) {
  const w = 220; const dh = 70; const gap = 10; const h = 3 * dh + 4 * gap;
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${c.cab}" stroke="${c.cabEdge}" stroke-width="2"/>`];
  labels.forEach((label, i) => {
    const dy = y + gap + i * (dh + gap);
    if (i === open) {
      // pulled-out drawer: inner box visible, front shifted down-left
      const ox = x - 36; const oy = dy + 10;
      parts.push(`<rect x="${x + 6}" y="${dy}" width="${w - 12}" height="${dh}" rx="3" fill="${c.cabEdge}"/>`);
      parts.push(`<path d="M${ox + 6},${oy} L${x + 6},${dy} L${x + w - 6},${dy} L${ox + w - 6},${oy} Z" fill="${c.drawerEdge}"/>`);
      for (let k = 0; k < cardsInOpen; k++) {
        parts.push(`<rect x="${ox + 22 + k * 52}" y="${oy - 22 + (k % 2) * 4}" width="44" height="30" rx="3" fill="${c.card}" stroke="${c.cardEdge}"/>`);
        parts.push(r(ox + 28 + k * 52, oy - 15 + (k % 2) * 4, 24, 3, c.line, 'rx="1.5"'));
      }
      parts.push(`<rect x="${ox}" y="${oy}" width="${w}" height="${dh}" rx="4" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`);
      parts.push(plate(c, ox + w / 2, oy + 24, label));
      parts.push(`<rect x="${ox + w / 2 - 22}" y="${oy + 46}" width="44" height="8" rx="4" fill="${c.handle}"/>`);
    } else {
      parts.push(`<rect x="${x + 8}" y="${dy}" width="${w - 16}" height="${dh}" rx="4" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`);
      parts.push(plate(c, x + w / 2, dy + 24, label));
      parts.push(`<rect x="${x + w / 2 - 22}" y="${dy + 46}" width="44" height="8" rx="4" fill="${c.handle}"/>`);
    }
  });
  return parts.join('\n');
}

function plate(c, cx, cy, label) {
  return `<rect x="${cx - 38}" y="${cy - 13}" width="76" height="22" rx="3" fill="${c.plate}" stroke="${c.drawerEdge}"/>`
    + t(cx, cy + 3, label, 11, c.ink, { spacing: 1.5, weight: 700 });
}

function frame(c, w, h, body, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}">
<title>${title}</title>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${c.bg}" stroke="${c.border}"/>
${body}
</svg>
`;
}

// Hero banner: the bot carries a card overhead to the open drawer; more knowledge floats in from the left.
function filing(c) {
  const W = 880; const H = 320; const floorY = 282;
  const cabX = 600; const cabY = floorY - 250;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    // trail of incoming knowledge
    `<path d="M70,200 C140,110 220,90 300,110" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`,
    card(c, 40, 196, 'code', -8),
    card(c, 120, 128, 'chat', 6),
    card(c, 210, 92, 'note', -4),
    // bot carrying a card toward the drawer
    bot(c, 380, floorY - 64, 8, { armsUp: true }),
    card(c, 378, floorY - 110, 'code', 0, 100),
    sparkle(c, 500, 140, 7),
    // cabinet
    cabinet(c, cabX, cabY, { open: 0 }),
    sparkle(c, 820, 40, 6),
    sparkle(c, 560, 50, 4),
  ];
  return frame(c, W, H, body.join('\n'), 'An orange pixel bot files code, chats and notes into a big cabinet of drawers');
}

// Search scene: the bot holds up the one card it pulled from the drawer, labelled with a file and line range.
function finding(c) {
  const W = 880; const H = 310; const floorY = 276;
  const cabX = 70; const cabY = floorY - 250;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    cabinet(c, cabX + 36, cabY, { open: 0, cardsInOpen: 2 }),
    // bot with a magnifying glass
    bot(c, 400, floorY - 64, 8, { blink: true }),
    `<circle cx="512" cy="${floorY - 70}" r="18" fill="none" stroke="${c.ink}" stroke-width="5"/>`,
    `<line x1="499" y1="${floorY - 57}" x2="${488}" y2="${floorY - 44}" stroke="${c.ink}" stroke-width="6" stroke-linecap="round"/>`,
    // the found card, raised
    `<g transform="rotate(-4 680 120)">
  <rect x="560" y="74" width="272" height="92" rx="8" fill="${c.card}" stroke="${c.cardEdge}" stroke-width="1.5"/>
  ${t(580, 104, 'src/auth/session.ts:88-121', 15, c.accent, { anchor: 'start', font: MONO, weight: 700 })}
  ${r(580, 118, 180, 5, c.line, 'rx="2.5"')}${r(580, 130, 140, 5, c.line, 'rx="2.5"')}${r(580, 142, 160, 5, c.line, 'rx="2.5"')}
</g>`,
    `<path d="M560,160 L522,${floorY - 92}" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    sparkle(c, 830, 70, 7), sparkle(c, 545, 68, 5),
    t(685, 214, 'one card, not the whole drawer', 15, c.ink2, { weight: 500 }),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot pulls one card out of the drawer: src/auth/session.ts lines 88 to 121');
}

fs.mkdirSync(OUT, { recursive: true });
for (const [mode, c] of Object.entries(THEMES)) {
  fs.writeFileSync(path.join(OUT, `filing-${mode}.svg`), filing(c));
  fs.writeFileSync(path.join(OUT, `finding-${mode}.svg`), finding(c));
}
console.log('wrote illustrations to', OUT);

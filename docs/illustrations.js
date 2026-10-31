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
    card: '#ffffff', cardEdge: '#d8d2c4', line: '#c9c2b2', accent: '#2a78d6', spark: '#e8a33d', trail: '#c7bba5', stop: '#e34948', good: '#0ca30c', cardInk: '#2b2a27', cardInk2: '#6b6860', chip: '#ece6da',
  },
  dark: {
    bg: '#1c1b19', border: 'rgba(255,255,255,0.08)', floor: '#2a2926', ink: '#f0efec', ink2: '#b4b2a8',
    bot: '#d97757', botShade: '#a9583d', eye: '#121211',
    cab: '#6e6d68', cabEdge: '#4a4945', drawer: '#3a3935', drawerEdge: '#2c2b28', plate: '#55534e', handle: '#9a9993',
    card: '#f4f1ea', cardEdge: '#bdb6a6', line: '#bdb5a3', accent: '#3987e5', spark: '#f0b44d', trail: '#56534c', stop: '#e66767', good: '#2fb52f', cardInk: '#2b2a27', cardInk2: '#6b6860', chip: '#e4ddcf',
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

// Speech bubble with its tail pointing down-left toward (tx, ty).
function bubble(c, x, y, w, h, tx, ty, inner) {
  return `<path d="M${x + 24},${y + h} L${tx},${ty} L${x + 46},${y + h}" fill="${c.card}" stroke="${c.cardEdge}" stroke-width="1.5" stroke-linejoin="round"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${c.card}" stroke="${c.cardEdge}" stroke-width="1.5"/>
<rect x="${x + 25}" y="${y + h - 2}" width="20" height="4" fill="${c.card}"/>
${inner}`;
}

function padlock(c, x, y) {
  return `<path d="M${x + 6},${y + 16} v-6 a10,10 0 0 1 20,0 v6" fill="none" stroke="${c.ink}" stroke-width="4"/>
<rect x="${x}" y="${y + 14}" width="32" height="26" rx="4" fill="${c.spark}"/>
<rect x="${x + 14}" y="${y + 22}" width="4" height="10" rx="2" fill="${c.ink}"/>`;
}

function cloud(c, x, y) {
  return `<g fill="${c.trail}">
  <circle cx="${x + 30}" cy="${y + 34}" r="20"/><circle cx="${x + 58}" cy="${y + 24}" r="26"/><circle cx="${x + 88}" cy="${y + 36}" r="18"/>
  <rect x="${x + 30}" y="${y + 34}" width="58" height="20"/>
</g>`;
}

const scaled = (x, y, k, inner) => `<g transform="translate(${x} ${y}) scale(${k})">${inner}</g>`;

// Privacy: everything stays inside your machine; the cloud is crossed out.
function privacy(c) {
  const W = 880; const H = 250; const floorY = 214;
  const body = [
    `<rect x="40" y="26" width="520" height="206" rx="16" fill="none" stroke="${c.ink2}" stroke-width="2.5" stroke-dasharray="8 7"/>`,
    t(64, 52, 'YOUR MACHINE', 12, c.ink2, { anchor: 'start', spacing: 2, weight: 700 }),
    r(60, floorY, 480, 4, c.floor, 'rx="2"'),
    scaled(320, floorY - 160, 0.64, cabinet(c, 0, 0, { open: -1 })),
    padlock(c, 452, 112),
    bot(c, 150, floorY - 64, 8, { blink: true }),
    card(c, 250, floorY - 74, 'chat', 8),
    cloud(c, 680, 70),
    `<path d="M570,128 C610,118 640,112 676,110" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`,
    `<circle cx="738" cy="104" r="44" fill="none" stroke="${c.stop}" stroke-width="7"/>`,
    `<line x1="707" y1="135" x2="769" y2="73" stroke="${c.stop}" stroke-width="7" stroke-linecap="round"/>`,
    t(738, 190, 'nothing leaves', 15, c.ink2, { weight: 500 }),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot keeps everything locked inside your machine; the cloud is crossed out');
}

// Saving a decision: a new gold note goes in, the replaced one lies crossed out on the floor.
function noting(c) {
  const W = 880; const H = 250; const floorY = 214;
  const noteCard = (x, y, title, sub, fill, rot, struck) => `<g transform="rotate(${rot} ${x + 131} ${y + 34})">
  <rect x="${x}" y="${y}" width="262" height="68" rx="6" fill="${c.card}" stroke="${c.cardEdge}"/>
  <path d="M${x + 14},${y + 14} h18 l6,6 v24 h-24 z" fill="${fill}"/>
  ${t(x + 52, y + 30, title, 14, c.cardInk, { anchor: 'start' })}
  ${t(x + 52, y + 50, sub, 12, c.cardInk2, { anchor: 'start', weight: 500 })}
  ${struck ? `<line x1="${x + 48}" y1="${y + 26}" x2="${x + 220}" y2="${y + 26}" stroke="${c.stop}" stroke-width="3" stroke-linecap="round"/>` : ''}
</g>`;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    scaled(610, floorY - 175, 0.7, cabinet(c, 0, 0, { open: 2, cardsInOpen: 3 })),
    bot(c, 420, floorY - 64, 8, { armsUp: true }),
    noteCard(330, floorY - 140, 'Cursor pagination', 'because offsets broke at 1M rows', c.spark, -3, false),
    noteCard(60, floorY - 50, 'Offset pagination', 'replaced', c.line, 4, true),
    sparkle(c, 590, 46, 7), sparkle(c, 320, 56, 5),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot files a new decision note about cursor pagination; the old offset note lies crossed out on the floor');
}

// Forget: a card goes into the shredder and never comes back.
function forgetting(c) {
  const W = 880; const H = 250; const floorY = 214;
  const sx = 470; const sy = 70;
  const strips = Array.from({ length: 9 }, (_, i) =>
    r(sx + 22 + i * 14, sy + 92 + (i % 3) * 3, 8, 34 - (i % 4) * 5, c.card, `stroke="${c.cardEdge}"`)).join('');
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 330, floorY - 64, 8, { armsUp: true }),
    `<g transform="rotate(12 ${sx + 40} ${sy - 6})">
  <rect x="${sx}" y="${sy - 30}" width="120" height="44" rx="5" fill="${c.card}" stroke="${c.cardEdge}"/>
  ${t(sx + 60, sy - 2, 'legacy/**', 15, c.cardInk, { font: MONO, weight: 700 })}
</g>`,
    `<rect x="${sx - 10}" y="${sy + 10}" width="170" height="78" rx="8" fill="${c.cab}" stroke="${c.cabEdge}" stroke-width="2"/>`,
    r(sx + 15, sy + 22, 120, 6, c.cabEdge, 'rx="3"'),
    `<rect x="${sx + 37}" y="${sy + 46}" width="76" height="22" rx="3" fill="${c.plate}" stroke="${c.drawerEdge}"/>`,
    t(sx + 75, sy + 61, 'FORGET', 11, c.ink, { spacing: 1.5, weight: 700 }),
    strips,
    `<rect x="${sx}" y="${sy + 120}" width="150" height="${floorY - sy - 120}" rx="6" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`,
    t(740, 120, 'gone from the index,', 15, c.ink2, { weight: 500 }),
    t(740, 142, 'and kept out', 15, c.ink2, { weight: 500 }),
    r(436, 96, 26, 3, c.trail, 'rx="1.5"'), r(440, 106, 18, 3, c.trail, 'rx="1.5"'),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot feeds a card labelled legacy/** into a shredder marked forget');
}

// Big project: a tower of files and the bot asking before it starts.
function bigProject(c) {
  const W = 880; const H = 270; const floorY = 236;
  const pile = Array.from({ length: 11 }, (_, i) => {
    const y = floorY - 16 - i * 17; const x = 90 + ((i * 37) % 23) - 11;
    return `<rect x="${x}" y="${y}" width="150" height="16" rx="3" fill="${c.card}" stroke="${c.cardEdge}"/>${r(x + 12, y + 6, 60 + (i % 3) * 20, 3, c.line, 'rx="1.5"')}`;
  }).join('');
  const btn = (x, y, label, fill, ink) => `<rect x="${x}" y="${y}" width="${label.length * 8 + 28}" height="26" rx="13" fill="${fill}"/>${t(x + (label.length * 8 + 28) / 2, y + 17, label, 12, ink)}`;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    pile,
    t(165, 34, '5,000+ files', 13, c.ink2, { weight: 600 }),
    bot(c, 330, floorY - 64, 8, { blink: false }),
    bubble(c, 440, 34, 330, 110, 436, floorY - 70,
      t(464, 70, 'Big project. Index everything?', 16, c.cardInk, { anchor: 'start' })
      + btn(464, 92, 'Index all', c.accent, '#ffffff')
      + btn(570, 92, 'Skip', c.chip, c.cardInk)
      + btn(630, 92, 'Change limit', c.chip, c.cardInk)),
  ];
  return frame(c, W, H, body.join('\n'), 'Next to a tower of files, the bot asks whether to index everything, skip, or change the limit');
}

// Waiting for the model: keyword search keeps working meanwhile.
function waiting(c) {
  const W = 880; const H = 230; const floorY = 196;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 140, floorY - 64, 8, { blink: true }),
    t(262, 112, 'z', 18, c.ink2), t(280, 92, 'z', 22, c.ink2), t(302, 68, 'z', 26, c.ink2),
    `<rect x="380" y="70" width="440" height="96" rx="10" fill="${c.card}" stroke="${c.cardEdge}" stroke-width="1.5"/>`,
    t(404, 102, 'Downloading the model, once', 15, c.ink, { anchor: 'start' }),
    r(404, 118, 392, 12, c.drawer, 'rx="6"'),
    r(404, 118, 250, 12, c.accent, 'rx="6"'),
    t(796, 102, '76 / 120 MB', 13, c.ink2, { anchor: 'end', weight: 500 }),
    `<circle cx="412" cy="150" r="5" fill="${c.good}"/>`,
    t(424, 155, 'keyword search already works', 13, c.ink2, { anchor: 'start', weight: 500 }),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot dozes while the model downloads once; keyword search already works');
}

const TERM = { bg: '#24231f', ink: '#f0efec', dim: '#9a9993', ok: '#5cc85c' };

function terminal(x, y, w, lines) {
  const h = 36 + lines.length * 24;
  const dots = ['#e66767', '#f0b44d', '#5cc85c'].map((f, i) => `<circle cx="${x + 18 + i * 14}" cy="${y + 16}" r="4.5" fill="${f}"/>`).join('');
  const body = lines.map(([s, fill], i) => t(x + 18, y + 50 + i * 24, s, 14, fill, { anchor: 'start', font: MONO, weight: 500 })).join('');
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${TERM.bg}"/>${dots}${body}`;
}

function wrench(c, x, y, rot) {
  return `<g transform="rotate(${rot} ${x} ${y})">
  <rect x="${x - 4}" y="${y}" width="8" height="46" rx="4" fill="${c.ink2}"/>
  <circle cx="${x}" cy="${y - 2}" r="12" fill="${c.ink2}"/>
  <rect x="${x - 4}" y="${y - 16}" width="8" height="12" fill="${c.bg}"/>
</g>`;
}

// Install: the bot pops out of its box next to the two commands.
function install(c) {
  const W = 880; const H = 230; const floorY = 196;
  const bx = 150; const by = floorY - 70;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, bx + 22, by - 44, 8, { armsUp: true }),
    `<path d="M${bx},${by} l-34,-26 h70 l18,26 z" fill="${c.drawerEdge}"/>`,
    `<path d="M${bx + 140},${by} l34,-26 h-70 l-18,26 z" fill="${c.drawerEdge}"/>`,
    `<rect x="${bx}" y="${by}" width="140" height="70" rx="3" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`,
    r(bx + 52, by, 36, 70, c.plate),
    sparkle(c, bx - 30, 50, 7), sparkle(c, bx + 190, 62, 5),
    terminal(430, 46, 400, [['/plugin marketplace add BartaLazar/remember', TERM.ink], ['/plugin install remember@remember', TERM.ink], ['✓ ready, indexing in the background', TERM.ok]]),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot pops out of its box next to the two install commands');
}

// One open bin per source, cards standing up behind its front.
function bin(c, x, y, label, kind) {
  return [card(c, x + 14, y - 30, kind, -6), card(c, x + 70, y - 24, kind, 5),
    `<rect x="${x}" y="${y}" width="150" height="64" rx="5" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`,
    plate(c, x + 75, y + 30, label)].join('');
}

function remembered(c) {
  const W = 880; const H = 230; const floorY = 200;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 70, floorY - 64, 8, { armsUp: true }),
    card(c, 90, floorY - 110, 'note', -4),
    bin(c, 250, floorY - 64, 'FILES', 'code'),
    bin(c, 450, floorY - 64, 'CHATS', 'chat'),
    bin(c, 650, floorY - 64, 'NOTES', 'note'),
    sparkle(c, 840, 50, 6), sparkle(c, 420, 44, 5),
  ];
  return frame(c, W, H, body.join('\n'), 'Three open bins for files, chats and notes, with the bot sorting a card into them');
}

// How it works: one question, searched by meaning and by exact words, merged into one ranked list.
function howItWorks(c) {
  const W = 880; const H = 250;
  const lane = (x, y, title, glyph, widths) => `<rect x="${x}" y="${y}" width="200" height="86" rx="8" fill="${c.card}" stroke="${c.cardEdge}"/>
  ${glyph}${t(x + 44, y + 25, title, 13, c.cardInk, { anchor: 'start' })}
  ${widths.map((w, i) => r(x + 16, y + 40 + i * 13, w, 6, c.line, 'rx="3"')).join('')}`;
  const ranked = [0, 1, 2].map((i) => `<rect x="626" y="${78 + i * 40}" width="200" height="32" rx="6" fill="${i === 0 ? c.accent : c.card}" stroke="${i === 0 ? c.accent : c.cardEdge}"/>
  ${t(644, 99 + i * 40, String(i + 1), 13, i === 0 ? '#ffffff' : c.cardInk2)}
  ${r(662, 90 + i * 40, 120 - i * 20, 6, i === 0 ? '#ffffff' : c.line, 'rx="3"')}`).join('');
  const body = [
    `<rect x="40" y="96" width="170" height="54" rx="10" fill="${c.card}" stroke="${c.cardEdge}"/>`,
    t(125, 120, 'where do we log', 13, c.cardInk, { weight: 500 }), t(125, 138, 'people out?', 13, c.cardInk, { weight: 500 }),
    `<path d="M212,112 C260,90 270,70 320,66" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    `<path d="M212,134 C260,156 270,176 320,180" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    lane(324, 24, 'by meaning', `<circle cx="${346}" cy="${44}" r="8" fill="none" stroke="${c.accent}" stroke-width="3"/><line x1="352" y1="50" x2="358" y2="56" stroke="${c.accent}" stroke-width="3" stroke-linecap="round"/>`, [150, 120, 90]),
    lane(324, 140, 'by exact words', t(346, 165, 'Aa', 14, c.accent, { weight: 700 }), [130, 160, 100]),
    `<path d="M526,66 C570,70 580,100 620,110" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    `<path d="M526,182 C570,178 580,140 620,124" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    ranked,
    t(726, 216, 'merged into one ranking', 13, c.ink2, { weight: 500 }),
  ];
  return frame(c, W, H, body.join('\n'), 'A question is searched by meaning and by exact words, and the two result lists merge into one ranking');
}

// Savings: the bot drops token coins into a jar.
function savings(c) {
  const W = 880; const H = 250; const floorY = 220;
  const coin = (x, y) => `<circle cx="${x}" cy="${y}" r="13" fill="${c.spark}" stroke="${c.botShade}" stroke-width="1.5"/>${t(x, y + 5, 'T', 13, c.botShade, { weight: 800 })}`;
  const inJar = [[470, 196], [498, 198], [526, 196], [554, 198], [484, 172], [512, 174], [540, 172], [498, 148], [526, 150]].map(([x, y]) => coin(x, y)).join('');
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 270, floorY - 64, 8, { armsUp: true }),
    coin(318, floorY - 92), coin(410, 92), coin(436, 62),
    `<path d="M440,96 v118 a6,6 0 0 0 6,6 h132 a6,6 0 0 0 6,-6 v-118" fill="none" stroke="${c.ink2}" stroke-width="3"/>`,
    r(432, 90, 160, 8, c.ink2, 'rx="4"'),
    inJar,
    t(512, 124, 'tokens saved', 13, c.ink2, { weight: 600 }),
    t(740, 120, '79% fewer', 28, c.ink, { weight: 700 }),
    t(740, 146, 'than reading whole files', 13, c.ink2, { weight: 500 }),
    sparkle(c, 620, 70, 7),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot drops token coins into a jar labelled tokens saved: 78 percent fewer than reading whole files');
}

// Asking: a precise question points straight at one drawer.
function asking(c) {
  const W = 880; const H = 250; const floorY = 220;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 90, floorY - 64, 8),
    bubble(c, 170, 30, 330, 64, 160, floorY - 70,
      t(194, 69, 'Where is ', 16, c.cardInk, { anchor: 'start', weight: 500 })
      + t(268, 69, 'retryUpload', 16, c.accent, { anchor: 'start', font: MONO, weight: 700 })
      + t(384, 69, ' defined?', 16, c.cardInk, { anchor: 'start', weight: 500 })),
    `<path d="M500,74 C560,76 590,100 620,120" fill="none" stroke="${c.trail}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`,
    scaled(640, floorY - 175, 0.7, cabinet(c, 0, 0, { open: 0, cardsInOpen: 1 })),
    `<g transform="rotate(-5 580 170)"><rect x="470" y="140" width="150" height="40" rx="5" fill="${c.card}" stroke="${c.cardEdge}"/>${t(545, 165, 'upload.ts:42-67', 13, c.accent, { font: MONO, weight: 700 })}</g>`,
    sparkle(c, 630, 40, 6),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot asks where retryUpload is defined, and the answer comes straight from one drawer: upload.ts lines 42 to 67');
}

// The .remember/ folder: notes are the one thing worth backing up; git never sees the folder.
function dataFolder(c) {
  const W = 880; const H = 260; const floorY = 228;
  const chip = (x, y, name, note, hi) => `<rect x="${x}" y="${y}" width="170" height="52" rx="6" fill="${c.card}" stroke="${hi ? c.spark : c.cardEdge}" stroke-width="${hi ? 2.5 : 1}"/>
  ${t(x + 14, y + 22, name, 13, c.cardInk, { anchor: 'start', font: MONO, weight: 700 })}${t(x + 14, y + 41, note, 12, hi ? c.botShade : c.cardInk2, { anchor: 'start', weight: 600 })}`;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    `<path d="M250,40 h120 l18,20 h330 a8,8 0 0 1 8,8 v152 a8,8 0 0 1 -8,8 h-460 a8,8 0 0 1 -8,-8 v-172 a8,8 0 0 1 8,-8 z" fill="${c.drawer}" stroke="${c.drawerEdge}" stroke-width="2"/>`,
    t(268, 60, '.remember/', 14, c.ink, { anchor: 'start', font: MONO, weight: 700 }),
    chip(270, 84, 'notes.jsonl', '★ back this up', true),
    chip(456, 84, 'exclusions.json', 'what you forgot', false),
    chip(270, 150, 'index.db', 'rebuildable cache', false),
    chip(456, 150, '.gitignore  *', 'git never sees it', false),
    `<g transform="rotate(-8 700 70)"><rect x="642" y="52" width="120" height="34" rx="6" fill="none" stroke="${c.stop}" stroke-width="3"/>${t(702, 75, 'NOT IN GIT', 13, c.stop, { spacing: 1.5, weight: 800 })}</g>`,
    bot(c, 90, floorY - 64, 8, { armsUp: true }),
    card(c, 110, floorY - 108, 'note', -3),
  ];
  return frame(c, W, H, body.join('\n'), 'The .remember folder holds notes.jsonl, the one file worth backing up, plus a rebuildable index; git never sees it');
}

// Platforms: the same bot on three screens.
function platforms(c) {
  const W = 880; const H = 230;
  const screen = (x, label) => `<rect x="${x}" y="40" width="200" height="124" rx="8" fill="${c.cabEdge}"/>
  <rect x="${x + 10}" y="50" width="180" height="104" rx="4" fill="${c.bg}"/>
  ${bot(c, x + 76, 84, 4)}
  <circle cx="${x + 168}" cy="70" r="9" fill="${c.good}"/><path d="M${x + 163},70 l4,4 l7,-8" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  ${r(x + 84, 164, 32, 16, c.cabEdge)}${r(x + 60, 180, 80, 6, c.cabEdge, 'rx="3"')}
  ${t(x + 100, 212, label, 14, c.ink)}`;
  const body = [screen(70, 'macOS'), screen(340, 'Linux'), screen(610, 'Windows')];
  return frame(c, W, H, body.join('\n'), 'The bot runs on three screens labelled macOS, Linux and Windows, each with a green check');
}

// Development: tests pass, the bot holds a wrench.
function development(c) {
  const W = 880; const H = 230; const floorY = 200;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 120, floorY - 64, 8),
    wrench(c, 236, floorY - 62, 35),
    terminal(380, 36, 440, [['$ npm test', TERM.dim], ['✔ 163 tests pass', TERM.ok], ['$ claude plugin validate --strict', TERM.dim], ['✔ Validation passed', TERM.ok]]),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot holds a wrench next to a terminal: 163 tests pass and plugin validation passes');
}

// License: the bot holds up the MIT certificate.
function license(c) {
  const W = 880; const H = 210; const floorY = 180;
  const body = [
    r(24, floorY, W - 48, 4, c.floor, 'rx="2"'),
    bot(c, 300, floorY - 64, 8, { armsUp: true }),
    `<rect x="400" y="26" width="240" height="120" rx="6" fill="${c.card}" stroke="${c.cardEdge}" stroke-width="1.5"/>`,
    `<rect x="408" y="34" width="224" height="104" rx="4" fill="none" stroke="${c.spark}" stroke-width="2"/>`,
    t(520, 76, 'MIT', 30, c.cardInk, { weight: 800, spacing: 3 }),
    t(520, 100, 'free to use, change and share', 12, c.cardInk2, { weight: 500 }),
    t(520, 124, '© BartaLazar', 12, c.cardInk2, { weight: 600 }),
    `<circle cx="618" cy="128" r="14" fill="${c.stop}"/>`,
    sparkle(c, 680, 50, 7), sparkle(c, 370, 40, 5),
  ];
  return frame(c, W, H, body.join('\n'), 'The bot holds up an MIT license certificate, copyright BartaLazar');
}

fs.mkdirSync(OUT, { recursive: true });
for (const [mode, c] of Object.entries(THEMES)) {
  fs.writeFileSync(path.join(OUT, `filing-${mode}.svg`), filing(c));
  fs.writeFileSync(path.join(OUT, `finding-${mode}.svg`), finding(c));
  for (const [name, fn] of Object.entries({
    privacy, noting, forgetting, 'big-project': bigProject, waiting, install, remembered, 'how-it-works': howItWorks,
    savings, asking, 'data-folder': dataFolder, platforms, development, license,
  })) {
    fs.writeFileSync(path.join(OUT, `${name}-${mode}.svg`), fn(c));
  }
}
console.log('wrote illustrations to', OUT);

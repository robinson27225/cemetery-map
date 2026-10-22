#!/usr/bin/env node
'use strict';
// Draws Cemetery Map's logo and icon (assets/*.svg and PNGs). It is the companion of the Headstone Photo Tool logo: same
// palette, viewfinder corners, grass bar and pin, with a map of headstones in place of the single stone. The wordmark is
// Source Sans 3 Bold (SIL Open Font License) turned into outlines so it looks the same everywhere.
//   npm i --no-save opentype.js @fontsource/source-sans-3 sharp && node tools/make-logo.cjs
const fs = require('fs');
const path = require('path');
const opentype = require('opentype.js');
const sharp = require('sharp');

const out = path.join(__dirname, '..', 'assets');
const C = { dark: '#234a2b', amber: '#fbb616', green: '#8dc641', pale: '#e8f4d6' };
const fontFile = require.resolve('@fontsource/source-sans-3/files/source-sans-3-latin-700-normal.woff');
const buf = fs.readFileSync(fontFile);
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Text centred on cx with its baseline at y, as one path (letters placed one by one with kerning; plain Latin text).
function word(text, cx, y, size, fill) {
  const scale = size / font.unitsPerEm;
  const glyphs = [...text].map((ch) => font.charToGlyph(ch));
  let x = 0;
  const paths = glyphs.map((g, i) => {
    const p = g.getPath(x, y, size);
    x += g.advanceWidth * scale + (glyphs[i + 1] ? font.getKerningValue(g, glyphs[i + 1]) * scale : 0);
    return p;
  });
  const dx = cx - x / 2;
  return paths.map((p) => { p.commands.forEach((c) => { for (const k of ['x', 'x1', 'x2']) if (k in c) c[k] += dx; }); return `<path fill="${fill}" d="${p.toPathData(2)}"/>`; }).join('');
}

const brackets = (sw) => `<g fill="none" stroke="${C.amber}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M214 196V116a34 34 0 0 1 34-34h96"/><path d="M866 196V116a34 34 0 0 0-34-34h-96"/>
    <path d="M214 604v80a34 34 0 0 0 34 34h96"/><path d="M866 604v80a34 34 0 0 1-34 34h-96"/></g>`;
// a small headstone: rounded top, flat bottom, with a soft shadow on the grass
const stone = (cx, top, w, h, fill) => `<ellipse cx="${cx + 8}" cy="${top + h}" rx="${w * 0.72}" ry="${w * 0.16}" fill="${C.dark}" opacity=".16"/><path fill="${fill}" d="M${cx - w / 2} ${top + h}V${top + w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0V${top + h}z"/>`;
const pin = (stroke, sw) => `<path fill="${C.amber}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" d="M728 128c-50 0-88 38-88 86 0 66 88 150 88 150s88-84 88-150c0-48-38-86-88-86z"/><circle cx="728" cy="214" r="30" fill="${C.dark}"/>`;

// The picture: a map of headstones on a lawn, seen through a viewfinder, with a pin on the one being located
function mark({ bracketW, pinStroke, pinW, big }) {
  const w = big ? 92 : 56, h = big ? 128 : 86;
  const rows = big
    ? [[[410, 185]], [[365, 345], [545, 345]], [[640, 440]]]
    : [[[390, 200], [520, 200]], [[325, 330], [455, 330], [585, 330], [715, 330]], [[390, 460], [520, 460], [650, 460]]];
  const stones = rows.flat().map(([cx, top]) => stone(cx, top, w, h, C.dark)).join('');
  return `${brackets(bracketW)}
  <rect x="300" y="140" width="480" height="500" rx="44" fill="${C.pale}"/>
  <path d="M300 590C390 520 450 575 540 520S700 480 780 440" fill="none" stroke="#c9deaa" stroke-width="${big ? 30 : 26}" stroke-linecap="round"/>
  ${stones}
  <rect x="250" y="620" width="580" height="64" rx="32" fill="${C.green}"/>
  ${pin(pinStroke, pinW)}`;
}

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080" width="1080" height="1080" role="img" aria-label="Cemetery Map">
  <title>Cemetery Map</title>
  <g transform="translate(43 4) scale(.92)">${mark({ bracketW: 34, pinStroke: '#fff', pinW: 10, big: false })}</g>
  ${word('Cemetery', 540, 880, 190, C.dark)}
  ${word('Map', 540, 1040, 190, C.amber)}
</svg>
`;
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="96" height="96" role="img" aria-label="Cemetery Map">
  <rect width="96" height="96" rx="12" fill="${C.dark}"/>
  <g transform="translate(.5 12.8) scale(.088)">${mark({ bracketW: 40, pinStroke: C.dark, pinW: 14, big: true })}</g>
</svg>
`;

fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'logo.svg'), logo);
fs.writeFileSync(path.join(out, 'icon.svg'), icon);
const jobs = [['logo', 'logo-1080', 1080], ['logo', 'logo-500', 500], ['logo', 'logo-500-white', 500, '#ffffff'], ['icon', 'icon-512', 512], ['icon', 'icon-96', 96], ['icon', 'icon-32', 32]];
(async () => {
  for (const [src, name, size, bg] of jobs) {
    let img = sharp(path.join(out, `${src}.svg`), { density: Math.round(72 * size / (src === 'logo' ? 1080 : 96)) }).resize(size, size);
    if (bg) img = img.flatten({ background: bg });
    await img.png().toFile(path.join(out, `${name}.png`));
    console.log(`assets/${name}.png`);
  }
})();

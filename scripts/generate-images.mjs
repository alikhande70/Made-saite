/**
 * Generates the demo product illustrations shipped in public/demo/.
 * These are deliberately schematic technical drawings, not photographs: they are
 * demo assets for a demo catalogue and are not represented as real product
 * photos. Run with `node scripts/generate-images.mjs`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('public/demo', { recursive: true });

const W = 800, H = 800;

const PALETTES = {
  steel:  { body: '#8e99a6', dark: '#5a646f', light: '#c3ccd6', accent: '#2f6fb5' },
  copper: { body: '#b8794a', dark: '#8a5730', light: '#d9a377', accent: '#2f6fb5' },
  black:  { body: '#3b4149', dark: '#252a30', light: '#5c646e', accent: '#d8532a' },
  blue:   { body: '#2f6fb5', dark: '#1f4d80', light: '#5d9adb', accent: '#f0a500' },
  red:    { body: '#c0392b', dark: '#8e2a20', light: '#e05c4d', accent: '#2f6fb5' },
  green:  { body: '#2f7d52', dark: '#1f5738', light: '#57a878', accent: '#f0a500' },
  amber:  { body: '#d99a2b', dark: '#a4711c', light: '#eebc63', accent: '#2f6fb5' },
};

function frame(inner, p) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef1f5"/>
    </linearGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.light}"/><stop offset="0.5" stop-color="${p.body}"/><stop offset="1" stop-color="${p.dark}"/>
    </linearGradient>
    <linearGradient id="metalV" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${p.light}"/><stop offset="0.55" stop-color="${p.body}"/><stop offset="1" stop-color="${p.dark}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.55">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0f172a" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <ellipse cx="400" cy="690" rx="230" ry="34" fill="#0f172a" opacity="0.10"/>
  <g filter="url(#soft)">${inner}</g>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
</svg>`;
}

const shapes = {
  // دیسک ترمز
  brakeDisc: (p) => `
    <circle cx="400" cy="390" r="250" fill="url(#metal)"/>
    <circle cx="400" cy="390" r="250" fill="none" stroke="${p.dark}" stroke-width="6"/>
    ${Array.from({length: 44}, (_, i) => {
      const a = (i / 44) * Math.PI * 2;
      return `<line x1="${400 + Math.cos(a)*150}" y1="${390 + Math.sin(a)*150}" x2="${400 + Math.cos(a)*242}" y2="${390 + Math.sin(a)*242}" stroke="${p.dark}" stroke-width="3" opacity="0.45"/>`;
    }).join('')}
    <circle cx="400" cy="390" r="140" fill="url(#metalV)" stroke="${p.dark}" stroke-width="5"/>
    <circle cx="400" cy="390" r="60" fill="#eef1f5" stroke="${p.dark}" stroke-width="5"/>
    ${Array.from({length: 5}, (_, i) => {
      const a = (i / 5) * Math.PI * 2 - Math.PI/2;
      return `<circle cx="${400 + Math.cos(a)*100}" cy="${390 + Math.sin(a)*100}" r="17" fill="#eef1f5" stroke="${p.dark}" stroke-width="4"/>`;
    }).join('')}`,

  // لنت ترمز (جفت)
  brakePad: (p) => `
    <g transform="translate(150,230) rotate(-6)">
      <rect x="0" y="0" width="300" height="180" rx="18" fill="url(#metal)" stroke="${p.dark}" stroke-width="5"/>
      <rect x="14" y="14" width="272" height="120" rx="12" fill="${p.accent}" opacity="0.88"/>
      <rect x="14" y="14" width="272" height="120" rx="12" fill="none" stroke="${p.dark}" stroke-width="3"/>
      ${Array.from({length:5},(_,i)=>`<rect x="${40+i*52}" y="30" width="30" height="88" rx="6" fill="#ffffff" opacity="0.16"/>`).join('')}
    </g>
    <g transform="translate(330,400) rotate(5)">
      <rect x="0" y="0" width="300" height="180" rx="18" fill="url(#metal)" stroke="${p.dark}" stroke-width="5"/>
      <rect x="14" y="46" width="272" height="120" rx="12" fill="${p.accent}" opacity="0.88"/>
      <rect x="14" y="46" width="272" height="120" rx="12" fill="none" stroke="${p.dark}" stroke-width="3"/>
      ${Array.from({length:5},(_,i)=>`<rect x="${40+i*52}" y="62" width="30" height="88" rx="6" fill="#ffffff" opacity="0.16"/>`).join('')}
    </g>`,

  // فیلتر روغن استوانه‌ای
  oilFilter: (p) => `
    <rect x="270" y="170" width="260" height="400" rx="26" fill="url(#metal)" stroke="${p.dark}" stroke-width="6"/>
    <rect x="270" y="170" width="260" height="60" rx="26" fill="${p.dark}" opacity="0.35"/>
    ${Array.from({length:11},(_,i)=>`<line x1="286" y1="${260+i*26}" x2="514" y2="${260+i*26}" stroke="${p.dark}" stroke-width="3" opacity="0.30"/>`).join('')}
    <rect x="252" y="540" width="296" height="66" rx="16" fill="url(#metalV)" stroke="${p.dark}" stroke-width="6"/>
    <circle cx="400" cy="573" r="34" fill="#eef1f5" stroke="${p.dark}" stroke-width="5"/>
    ${Array.from({length:8},(_,i)=>{const a=(i/8)*Math.PI*2;return `<circle cx="${400+Math.cos(a)*54}" cy="${573+Math.sin(a)*54}" r="9" fill="${p.dark}" opacity="0.6"/>`}).join('')}
    <rect x="300" y="250" width="200" height="150" rx="10" fill="#ffffff" opacity="0.14"/>`,

  // فیلتر هوا (پانلی آکاردئونی)
  airFilter: (p) => `
    <rect x="130" y="250" width="540" height="300" rx="26" fill="${p.dark}"/>
    <rect x="152" y="272" width="496" height="256" rx="16" fill="#f5f7fa"/>
    ${Array.from({length:22},(_,i)=>`<path d="M ${168+i*22} 280 L ${179+i*22} 400 L ${168+i*22} 520" fill="none" stroke="${p.body}" stroke-width="9" stroke-linejoin="round"/>`).join('')}
    <rect x="130" y="250" width="540" height="300" rx="26" fill="none" stroke="${p.dark}" stroke-width="8"/>
    <rect x="130" y="250" width="540" height="34" rx="17" fill="#ffffff" opacity="0.18"/>`,

  // شمع خودرو
  sparkPlug: (p) => `
    <g transform="translate(400,80)">
      <rect x="-52" y="0" width="104" height="230" rx="22" fill="#f0f2f5" stroke="${p.dark}" stroke-width="6"/>
      ${Array.from({length:4},(_,i)=>`<ellipse cx="0" cy="${44+i*46}" rx="60" ry="18" fill="#e4e8ee" stroke="${p.dark}" stroke-width="4"/>`).join('')}
      <rect x="-62" y="230" width="124" height="96" rx="8" fill="url(#metal)" stroke="${p.dark}" stroke-width="5"/>
      <path d="M -62 244 L 62 262 M -62 276 L 62 294 M -62 308 L 62 326" stroke="${p.dark}" stroke-width="4" opacity="0.5"/>
      <rect x="-40" y="326" width="80" height="150" fill="url(#metalV)" stroke="${p.dark}" stroke-width="5"/>
      ${Array.from({length:8},(_,i)=>`<line x1="-40" y1="${340+i*17}" x2="40" y2="${346+i*17}" stroke="${p.dark}" stroke-width="3" opacity="0.55"/>`).join('')}
      <rect x="-14" y="476" width="28" height="60" fill="#e8ecf1" stroke="${p.dark}" stroke-width="4"/>
      <path d="M -34 500 L -34 546 L -4 546" fill="none" stroke="${p.dark}" stroke-width="9" stroke-linecap="round"/>
      <circle cx="0" cy="546" r="7" fill="${p.accent}"/>
    </g>`,

  // باتری خودرو
  battery: (p) => `
    <rect x="140" y="250" width="520" height="300" rx="20" fill="url(#metalV)" stroke="${p.dark}" stroke-width="7"/>
    <rect x="140" y="250" width="520" height="72" rx="18" fill="${p.dark}"/>
    <rect x="176" y="196" width="70" height="60" rx="10" fill="#b0b8c2" stroke="${p.dark}" stroke-width="6"/>
    <rect x="556" y="196" width="70" height="60" rx="10" fill="#8d97a3" stroke="${p.dark}" stroke-width="6"/>
    <text x="211" y="186" font-size="46" font-family="system-ui,sans-serif" text-anchor="middle" fill="${p.dark}">+</text>
    <text x="591" y="186" font-size="52" font-family="system-ui,sans-serif" text-anchor="middle" fill="${p.dark}">−</text>
    ${Array.from({length:6},(_,i)=>`<circle cx="${210+i*76}" cy="286" r="17" fill="#eef1f5" stroke="${p.dark}" stroke-width="4"/>`).join('')}
    <rect x="196" y="368" width="408" height="130" rx="12" fill="#ffffff" opacity="0.22"/>
    <rect x="196" y="368" width="408" height="130" rx="12" fill="none" stroke="#ffffff" stroke-width="4" opacity="0.5"/>`,

  // تسمه تایم دندانه‌دار
  timingBelt: (p) => `
    <g transform="translate(400,390)">
      <ellipse rx="255" ry="185" fill="none" stroke="${p.dark}" stroke-width="66"/>
      <ellipse rx="255" ry="185" fill="none" stroke="${p.body}" stroke-width="52"/>
      ${Array.from({length:52},(_,i)=>{const a=(i/52)*Math.PI*2;const x=Math.cos(a)*235,y=Math.sin(a)*167;
        return `<circle cx="${x}" cy="${y}" r="9" fill="${p.dark}" opacity="0.75"/>`}).join('')}
      <ellipse rx="215" ry="150" fill="#eef1f5"/>
      <ellipse rx="215" ry="150" fill="none" stroke="${p.dark}" stroke-width="4" opacity="0.4"/>
    </g>`,

  // کمک فنر
  shockAbsorber: (p) => `
    <g transform="translate(400,100)">
      <circle cx="0" cy="26" r="32" fill="none" stroke="${p.dark}" stroke-width="16"/>
      <rect x="-16" y="52" width="32" height="150" fill="url(#metalV)" stroke="${p.dark}" stroke-width="4"/>
      ${Array.from({length:9},(_,i)=>`<path d="M -74 ${210+i*38} Q 0 ${196+i*38} 74 ${210+i*38} Q 0 ${232+i*38} -74 ${248+i*38}" fill="none" stroke="${p.accent}" stroke-width="17" stroke-linecap="round" opacity="0.95"/>`).join('')}
      <rect x="-44" y="330" width="88" height="230" rx="14" fill="url(#metal)" stroke="${p.dark}" stroke-width="5"/>
      <rect x="-26" y="560" width="52" height="66" rx="8" fill="${p.dark}"/>
      <circle cx="0" cy="640" r="30" fill="none" stroke="${p.dark}" stroke-width="16"/>
    </g>`,

  // بطری روغن موتور
  oilBottle: (p) => `
    <rect x="255" y="230" width="290" height="380" rx="30" fill="url(#metalV)" stroke="${p.dark}" stroke-width="6"/>
    <rect x="348" y="130" width="104" height="110" rx="12" fill="${p.dark}"/>
    <rect x="336" y="112" width="128" height="44" rx="12" fill="${p.light}" stroke="${p.dark}" stroke-width="5"/>
    <rect x="286" y="316" width="228" height="210" rx="14" fill="#f7f9fb" stroke="${p.dark}" stroke-width="4"/>
    <rect x="286" y="316" width="228" height="56" rx="14" fill="${p.accent}" opacity="0.9"/>
    ${Array.from({length:4},(_,i)=>`<rect x="308" y="${394+i*30}" width="${184-i*26}" height="12" rx="6" fill="${p.dark}" opacity="0.25"/>`).join('')}
    <rect x="286" y="240" width="120" height="60" rx="10" fill="#ffffff" opacity="0.22"/>`,

  // چراغ جلو
  headlight: (p) => `
    <path d="M 130 300 Q 150 210 260 200 L 610 220 Q 680 240 676 330 L 668 470 Q 660 550 570 558 L 230 570 Q 150 566 138 486 Z"
      fill="url(#metal)" stroke="${p.dark}" stroke-width="7"/>
    <path d="M 168 312 Q 186 246 268 240 L 596 258 Q 646 274 642 336 L 636 458 Q 630 518 560 524 L 246 534 Q 186 530 176 476 Z"
      fill="#dfe7f0" stroke="${p.dark}" stroke-width="4"/>
    <circle cx="300" cy="384" r="88" fill="#f7fafd" stroke="${p.dark}" stroke-width="5"/>
    <circle cx="300" cy="384" r="46" fill="${p.accent}" opacity="0.30"/>
    <circle cx="300" cy="384" r="20" fill="#ffffff"/>
    <circle cx="520" cy="392" r="62" fill="#f7fafd" stroke="${p.dark}" stroke-width="5"/>
    <circle cx="520" cy="392" r="26" fill="${p.accent}" opacity="0.28"/>
    ${Array.from({length:9},(_,i)=>`<circle cx="${396+i*10}" cy="${478+Math.sin(i)*6}" r="7" fill="#ffffff" opacity="0.7"/>`).join('')}`,

  // سرسیلندر / قطعه موتور
  engineBlock: (p) => `
    <rect x="170" y="250" width="460" height="300" rx="18" fill="url(#metalV)" stroke="${p.dark}" stroke-width="7"/>
    ${Array.from({length:4},(_,i)=>`
      <circle cx="${252+i*100}" cy="336" r="42" fill="#e6ebf1" stroke="${p.dark}" stroke-width="5"/>
      <circle cx="${252+i*100}" cy="336" r="24" fill="${p.dark}" opacity="0.35"/>`).join('')}
    ${Array.from({length:10},(_,i)=>`<circle cx="${196+i*46}" cy="524" r="10" fill="${p.dark}" opacity="0.5"/>`).join('')}
    ${Array.from({length:10},(_,i)=>`<circle cx="${196+i*46}" cy="276" r="10" fill="${p.dark}" opacity="0.5"/>`).join('')}
    <rect x="200" y="400" width="400" height="90" rx="10" fill="#ffffff" opacity="0.15"/>
    <rect x="150" y="230" width="500" height="30" rx="10" fill="${p.dark}" opacity="0.25"/>`,

  // سیبک / جلوبندی
  balljoint: (p) => `
    <g transform="translate(400,390)">
      <circle cx="-90" cy="-40" r="96" fill="url(#metal)" stroke="${p.dark}" stroke-width="6"/>
      <circle cx="-90" cy="-40" r="52" fill="${p.dark}" opacity="0.35"/>
      <path d="M -60 20 L 60 130 L 130 90 L 20 -20 Z" fill="url(#metalV)" stroke="${p.dark}" stroke-width="6"/>
      <path d="M 90 60 Q 150 90 176 160 L 130 186 Q 108 120 60 106 Z" fill="${p.black ?? p.dark}" opacity="0.85"/>
      <circle cx="150" cy="170" r="56" fill="url(#metal)" stroke="${p.dark}" stroke-width="6"/>
      <circle cx="150" cy="170" r="26" fill="#eef1f5" stroke="${p.dark}" stroke-width="4"/>
      <ellipse cx="-90" cy="-40" rx="40" ry="18" fill="#ffffff" opacity="0.20"/>
    </g>`,

  // واشر / قطعه بدنه
  bodyPanel: (p) => `
    <path d="M 140 470 Q 150 250 400 214 Q 650 250 660 470 L 640 566 Q 400 604 160 566 Z"
      fill="url(#metalV)" stroke="${p.dark}" stroke-width="7"/>
    <path d="M 190 460 Q 200 300 400 272 Q 600 300 610 460" fill="none" stroke="${p.dark}" stroke-width="4" opacity="0.4"/>
    <rect x="300" y="486" width="200" height="52" rx="12" fill="#e6ebf1" stroke="${p.dark}" stroke-width="5"/>
    <circle cx="220" cy="516" r="18" fill="${p.dark}" opacity="0.4"/>
    <circle cx="580" cy="516" r="18" fill="${p.dark}" opacity="0.4"/>
    <path d="M 240 300 Q 400 268 560 300" fill="none" stroke="#ffffff" stroke-width="10" opacity="0.30"/>`,

  // دینام / برق خودرو
  alternator: (p) => `
    <g transform="translate(400,390)">
      <rect x="-190" y="-120" width="330" height="240" rx="34" fill="url(#metalV)" stroke="${p.dark}" stroke-width="7"/>
      ${Array.from({length:12},(_,i)=>`<line x1="${-170+i*26}" y1="-108" x2="${-170+i*26}" y2="108" stroke="${p.dark}" stroke-width="5" opacity="0.35"/>`).join('')}
      <circle cx="-190" cy="0" r="92" fill="url(#metal)" stroke="${p.dark}" stroke-width="6"/>
      <circle cx="-190" cy="0" r="52" fill="#e6ebf1" stroke="${p.dark}" stroke-width="4"/>
      <rect x="140" y="-70" width="70" height="140" rx="14" fill="url(#metal)" stroke="${p.dark}" stroke-width="6"/>
      <circle cx="228" cy="0" r="62" fill="${p.dark}"/>
      <circle cx="228" cy="0" r="40" fill="${p.body}"/>
      ${Array.from({length:6},(_,i)=>`<line x1="${228}" y1="${-56}" x2="228" y2="-40" stroke="#eef1f5" stroke-width="6" transform="rotate(${i*60} 228 0)"/>`).join('')}
    </g>`,
};

const CATALOG = [
  ['brake-disc', 'brakeDisc', 'steel'],
  ['brake-pad', 'brakePad', 'black'],
  ['oil-filter', 'oilFilter', 'blue'],
  ['air-filter', 'airFilter', 'green'],
  ['cabin-filter', 'airFilter', 'amber'],
  ['fuel-filter', 'oilFilter', 'red'],
  ['spark-plug', 'sparkPlug', 'copper'],
  ['battery', 'battery', 'black'],
  ['timing-belt', 'timingBelt', 'black'],
  ['v-belt', 'timingBelt', 'steel'],
  ['shock-absorber', 'shockAbsorber', 'red'],
  ['ball-joint', 'balljoint', 'steel'],
  ['engine-part', 'engineBlock', 'steel'],
  ['motor-oil', 'oilBottle', 'blue'],
  ['gear-oil', 'oilBottle', 'amber'],
  ['headlight', 'headlight', 'steel'],
  ['body-panel', 'bodyPanel', 'steel'],
  ['alternator', 'alternator', 'steel'],
];

for (const [name, shape, palette] of CATALOG) {
  const p = PALETTES[palette];
  writeFileSync(`public/demo/${name}.svg`, frame(shapes[shape](p), p));
}

// Category tiles: compact square icons on a tinted ground.
const TILES = [
  ['cat-filters', 'airFilter', 'green'],
  ['cat-brakes', 'brakeDisc', 'steel'],
  ['cat-engine', 'engineBlock', 'steel'],
  ['cat-suspension', 'shockAbsorber', 'red'],
  ['cat-electrical', 'alternator', 'blue'],
  ['cat-body', 'bodyPanel', 'steel'],
  ['cat-oil', 'oilBottle', 'blue'],
  ['cat-belts', 'timingBelt', 'black'],
  ['cat-plugs', 'sparkPlug', 'copper'],
  ['cat-battery', 'battery', 'black'],
];
for (const [name, shape, palette] of TILES) {
  const p = PALETTES[palette];
  writeFileSync(`public/demo/${name}.svg`, frame(shapes[shape](p), p));
}

console.log(`✔ generated ${CATALOG.length + TILES.length} demo illustrations in public/demo/`);

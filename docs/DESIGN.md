# Design direction

Industrial · premium · technical · automotive. The catalogue is the content;
the chrome exists to make part numbers, prices, stock and compatibility easy to
read on a phone in a workshop.

## Palette

Two ramps, no third accent.

| Token | Role |
| ----- | ---- |
| `steel-50…300` | surfaces, hairlines, disabled states |
| `steel-400…600` | secondary text, icons |
| `steel-700…950` | deep navy → carbon → charcoal: header, footer, hero, primary buttons |
| `accent-50…300` | tinted surfaces only — never text, never a button face |
| `accent-600…950` | calls to action, price emphasis, the active vehicle, the «سازگار» verdict |

Cyan is rationed on purpose. It marks *the next action* and *the compatibility
answer*; everywhere else the interface is navy and neutral, so the accent keeps
meaning something. There is no purple, no gradient used as decoration, and no
ambient animation.

### Contrast

Checked with the WCAG relative-luminance formula, not by eye:

| Pair | Ratio | Requirement |
| ---- | ----- | ----------- |
| white on `accent-600` (primary CTA) | 4.77 : 1 | AA normal text (4.5) |
| `accent-700` on white (links, prices) | 6.61 : 1 | AA normal text |
| white on `steel-800` (header, primary button) | 14.88 : 1 | AAA |
| `ink` on `canvas` (body copy) | 16.6 : 1 | AAA |
| `muted` on white (secondary copy) | 6.15 : 1 | AA normal text |
| verdict chips (all four) | 6.9–9.6 : 1 | AA normal text |

`accent-500` and lighter fail AA against white and are therefore surface-only
tokens. The `accent` button's disabled state uses `steel-300` rather than a pale
cyan, so it reads as inert rather than as a low-contrast live control.

## Glass, used selectively

Frosted surfaces appear on exactly four kinds of surface: the hero, the vehicle
selector's context, the search overlay, and promotional panels. They are
implemented only through the `.glass-dark` / `.glass-light` utilities in
`globals.css`, which makes the rule enforceable with `grep` rather than by
memory.

Everything a purchase depends on — price, stock badge, cart lines, checkout
fields, admin tables — sits on an opaque surface. Two reasons: `backdrop-filter`
costs a compositor layer on every scroll frame, and translucency lowers text
contrast exactly where a misread costs money. An `@supports` guard keeps the
fallback opaque rather than translucent-without-blur, which would be unreadable.

The hero's `.carbon-field` is a static measured grid over charcoal — texture,
not animation. The mobile drawer's `.scrim` blurs the *background* while the
drawer panel itself stays opaque white — blur on the dimmed surround separates
the drawer from the page; blur under the content would hurt it.

**One deliberate deviation from the brief.** The search-suggestions dropdown was
listed as a frosted surface and is not one. It carries the part names and
numbers a shopper is about to click, over whatever page they were on — an
overlay that inherits texture from a product grid behind it. Legibility of a
result the customer is choosing outranks the effect, so the dropdown is opaque
with a `shadow-pop` lift. The rule in this file is the one being followed:
commerce-critical UI stays opaque.

## Persian and RTL

The document is `lang="fa" dir="rtl"`; RTL is the design, not an override.

- Logical CSS properties throughout (`margin-inline`, `padding-inline`,
  `border-block-start`, `text-align: start`) so nothing needs a mirrored
  stylesheet.
- Directional glyphs carry `.flip-rtl`; one icon set, mirrored by CSS.
- Line height is 1.75 for body copy and 1.45 for headings — Persian needs more
  leading than Latin at the same size.
- `font-feature-settings: 'ss01'` renders browser-generated numerals in Persian.

### Technical identifiers stay LTR

SKUs, OEM numbers, MPNs, engine codes, postal codes, tracking codes and phone
numbers are Latin strings inside Persian sentences. `.latin-id` applies
`direction: ltr; unicode-bidi: isolate` so their characters keep their order and
do not drag surrounding Persian punctuation around, plus
`[dir='rtl'] .latin-id { text-align: right }` so a block-level identifier stays
attached to the reading-start edge.

**Their digits are never localised.** `TU5` is not `TU۵`. Persian digits are for
quantities, prices and dates the customer reads; a part number is an identifier
whose characters must survive round-tripping to a supplier.

## Verdict chips

Colour is never the only cue. Each of the four compatibility outcomes carries a
glyph *and* a word:

| | | |
| - | - | - |
| ✓ | سازگار | `verdict-yes` |
| ! | سازگار با تغییر | `verdict-maybe` |
| ✕ | ناسازگار | `verdict-no` |
| ؟ | اطلاعات کافی نیست | `verdict-unknown` |

The fourth is styled quietly but is always rendered — an unbadged product card
must never be readable as an implicit "fits".

## Responsive

Mobile-first, verified at 360 / 390 / 430 / 768 / 1024 / 1440 px. Nothing may
cause a horizontal scrollbar: wide tables and rails scroll inside their own
`.scroll-x` container, and `body { overflow-x: hidden }` is a backstop, not the
mechanism. Touch targets are ≥ 44 px on primary actions.

## What is deliberately absent

No customer reviews, ratings, "N people bought this", countdown timers, or fake
scarcity. The store has no review data, and inventing social proof would be both
dishonest and a structured-data policy violation. `Product` JSON-LD therefore
carries no `aggregateRating` or `review` — a gap that is a feature.

/**
 * Invariants of the motion system.
 *
 * These assert *policy*, not appearance: that motion is tokenised rather than
 * sprinkled, that nothing animates a property which forces layout, and that a
 * reduced-motion user still receives every piece of meaning. Animation timing
 * is deliberately not asserted frame-by-frame — that would be brittle and
 * would test the browser rather than the design.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/app/globals.css', 'utf-8');

/** The `@keyframes` bodies, which is where animated properties actually live. */
function keyframeBlocks(): string[] {
  return [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n  \}/g)].map((m) => m[1]!);
}

describe('motion tokens', () => {
  it('defines the four duration tiers and three easings', () => {
    for (const token of ['--motion-instant', '--motion-fast', '--motion-normal', '--motion-panel']) {
      expect(css, `${token} must be defined`).toContain(`${token}:`);
    }
    for (const token of ['--ease-standard', '--ease-entrance', '--ease-exit']) {
      expect(css, `${token} must be defined`).toContain(`${token}:`);
    }
  });

  it('keeps every duration at or under 320ms', () => {
    const durations = [...css.matchAll(/--motion-[\w-]+:\s*(\d+)ms/g)].map((m) => Number(m[1]));
    expect(durations.length).toBeGreaterThanOrEqual(4);
    // Past roughly a third of a second an interface stops feeling responsive,
    // and all of this sits in front of someone trying to buy a part.
    for (const ms of durations) expect(ms).toBeLessThanOrEqual(320);
  });
});

describe('motion never causes layout jank', () => {
  it('animates only transform and opacity', () => {
    // Animating width/height/top/margin forces layout on every frame, which is
    // how a flourish becomes a CLS regression.
    const forbidden = /^\s*(width|height|top|left|right|bottom|margin|padding)\s*:/m;
    for (const block of keyframeBlocks()) {
      expect(forbidden.test(block), `keyframe animates a layout property:\n${block}`).toBe(false);
    }
  });

  it('does not animate a property on the card hover lift that reflows the grid', () => {
    const lift = /\.lift\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(lift).toContain('box-shadow');
    expect(lift).toContain('transform');
    expect(lift).not.toMatch(/(^|\s)(width|height|margin)\s*:/);
  });
});

describe('reduced motion keeps meaning', () => {
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';

  it('neutralises animation and transition durations', () => {
    expect(block).toContain('animation-duration: 0.01ms !important');
    expect(block).toContain('transition-duration: 0.01ms !important');
  });

  it('keeps the spinner turning, because a frozen spinner claims a hang', () => {
    expect(block).toContain('.spinner');
    expect(block).toMatch(/animation-iteration-count:\s*infinite/);
  });

  it('resolves entrance animations to their final visible state', () => {
    // Not merely "no animation": an element left at opacity 0 would vanish.
    expect(block).toMatch(/opacity:\s*1\s*!important/);
    expect(block).toMatch(/transform:\s*none\s*!important/);
  });
});

describe('motion is centralised, not scattered', () => {
  it('declares keyframes only in the stylesheet', () => {
    // Components use the .motion-* utilities so "is this motion justified?" is
    // answered once, here, rather than per component.
    const componentKeyframes = readFileSync('src/components/ui/index.tsx', 'utf-8');
    expect(componentKeyframes).not.toContain('@keyframes');
  });

  it('provides the primitives components are expected to use', () => {
    for (const utility of ['.motion-rise', '.motion-pop', '.motion-reveal', '.motion-fade', '.spinner', '.press', '.lift']) {
      expect(css, `${utility} must exist`).toContain(utility);
    }
  });
});

describe('font loading cannot reintroduce a layout shift', () => {
  it('declares every Vazirmatn face with font-display: optional', () => {
    const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((m) => m[1]!);
    expect(faces.length, 'the Vazirmatn faces must be declared locally').toBeGreaterThanOrEqual(3);
    for (const face of faces) {
      // `swap` paints the fallback and then reflows when the real font lands.
      // On the hero heading that measured CLS 0.2152 on a cold cache.
      expect(face, `a face still uses a reflowing font-display:\n${face}`).toContain('font-display: optional');
      expect(face).not.toContain('font-display: swap');
    }
  });

  it('serves the faces from a stable public path, not from node_modules', () => {
    // Scoped to the `src:` declarations — the file also names the node_modules
    // path in a comment explaining how to refresh the copies.
    const sources = [...css.matchAll(/src:\s*url\((['"]?)([^'")]+)\1\)/g)].map((m) => m[2]!);
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const url of sources) {
      expect(url, `font src must be a public path: ${url}`).toMatch(/^\/fonts\//);
    }
  });

  it('preloads the Arabic face, which decides whether optional wins its race', () => {
    const layout = readFileSync('src/app/layout.tsx', 'utf-8');
    expect(layout).toContain('rel="preload"');
    expect(layout).toContain('vazirmatn-arabic-wght-normal.woff2');
    expect(layout).toContain('as="font"');
    // A cross-origin-less font preload is fetched twice.
    expect(layout).toContain('crossOrigin="anonymous"');
  });
});

/**
 * WCAG 2.1 AA automated pass.
 *
 * The suite runs axe-core against every customer-facing surface, then checks
 * the three things axe cannot: that focus is always visibly indicated, that
 * nothing traps the keyboard, and that the page reflows at 320 CSS pixels and
 * at 200% zoom without a horizontal scrollbar.
 *
 * **What this does not prove.** Automated tooling catches roughly a third of
 * WCAG failures. It cannot judge whether alternative text is *meaningful*,
 * whether a reading order makes sense, or whether a screen-reader
 * announcement is comprehensible in Persian. A clean run here is a floor, not
 * a certification — see docs/COMPLIANCE_MATRIX.md, which records the manual
 * screen-reader pass as not performed.
 *
 * axe is injected from `axe-core` directly rather than through a wrapper, so
 * this adds no runtime and no build-time dependency beyond the audit engine.
 * It was already in the tree transitively; it is now pinned explicitly, so a
 * future lint-plugin bump cannot remove it and break this suite obscurely.
 */
import axe from 'axe-core';
import { expect, test, type Page } from '@playwright/test';
import { clientIpHeaders } from './helpers';

test.use({ extraHTTPHeaders: clientIpHeaders('a11y') });

/** axe ships its own bundle as a string, for injection into a page exactly like this. */
const AXE_SOURCE = axe.source;

/** WCAG 2.1 A and AA — the bar docs/WEBSITE_STANDARD.md commits to. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PAGES: [string, string][] = [
  ['/', 'صفحهٔ اصلی'],
  ['/products', 'فهرست کالاها'],
  ['/search?q=فیلتر', 'نتایج جست‌وجو'],
  ['/vehicles', 'انتخاب خودرو'],
  ['/cart', 'سبد خرید'],
  ['/checkout', 'تسویه‌حساب'],
  ['/login', 'ورود'],
  ['/register', 'ثبت‌نام'],
  ['/orders/track', 'پیگیری سفارش'],
  ['/faq', 'پرسش‌های پرتکرار'],
];

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { html: string }[];
}

async function violations(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async (tags) => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: 'tag', values: tags } });
    return result.violations.map((v) => ({
      id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.slice(0, 3).map((n) => ({ html: n.html.slice(0, 160) })),
    }));
  }, TAGS);
}

/** Renders a failure an author can act on without opening a browser. */
function describe(found: AxeViolation[]): string {
  return found
    .map((v) => `[${v.impact}] ${v.id} — ${v.help}\n` + v.nodes.map((n) => `    ${n.html}`).join('\n'))
    .join('\n');
}

for (const [path, label] of PAGES) {
  test(`${label} has no WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path);
    const found = await violations(page);
    expect(found, describe(found)).toEqual([]);
  });
}

test('a missing product page is accessible too', async ({ page }) => {
  // The 404 is a real rendered page, and is reached more often than most of
  // the routes above — a stale link or a delisted part lands here.
  const response = await page.goto('/products/no-such-product-slug');
  expect(response?.status()).toBe(404);
  const found = await violations(page);
  expect(found, describe(found)).toEqual([]);
});

/*
 * WCAG 1.4.10 Reflow: content must be usable at 320 CSS px with no horizontal
 * scrolling. 320 is the narrowest viewport the guideline names, and it is also
 * where an RTL grid is most likely to push a fixed-width element out of frame.
 */
test('every page reflows at 320px without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, label] of PAGES) {
    await page.goto(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${label} (${path}) overflows horizontally at 320px`).toBeLessThanOrEqual(clientWidth + 1);
  }
});

/*
 * WCAG 1.4.4 Resize text: 200% zoom on a 1280px window is equivalent to a
 * 640px viewport, and must not introduce a horizontal scrollbar either.
 */
test('every page survives 200% zoom', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 450 });
  for (const [path, label] of PAGES) {
    await page.goto(path);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `${label} (${path}) overflows horizontally at 200% zoom`).toBeLessThanOrEqual(clientWidth + 1);
  }
});

test('the skip link is the first thing a keyboard reaches', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const first = await page.evaluate(() => {
    const el = document.activeElement as HTMLAnchorElement | null;
    return el ? { tag: el.tagName, href: el.getAttribute('href'), text: (el.textContent ?? '').trim() } : null;
  });
  expect(first).toMatchObject({ tag: 'A', href: '#main' });
  expect(first?.text).toContain('پرش به محتوای اصلی');
});

/*
 * WCAG 2.4.7 Focus Visible and 2.1.2 No Keyboard Trap.
 *
 * A keyboard user who cannot see where they are is stranded on a page that
 * looks fine to everyone else, so this walks the real tab order and asserts an
 * indicator is painted at every stop.
 */
test('focus is always visible and never trapped', async ({ page }) => {
  for (const path of ['/', '/products', '/cart', '/login', '/checkout']) {
    await page.goto(path);
    const stops: string[] = [];
    const unindicated: string[] = [];

    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          key: `${el.tagName}.${(el.className || '').toString().slice(0, 40)}`,
          onScreen: rect.width > 0 && rect.height > 0,
          // Any painted affordance counts — an outline or a ring shadow. The
          // requirement is that focus is perceivable, not that it uses one
          // particular property.
          indicated:
            (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
            (style.boxShadow !== '' && style.boxShadow !== 'none'),
        };
      });
      if (!info) break;
      if (info.onScreen && !info.indicated) unindicated.push(info.key);
      stops.push(info.key);
    }

    expect(stops.length, `${path} has no keyboard-reachable elements`).toBeGreaterThan(0);
    expect(unindicated, `${path} focuses elements with no visible indicator`).toEqual([]);
    // A trap is 40 presses that never move off one element.
    expect(new Set(stops).size, `${path} traps keyboard focus`).toBeGreaterThan(1);
  }
});

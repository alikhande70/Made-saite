# Motion & microinteraction system

Identity: **technical · premium · automotive · fast · controlled.**

Made-saite is a tool people use to buy the correct part. Motion here exists to
answer a question the customer is already asking, and for no other reason. A
parts shop that animates for its own sake reads as a template, and a template
does not get trusted with a ۴٬۵۰۰٬۰۰۰ تومان order.

---

## 1. The admission test

Every microinteraction must answer at least one of:

1. What happened?
2. Is the system working?
3. What changed?
4. What should I do next?
5. Did my action succeed or fail?

If it answers none, it does not ship. This is applied below as an explicit
**Answers** column, and the rejected list in §7 is the same test failing.

---

## 2. Tokens

Defined once in `src/app/globals.css` under `@theme`. Components never write
raw durations.

| Token | Value | Used for |
| ----- | ----- | -------- |
| `--motion-instant` | `80ms` | a control acknowledging a press — must feel like the pointer, not a response to it |
| `--motion-fast` | `140ms` | a state swap the eye follows but never waits for: colour, hover lift |
| `--motion-normal` | `220ms` | something arriving or leaving: toast, verdict, inline result |
| `--motion-panel` | `320ms` | a large surface travelling: drawer, filter sheet |

| Easing | Curve | Rationale |
| ------ | ----- | --------- |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0.2, 1)` | symmetric state swaps |
| `--ease-entrance` | `cubic-bezier(0.05, 0.7, 0.1, 1)` | arrivals decelerate into place |
| `--ease-exit` | `cubic-bezier(0.3, 0, 0.8, 0.15)` | departures accelerate away |

**Nothing exceeds 320ms.** Past roughly a third of a second an interface stops
feeling responsive and starts feeling slow, and every one of these sits in
front of somebody trying to buy a brake pad. `tests/unit/motion-system.test.ts`
asserts the ceiling.

### Primitives

| Class | Motion | Where |
| ----- | ------ | ----- |
| `.motion-rise` | fade + 6px rise | toast, inline result, cascade fields |
| `.motion-pop` | 0.86 → 1.06 → 1 scale | acknowledgement: item added, count changed |
| `.motion-reveal` | fade + settle | **compatibility verdict only** |
| `.motion-fade` | opacity | suggestion panel |
| `.motion-panel` | slide from reading-start edge | drawer, filter sheet |
| `.spinner` | 0.7s rotation | indeterminate work |
| `.press` | `scale(0.97)` on `:active` | every button |
| `.lift` | `translateY(-2px)` + shadow | product and garage cards |

Components use these; they do not declare keyframes. "Is this motion
justified?" is therefore answered once, here, rather than per component — and
a test asserts `src/components/ui/index.tsx` contains no `@keyframes`.

---

## 3. Performance rules

- **Only `transform` and `opacity` are animated.** These are the two properties
  the compositor handles without layout or paint. A test parses every
  `@keyframes` body and fails if it touches `width`, `height`, `top`, `left`,
  `margin` or `padding` — that is how a flourish becomes a CLS regression.
- **Motion never gates a commerce action.** Add-to-cart and checkout fire their
  request immediately; the animation runs alongside the network, never in front
  of it.
- **Hover lift is pointer-only.** `@media (hover: none)` disables it, because on
  touch a hover state fires on tap and then sticks.
- **No ambient animation.** Nothing animates without a user action, so the
  compositor is idle while reading.

Measured impact: **CLS remained 0.0000** on every page after this work
(docs/PERFORMANCE.md).

---

## 4. Accessibility rules

- `prefers-reduced-motion: reduce` removes movement and **keeps meaning**.
  Every animated element also carries a word, a glyph, a colour and — where it
  is a status — an `aria-live` announcement. Entrances resolve to their final
  visible state rather than being disabled at `opacity: 0`.
- **The spinner keeps turning under reduced motion**, slowed to 1.6s. A frozen
  spinner claims the system has hung, which is a worse lie than the movement.
- Colour is never the only carrier (WCAG 1.4.1). The four compatibility
  outcomes each pair a colour with a glyph *and* a Persian word.
- Status messages use `role="status"`/`aria-live="polite"`; failures use
  `role="alert"`. Focus is never stolen (WCAG 4.1.3).
- Motion is never required to understand **errors, compatibility, stock,
  payment state or order state**. All five are rendered as text in the page.

---

## 5. Interaction inventory

**Answers** references §1.

| Surface | State | Treatment | Answers |
| ------- | ----- | --------- | ------- |
| Button | hover | colour, `--motion-fast` | 4 |
| Button | focus | 2px accent ring, no animation | 4 |
| Button | pressed | `.press` scale at `--motion-instant`, on pointer-down | 2 |
| Button | loading | spinner + `aria-busy` + disabled | 2 |
| Button | disabled | `steel-300`, cursor, no motion | 4 |
| Add to cart | success | `.motion-pop` on the label + named toast | 1, 3, 5 |
| Add to cart | stock conflict | inline `role="alert"` **and** toast | 1, 5 |
| Add to cart | in flight | button loading, second click impossible | 2 |
| Cart count | update | header badge re-renders from server state | 3 |
| Cart line | quantity / remove | control disabled while in flight | 2, 5 |
| Search | typing | debounced 220ms | — |
| Search | loading | spinner + «در حال جست‌وجو…» | 2 |
| Search | no results | named query + what to try next | 1, 4 |
| Search | exact SKU/OEM | «کد دقیق» badge | 3 |
| Search | keyboard | arrow/enter selection, `aria-activedescendant` | 4 |
| Vehicle cascade | narrowing loads | spinner + «در حال خواندن تیپ‌ها…» | 2 |
| Vehicle cascade | fields appear | `.motion-rise` | 3 |
| **Compatibility** | verdict | `.motion-reveal`, **keyed on the verdict** | 1, 3, 5 |
| Product card | hover | `.lift` | 4 |
| Filters / drawer | open | `.motion-panel` + blurred scrim | 3 |
| Checkout | submitting | loading button + «صفحه را نبندید» | 2, 4 |
| Toast | success / warning / error | rise in; errors persist until dismissed | 1, 5 |

**The compatibility verdict is the one place motion carries meaning rather than
polish.** Its `key` is the verdict itself, so changing vehicle re-runs the
reveal: the answer reads as a *new* answer rather than a panel that quietly
rewrote itself. Under reduced motion the words, glyph and announcement are
identical.

---

## 6. Loading vocabulary

| Situation | Treatment | Why |
| --------- | --------- | --- |
| Route-level catalogue load | skeleton | shape is known, so reserve it and avoid a shift |
| Action in flight (cart, checkout, save) | spinner in the control | the wait belongs to the control that started it |
| Suggestion fetch | spinner + text in the panel | an empty panel is indistinguishable from a broken one |
| Anything with unknown duration | **indeterminate only** | see below |

**No fake progress percentages.** The server reports no progress for a checkout
or an add-to-cart, so any percentage would be invented — and a bar that stalls
at 90% is worse than an honest spinner.

---

## 7. Deliberately rejected

| Rejected | Why |
| -------- | --- |
| Parallax | answers nothing; costs scroll frames |
| Ambient / looping background animation | answers nothing; keeps the compositor busy while reading |
| Fake progress bars | invents information the server never sent |
| Bouncing / springy attention-seeking | reads as a template, not a parts supplier |
| Decorative 3D | cost and distraction with no answer |
| Autoplay effects | movement the customer did not ask for |
| Page-transition animation between routes | adds latency to *perceived* navigation, which is the opposite of the goal |
| Animated number count-up on prices | a price is a fact; animating it makes it briefly wrong |
| Skeletons for fast-loading admin tables | flashes a placeholder for less time than it takes to read |
| Animating the search dropdown open with height | would animate a layout property; fades instead |
| Frosted search suggestions | legibility of a part number outranks the effect (docs/DESIGN.md) |
| An animation library (Framer Motion et al.) | ~30–50 KB to do what four keyframes already do; no value CSS cannot provide here |

---

## 8. Verification

| Property | How |
| -------- | --- |
| Duration ceiling, token existence | `tests/unit/motion-system.test.ts` |
| No layout-animating keyframes | same, by parsing every `@keyframes` body |
| Reduced motion keeps meaning | same + `tests/e2e/interaction.spec.ts` under `reducedMotion: 'reduce'` |
| Feedback actually reaches the user | `tests/e2e/interaction.spec.ts` |
| CLS unaffected | docs/PERFORMANCE.md |

Animation timing is deliberately **not** asserted frame-by-frame; that would be
brittle and would test the browser rather than the design.

# Auto-parts data standard

Rules for selling parts, as opposed to selling products. The difference is that
a shirt in the wrong size is an inconvenience and a brake disc for the wrong
engine is a return at best. Every rule below exists to stop the shop asserting
something it cannot support.

Modelled on the shape of the ACES/PIES automotive standards. **No licensed
catalogue is used** — TecDoc and equivalents require commercial licensing, none
has been obtained, and nothing has been scraped. The vehicle taxonomy shipped
here is small, synthetic and hand-written.

---

## 1. Identifiers

| Field | Meaning | Rules |
| ----- | ------- | ----- |
| `sku` | Our stock-keeping unit | **Required, unique.** Never reused after delisting — order history references it. |
| `oem_number` | The vehicle manufacturer's number | Optional. Stored verbatim. Searchable. |
| `mpn` | The part manufacturer's number | Optional. Not the same as OEM: a MANN filter has an MPN of `W 712/52` and an OEM of `1109AY`. |
| `manufacturer` | Who made the part | Free text — may differ from the retail brand. |
| `brand` | Brand it is sold under | Relational (`brands`). |
| `product_family` | Groups variants of the same part | Optional; drives "related". |

**Identifiers are never localised.** `TU5` is not `TU۵`. Persian digits are for
quantities, prices and dates the customer reads; a part number is a token that
must round-trip to a supplier unchanged. Enforced by `.latin-id`
(`direction: ltr; unicode-bidi: isolate`) and asserted in the RTL E2E suite.

**Matching ignores separators.** A number written on a box, in a catalogue and
in a supplier's spreadsheet rarely agrees on hyphens or spacing, so exact-match
detection normalises case and strips `-`, `_`, `.`, `/` and whitespace.

---

## 2. Technical specifications

Key/value/unit triples (`product_specs`), not prose. A brake disc's diameter is
a filterable fact; a sentence containing "۲۴۷ میلی‌متر" is not.

- Units are stored separately from values, never baked into the string.
- Numeric values keep their precision as written by the manufacturer.
- A spec that is unknown is **absent**, never guessed or defaulted.

---

## 3. Part-number relations

`product_references`, typed:

| Type | Meaning |
| ---- | ------- |
| `SUPERSEDES` | This part replaces an older number |
| `SUPERSEDED_BY` | This part has been replaced by a newer one |
| `ALTERNATE` | Functionally equivalent, our catalogue |
| `CROSS_REFERENCE` | Another manufacturer's number for the same part |

Rules:
- A row points at a product we stock **or** a bare number we do not. A CHECK
  requires at least one.
- Search matches `target_number`, so a competitor's number finds ours.
- Only parts we actually stock **and still publish** are linked; everything else
  renders as plain text.
- **A cross-reference is not a fitment claim.** The PDP says so explicitly:
  «کدهای معادل صرفاً برای تطبیق شماره‌فنی است و جایگزین بررسی سازگاری با خودروی
  شما نمی‌شود.»

---

## 4. Fitment hierarchy

```
VehicleBrand (Make)
  └── VehicleModel
        ├── VehicleGeneration
        ├── VehicleTrim
        └── VehicleEngine
              ↓ any combination, plus a Jalali year window
        VehicleConfiguration ──< ProductFitment >── Product
```

A **configuration** is one addressable vehicle. `NULL` in any narrowing column
means *any*: `(206, NULL, NULL, NULL, NULL–NULL)` is "any 206";
`(206, NULL, TIP5, TU5, 1390–1400)` is one specific car.

Rules:
- A unique index over the tuple (coalescing nullables to a sentinel UUID, since
  SQL `NULL` never equals `NULL`) makes the same description resolve to the same
  row. Verified under eight concurrent creations.
- `specificity` records how many narrowing dimensions are set — it is what makes
  precedence deterministic.
- **A configuration must describe a real car.** Model, generation, trim and
  engine are four independent foreign keys, so the database alone would accept a
  پژو ۲۰۶ paired with a پراید engine. The service rejects it: unknown model →
  404, mismatched narrowing → 422 naming the dimension (ADR-011).
- Years are **Jalali**, stored as integers.

---

## 5. Compatibility states

Four, never two.

| State | Meaning | Asserted only when |
| ----- | ------- | ------------------ |
| ✓ سازگار | Fits as-is | a `DIRECT` fitment row definitively applies |
| ! سازگار با تغییر | Fits, with the recorded modification | a `WITH_MODIFICATION` row applies |
| ✕ ناسازگار | Does **not** fit | a `NOT_COMPATIBLE` row applies |
| ؟ اطلاعات کافی نیست | We do not know | **default** — no row decides it |

### The rule that matters

> **Never assume compatibility without evidence — in either direction.**

Absence of data is `UNKNOWN`. It is never rendered as "fits" (which sells the
wrong part) and never as "does not fit" (which invents a fact and loses a sale).

### Precedence

1. Only rows that **definitively** apply can decide. A row whose narrowing the
   customer has not supplied is *indeterminate*, not a match.
2. The **most specific** applicable row wins — so an exclusion recorded for
   "پژو ۲۰۶ TU3" correctly overrides a broad "fits پژو ۲۰۶".
3. At equal specificity, `NOT_COMPATIBLE` wins. Claiming a fit the data
   contradicts is the more expensive error.
4. No definitive match ⇒ `UNKNOWN`.

Rules live in `src/domain/fitment.ts` (pure, unit-tested); the queries feeding
them are in `src/application/fitment-service.ts`.

### Presentation

- The verdict is computed **server-side** from rows, never from prose in a
  description, and never in the browser.
- The vehicle it was computed for is always named.
- When narrowing would change the answer, the missing dimensions are named:
  «برای پاسخ قطعی، تیپ و موتور خودروی خود را مشخص کنید.»
- Listings badge **every** card including `UNKNOWN`, so an unbadged card cannot
  be read as an implicit "fits".
- The fitment table on the PDP is the same data the verdict came from,
  exclusions included — the customer can audit the answer.

---

## 6. Bulk import

- Two phases: validate → preview → commit. Nothing is written until an
  administrator has seen the errors (ADR-009).
- One transaction for the whole file.
- **Nothing is auto-created.** An unknown brand, category, model, engine or trim
  fails the row *by name*. A typo must not mint taxonomy, and a silently dropped
  fitment produces a part that appears to fit nothing — indistinguishable from
  one nobody has mapped.
- A value that cannot be read confidently is an error, never a coerced number.
  `parseInt('12abc') === 12` is how a wrong price gets imported silently.
- Persian digits, `٬` separators, currency words and the spreadsheet `.0`
  artefact are normalised; anything else is rejected.

---

## 7. Taxonomy lifecycle

Deleting a vehicle row cascades through configurations to fitments. The affected
products do not error — they quietly start answering «اطلاعات کافی نیست» with
nobody having decided that. So deletion is **refused** whenever fitments or
saved customer vehicles depend on the row, naming both counts and offering
deactivation, which preserves the data.

---

## 8. Data rights

- No licensed automotive catalogue is imported. TecDoc and equivalents require
  commercial licensing.
- Nothing is scraped because it happens to be technically reachable.
- All shipped vehicle and product data is **synthetic demo data**, marked as such
  by the seed script and by a store-wide demo banner.
- No product photography is copied; demo imagery is hand-written SVG.

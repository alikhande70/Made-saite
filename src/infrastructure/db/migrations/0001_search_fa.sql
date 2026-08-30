-- Persian-aware search support.
--
-- PostgreSQL ships no Persian FTS dictionary, so we normalise text ourselves and
-- index it with the `simple` configuration (case-fold + tokenise, no stemming).
-- Trigram indexes cover partial/typo matching on part numbers and titles.
-- Migration path to a dedicated engine is documented in docs/SEARCH.md.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- `array_to_string` is STABLE (it depends on the element type's output function),
-- which bars it from generated columns. For text[] the operation is genuinely
-- deterministic, so this narrow wrapper can be declared IMMUTABLE safely.
CREATE OR REPLACE FUNCTION md_join_text(arr text[], sep text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT array_to_string(coalesce(arr, '{}'::text[]), sep) $$;
--> statement-breakpoint

-- Normalises Persian text so visually identical strings compare equal.
-- Source characters are written as Unicode escapes and targets as repeat(), so
-- the character counts of each translate() pair are verifiable by inspection.
--
--   yeh    : ي ۍ ئ ې ﻯ ﻰ                    -> ی   (6)
--   kaf    : ك ڪ ﻙ ﻚ ﻛ ﻜ                    -> ک   (6)
--   heh    : ہ ھ ﮪ ﮫ ﮬ ﮭ ة ۀ                -> ه   (8)
--   alef   : أ إ آ ٱ ﺁ                       -> ا   (5)
--   waw    : ؤ                               -> و   (1)
--   digits : ٠-٩ (Arabic-Indic), ۰-۹ (Persian) -> 0-9 (20)
--   spaces : ZWNJ, NBSP                       -> ' ' (2)
-- Harakat (U+064B–U+065F), superscript alef (U+0670), tatweel (U+0640) and
-- ZWJ (U+200D) are stripped outright.
CREATE OR REPLACE FUNCTION md_normalize_fa(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(
    translate(
      translate(
        translate(
          translate(
            translate(
              translate(
                regexp_replace(
                  lower(coalesce(input, '')),
                  '[' || U&'\064B' || '-' || U&'\065F' || U&'\0670' || U&'\0640' || U&'\200D' || ']',
                  '', 'g'
                ),
                U&'\064A\06CD\0626\06D0\FEEF\FEF0', repeat(U&'\06CC', 6)
              ),
              U&'\0643\06AA\FED9\FEDA\FEDB\FEDC', repeat(U&'\06A9', 6)
            ),
            U&'\06C1\06BE\FBAA\FBAB\FBAC\FBAD\0629\06C0', repeat(U&'\0647', 8)
          ),
          U&'\0623\0625\0622\0671\FE81', repeat(U&'\0627', 5)
        ),
        U&'\0624', U&'\0648'
      ),
      U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669'
      || U&'\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9'
      || U&'\200C' || U&'\00A0',
      '01234567890123456789  '
    ),
    '\s+', ' ', 'g'
  ));
$$;
--> statement-breakpoint

-- Product search document. Generated (not trigger-maintained) so it can never
-- drift from the row it describes.
ALTER TABLE "products" ADD COLUMN "search_doc" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', md_normalize_fa("title_fa")), 'A') ||
    setweight(to_tsvector('simple', md_normalize_fa("sku")), 'A') ||
    setweight(to_tsvector('simple', md_normalize_fa(coalesce("oem_number", ''))), 'A') ||
    setweight(to_tsvector('simple', md_normalize_fa(coalesce("mpn", ''))), 'A') ||
    setweight(to_tsvector('simple', md_normalize_fa(coalesce("title_en", ''))), 'B') ||
    setweight(to_tsvector('simple', md_normalize_fa(coalesce("manufacturer", ''))), 'B') ||
    setweight(to_tsvector('simple', md_normalize_fa(md_join_text("tags", ' '))), 'B') ||
    setweight(to_tsvector('simple', md_normalize_fa(coalesce("description_fa", ''))), 'D')
  ) STORED;
--> statement-breakpoint

-- Plain normalised blob for trigram similarity (fuzzy / substring matching).
ALTER TABLE "products" ADD COLUMN "search_plain" text
  GENERATED ALWAYS AS (
    md_normalize_fa(
      "title_fa" || ' ' || coalesce("title_en", '') || ' ' ||
      "sku" || ' ' || coalesce("oem_number", '') || ' ' ||
      coalesce("mpn", '') || ' ' || coalesce("manufacturer", '') || ' ' ||
      md_join_text("tags", ' ')
    )
  ) STORED;
--> statement-breakpoint

CREATE INDEX "products_search_doc_idx" ON "products" USING gin ("search_doc");
--> statement-breakpoint
CREATE INDEX "products_search_plain_trgm_idx" ON "products" USING gin ("search_plain" gin_trgm_ops);
--> statement-breakpoint

-- Normalised lookup indexes for exact part-number searching.
CREATE INDEX "products_sku_norm_idx" ON "products" (md_normalize_fa("sku"));
--> statement-breakpoint
CREATE INDEX "products_oem_norm_idx" ON "products" (md_normalize_fa(coalesce("oem_number", '')));
--> statement-breakpoint

-- Storefront listing hot path: active products newest first.
CREATE INDEX "products_active_published_idx" ON "products" ("is_active", "published_at" DESC NULLS LAST);
--> statement-breakpoint

-- Admin "low stock" dashboard query.
CREATE INDEX "inventory_low_stock_idx" ON "inventory" ("quantity_on_hand")
  WHERE "quantity_on_hand" <= "low_stock_threshold";
--> statement-breakpoint

-- Sweeper query for expired unpaid reservations.
CREATE INDEX "orders_pending_expiry_idx" ON "orders" ("reservation_expires_at")
  WHERE "status" = 'PENDING_PAYMENT';

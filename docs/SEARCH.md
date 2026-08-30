# Persian search

## The problem

Persian text does not compare naïvely. The same word can be written several ways:

| Written as | Also written as | Note |
| ---------- | --------------- | ---- |
| `کیا` | `كيا` | Arabic kaf/yeh vs Persian ک/ی — different code points |
| `۲۰۶` | `٢٠٦` / `206` | Persian, Arabic-Indic and Latin digits |
| `فیلتر هوا` | `فیلتر‌هوا` | ZWNJ (U+200C) instead of a space |
| `محرک` | `مُحَرِّک` | with harakat |

A shopper typing any of these must find the same part. On top of that, auto-parts
search is dominated by **part numbers** — `1109AY`, `BRK-PAD-206F` — which need
exact, prefix and substring matching, not word matching.

## The design (PostgreSQL only, no external engine)

### 1. Normalisation in the database

`md_normalize_fa(text)` (migration `0001_search_fa.sql`) is an `IMMUTABLE` SQL
function that folds all of the above:

- Arabic yeh/kaf/heh variants → Persian `ی` / `ک` / `ه`
- Arabic-Indic `٠-٩` and Persian `۰-۹` digits → ASCII `0-9`
- ZWNJ and NBSP → space; ZWJ, tatweel and harakat removed
- whitespace collapsed, trimmed, lower-cased

Source characters are written as Unicode escapes and targets as `repeat()`, so
each `translate()` pair's character counts are verifiable by inspection — a
silent off-by-one there would delete characters instead of mapping them.

Because it is `IMMUTABLE`, it can be used in generated columns and indexes.

### 2. Generated search columns

`products` carries two `GENERATED ALWAYS … STORED` columns, so they can never
drift from the row they describe:

- **`search_doc`** (`tsvector`) — weighted: title/SKU/OEM/MPN at `A`, English
  name/manufacturer/tags at `B`, description at `D`. Built with the `simple`
  configuration, which case-folds and tokenises without stemming. (PostgreSQL
  ships no Persian dictionary; `simple` over normalised text is the honest
  choice — no incorrect stemming.)
- **`search_plain`** (`text`) — the same fields as one normalised blob, for
  trigram matching.

### 3. Matching

A query matches if **any** of these hold:

```sql
p.search_doc @@ websearch_to_tsquery('simple', md_normalize_fa($q))  -- full text
OR md_normalize_fa($q) <% p.search_plain                            -- word similarity
OR p.search_plain LIKE '%' || md_normalize_fa($q) || '%'            -- substring
OR md_normalize_fa(b.name_fa) LIKE …                                -- brand name
OR md_normalize_fa(c.name_fa) LIKE …                                -- category name
```

`<%` is `pg_trgm`'s **word** similarity — it scores the query against the best
matching run of words inside the document rather than against the whole blob.
That distinction is what makes «فیلتر روغنن» still find «فیلتر روغن»; plain
`similarity()` against a long document scores far too low to clear any useful
threshold.

### 4. Ranking

```
100 × exact SKU / OEM / MPN match
 40 × exact brand or category name match
 20 × partial brand or category name match
 12 × query appears in the product title
 10 × ts_rank(search_doc, query)
  4 × word_similarity(query, search_plain)
```

Ties always break on `id`, never on physical row order, so pagination is stable
and repeated identical queries return identical results — both covered by tests.

### 5. Indexes

| Index | Serves |
| ----- | ------ |
| `products_search_doc_idx` (GIN) | full-text matching |
| `products_search_plain_trgm_idx` (GIN, `gin_trgm_ops`) | `<%` and `LIKE '%…%'` |
| `products_sku_norm_idx`, `products_oem_norm_idx` | exact normalised part-number lookup |
| `products_active_published_idx` | the default listing order |

---

## ⚠ Database locale requirement

`pg_trgm` extracts trigrams only from characters its locale classifies as
alphanumeric. Under `LC_CTYPE=C`, `iswalnum()` returns false for Persian
characters, so **`show_trgm('فیلتر')` returns an empty array and all fuzzy and
substring matching silently stops working** — no error, just zero results.

Create the cluster with a UTF-8 locale:

```bash
initdb -D /var/lib/pgdata --encoding=UTF8 --locale=C.UTF-8
```

Verify:

```sql
SELECT show_trgm('فیلتر روغن');   -- must be non-empty
SELECT word_similarity('فیلتر روغنن', 'فیلتر روغن پژو 206');  -- ≈ 0.83
```

This was caught by a test during development, which is exactly the kind of
failure that would otherwise reach production unnoticed.

---

## Migrating to a dedicated search engine

The current design is deliberately good enough that a search engine is not yet
warranted: a GIN index over a few thousand parts answers in single-digit
milliseconds, and there is no separate service to keep in sync.

Reconsider when any of these appear:
- catalogue beyond ~100k products, or search latency above ~100 ms at p95;
- a need for typo tolerance beyond one or two characters;
- faceting that outgrows what `GROUP BY` can do comfortably;
- multi-field relevance tuning by non-engineers.

**The migration is contained** because all search goes through
`searchProducts()`, `getFacets()` and `suggest()` in
`src/application/catalog-service.ts`. Nothing else in the codebase issues a
search query.

Steps:

1. **Choose an engine.** Meilisearch is the closest fit — first-class RTL
   handling, built-in typo tolerance, simple ops. OpenSearch is the alternative
   when advanced analysis or an existing cluster is in play.
2. **Index the normalised fields.** Reuse `md_normalize_fa` at index time so the
   engine and the database agree on how text is folded.
3. **Keep PostgreSQL authoritative.** The engine returns ids and scores; product
   data, price and stock are still read from the database. That keeps price and
   availability exact and avoids an eventually-consistent shop.
4. **Sync incrementally.** A `LISTEN/NOTIFY` trigger on `products` or an outbox
   table driving a worker; reindex from `listAllActiveSlugs()` for a full rebuild.
5. **Swap behind the same three functions**, keeping the SQL path as a fallback
   when the engine is unavailable.

Retain the SQL implementation. It is the correctness reference for the
normalisation rules and the fallback if the engine goes down.

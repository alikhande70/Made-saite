import { getCategoryTree, getFacets, getVehicleTree, searchProducts } from '@/application/catalog-service';
import { evaluateManyForConfiguration } from '@/application/fitment-service';
import { getSelectedVehicleId } from '@/lib/session';
import { productQuerySchema } from '@/lib/validation';
import { ProductGrid, type VerdictMap } from './product-card';
import { ProductFilters, SortSelect, type FilterState } from './product-filters';
import { EmptyState, Pagination, SearchIcon } from './ui';
import { toPersianDigits } from '@/lib/fa';

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Normalises Next's `searchParams` into the validated product query. */
export function parseQuery(params: RawSearchParams) {
  const single = (key: string) => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const many = (key: string) => {
    const v = params[key];
    return v === undefined ? undefined : Array.isArray(v) ? v : [v];
  };

  const parsed = productQuerySchema.safeParse({
    q: single('q'),
    category: single('category'),
    brand: many('brand'),
    vehicleModel: single('vehicleModel'),
    vehicleEngine: single('vehicleEngine'),
    vehicleYear: single('vehicleYear'),
    minPrice: single('minPrice'),
    maxPrice: single('maxPrice'),
    inStock: single('inStock'),
    manufacturer: single('manufacturer'),
    sort: single('sort'),
    page: single('page'),
    perPage: single('perPage'),
  });

  // A malformed URL falls back to defaults rather than erroring the page.
  return parsed.success ? parsed.data : productQuerySchema.parse({});
}

function buildPageHref(params: RawSearchParams, page: number): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === 'page' || value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.set(key, value);
  }
  if (page > 1) search.set('page', String(page));
  const qs = search.toString();
  return qs ? `?${qs}` : '?';
}

/**
 * Shared listing surface used by /products, /search, /categories/[slug] and
 * /brands/[slug]. Filters and pagination are entirely URL-driven.
 */
export async function ProductListing({
  searchParams,
  overrides = {},
  lockCategory = false,
  lockBrand = false,
  lockVehicle = false,
  heading,
  emptyTitle = 'کالایی یافت نشد',
  emptyDescription = 'فیلترها را تغییر دهید یا عبارت دیگری را جست‌وجو کنید.',
}: {
  searchParams: RawSearchParams;
  overrides?: Partial<{ category: string; brand: string[]; vehicleModel: string }>;
  lockCategory?: boolean;
  lockBrand?: boolean;
  lockVehicle?: boolean;
  heading?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const base = parseQuery(searchParams);
  const query = {
    ...base,
    ...(overrides.category ? { category: overrides.category } : {}),
    ...(overrides.brand ? { brand: overrides.brand } : {}),
    ...(overrides.vehicleModel ? { vehicleModel: overrides.vehicleModel } : {}),
  };

  const [results, facets, categories, vehicles, activeVehicleId] = await Promise.all([
    searchProducts(query),
    getFacets(query),
    getCategoryTree(),
    getVehicleTree(),
    getSelectedVehicleId().catch(() => null),
  ]);

  /*
   * One query for the whole page of results, then a pure evaluation per
   * product — badging a 24-card grid must not cost 24 round trips.
   */
  let verdicts: VerdictMap | undefined;
  if (activeVehicleId && results.items.length > 0) {
    const evaluated = await evaluateManyForConfiguration(
      results.items.map((i) => i.id),
      activeVehicleId,
    ).catch(() => null);
    if (evaluated) {
      verdicts = new Map([...evaluated].map(([id, r]) => [id, r.verdict]));
    }
  }

  const brandParam = query.brand ? (Array.isArray(query.brand) ? query.brand : [query.brand]) : [];
  const state: FilterState = {
    category: query.category,
    brands: brandParam,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock ?? false,
    manufacturer: query.manufacturer,
    vehicleModel: query.vehicleModel,
    vehicleEngine: query.vehicleEngine,
    vehicleYear: query.vehicleYear,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
      <aside className="lg:sticky lg:top-32 lg:self-start">
        {/* The card frame is desktop-only; on mobile the trigger button stands alone. */}
        <div className="lg:card lg:p-5">
          <ProductFilters
            facets={facets}
            categories={categories}
            vehicles={vehicles}
            state={state}
            lockCategory={lockCategory}
            lockBrand={lockBrand}
            lockVehicle={lockVehicle}
            total={results.total}
          />
        </div>
      </aside>

      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            {heading ? <span className="font-bold text-steel-900">{heading} — </span> : null}
            {toPersianDigits(results.total)} کالا
            {results.totalPages > 1 && (
              <span className="ms-1">
                (صفحهٔ {toPersianDigits(results.page)} از {toPersianDigits(results.totalPages)})
              </span>
            )}
          </p>
          <SortSelect value={query.sort} />
        </div>

        {results.items.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} icon={<SearchIcon className="size-10" />} />
        ) : (
          <>
            <ProductGrid products={results.items} verdicts={verdicts} />
            <Pagination
              page={results.page}
              totalPages={results.totalPages}
              buildHref={(p) => buildPageHref(searchParams, p)}
            />
          </>
        )}
      </section>
    </div>
  );
}

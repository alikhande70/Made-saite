'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Facets } from '@/application/catalog-service';
import type { CategoryNode, VehicleBrandNode } from '@/application/catalog-service';
import { formatToman, toLatinDigits, toPersianDigits } from '@/lib/fa';
import { Button, ChevronDown, CloseIcon } from './ui';

export interface FilterState {
  category?: string | undefined;
  brands: string[];
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  inStock: boolean;
  manufacturer?: string | undefined;
  vehicleModel?: string | undefined;
  vehicleEngine?: string | undefined;
  vehicleYear?: number | undefined;
}

interface Props {
  facets: Facets;
  categories: CategoryNode[];
  vehicles: VehicleBrandNode[];
  state: FilterState;
  /** True on a category page, where the category is fixed by the URL. */
  lockCategory?: boolean;
  lockBrand?: boolean;
  /** True on a `/parts/{category}/{vehicle}` landing page, where the vehicle is the URL. */
  lockVehicle?: boolean;
  total: number;
}

/**
 * Filter panel. It writes to the URL rather than to component state, so results
 * are shareable, bookmarkable and reachable by the back button — and the server
 * renders them.
 */
export function ProductFilters(props: Props) {
  const [openOnMobile, setOpenOnMobile] = useState(false);

  return (
    <>
      <div className="lg:hidden">
        <Button type="button" variant="secondary" onClick={() => setOpenOnMobile(true)} className="w-full">
          فیلترها و مرتب‌سازی
          <ChevronDown className="size-4" />
        </Button>
      </div>

      {/* Mobile: full-height drawer from the reading-start edge. */}
      {openOnMobile && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-steel-950/60" onClick={() => setOpenOnMobile(false)} aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="فیلترها"
            className="absolute inset-y-0 start-0 flex w-[88%] max-w-sm flex-col bg-white"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-extrabold text-steel-900">فیلترها</span>
              <button type="button" onClick={() => setOpenOnMobile(false)} aria-label="بستن فیلترها" className="rounded-lg p-2 text-steel-500">
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <FilterForm {...props} onApplied={() => setOpenOnMobile(false)} />
            </div>
          </div>
        </div>
      )}

      <div className="hidden lg:block">
        <FilterForm {...props} />
      </div>
    </>
  );
}

function FilterForm({
  facets, categories, vehicles, state, lockCategory, lockBrand, lockVehicle, total, onApplied,
}: Props & { onApplied?: () => void }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [minPrice, setMinPrice] = useState(state.minPrice ? String(state.minPrice) : '');
  const [maxPrice, setMaxPrice] = useState(state.maxPrice ? String(state.maxPrice) : '');

  /** Rewrites the query string, always resetting to page 1. */
  function apply(patch: Record<string, string | string[] | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      params.delete(key);
      if (value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
      else params.set(key, value);
    }
    params.delete('page');
    router.push(`?${params.toString()}`);
    onApplied?.();
  }

  function toggleBrand(slug: string) {
    const next = state.brands.includes(slug)
      ? state.brands.filter((b) => b !== slug)
      : [...state.brands, slug];
    apply({ brand: next });
  }

  const selectedVehicle = vehicles
    .flatMap((b) => b.models.map((m) => ({ ...m, brandName: b.nameFa })))
    .find((m) => m.slug === state.vehicleModel);

  const activeCount =
    state.brands.length +
    (state.minPrice ? 1 : 0) + (state.maxPrice ? 1 : 0) +
    (state.inStock ? 1 : 0) + (state.manufacturer ? 1 : 0) +
    (!lockVehicle && state.vehicleModel ? 1 : 0) + (!lockCategory && state.category ? 1 : 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-steel-900">
          فیلترها
          {activeCount > 0 && (
            <span className="ms-2 rounded-full bg-steel-800 px-2 py-0.5 text-[0.6875rem] font-bold text-white">
              {toPersianDigits(activeCount)}
            </span>
          )}
        </p>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => {
              const params = new URLSearchParams();
              const q = searchParams.get('q');
              if (q) params.set('q', q);
              if (lockCategory && state.category) params.set('category', state.category);
              if (lockVehicle && state.vehicleModel) params.set('vehicleModel', state.vehicleModel);
              router.push(params.toString() ? `?${params.toString()}` : '?');
              onApplied?.();
            }}
            className="text-xs font-semibold text-accent-700 hover:underline"
          >
            حذف همهٔ فیلترها
          </button>
        )}
      </div>

      <p className="text-xs text-muted">{toPersianDigits(total)} کالا یافت شد</p>

      {/* Availability */}
      <FilterGroup title="موجودی">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={state.inStock}
            onChange={(e) => apply({ inStock: e.target.checked ? '1' : null })}
            className="size-4 rounded border-steel-300 text-steel-700 focus:ring-steel-500"
          />
          فقط کالاهای موجود
        </label>
      </FilterGroup>

      {/* Vehicle — hidden when the URL itself is the vehicle. */}
      {!lockVehicle && (
      <FilterGroup title="خودرو">
        {selectedVehicle ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-steel-50 px-3 py-2">
            <span className="text-sm font-semibold text-steel-800">
              {selectedVehicle.brandName} — {selectedVehicle.nameFa}
              {state.vehicleEngine && <span className="latin-id ms-1 text-xs text-muted">{state.vehicleEngine}</span>}
              {state.vehicleYear && <span className="ms-1 text-xs text-muted">({toPersianDigits(state.vehicleYear)})</span>}
            </span>
            <button
              type="button"
              onClick={() => apply({ vehicleModel: null, vehicleEngine: null, vehicleYear: null })}
              aria-label="حذف فیلتر خودرو"
              className="text-steel-500 hover:text-steel-800"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        ) : (
          <select
            className="field text-sm"
            value=""
            onChange={(e) => apply({ vehicleModel: e.target.value || null, vehicleEngine: null, vehicleYear: null })}
            aria-label="انتخاب خودرو"
          >
            <option value="">همهٔ خودروها</option>
            {vehicles.map((brand) => (
              <optgroup key={brand.slug} label={brand.nameFa}>
                {brand.models.map((model) => (
                  <option key={model.slug} value={model.slug}>{model.nameFa}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </FilterGroup>
      )}

      {/* Category */}
      {!lockCategory && categories.length > 0 && (
        <FilterGroup title="دسته‌بندی">
          <select
            className="field text-sm"
            value={state.category ?? ''}
            onChange={(e) => apply({ category: e.target.value || null })}
            aria-label="انتخاب دسته‌بندی"
          >
            <option value="">همهٔ دسته‌ها</option>
            {categories.map((cat) => (
              <optgroup key={cat.slug} label={cat.nameFa}>
                <option value={cat.slug}>همهٔ {cat.nameFa}</option>
                {cat.children.map((child) => (
                  <option key={child.slug} value={child.slug}>{child.nameFa}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </FilterGroup>
      )}

      {/* Brand */}
      {!lockBrand && facets.brands.length > 0 && (
        <FilterGroup title="برند">
          <ul className="max-h-56 space-y-1.5 overflow-y-auto pe-1">
            {facets.brands.map((brand) => (
              <li key={brand.slug}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={state.brands.includes(brand.slug)}
                    onChange={() => toggleBrand(brand.slug)}
                    className="size-4 rounded border-steel-300 text-steel-700 focus:ring-steel-500"
                  />
                  <span className="flex-1">{brand.nameFa}</span>
                  <span className="text-xs text-muted">{toPersianDigits(brand.count)}</span>
                </label>
              </li>
            ))}
          </ul>
        </FilterGroup>
      )}

      {/* Price */}
      <FilterGroup title="محدودهٔ قیمت (تومان)">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            apply({
              minPrice: toLatinDigits(minPrice).replace(/\D/g, '') || null,
              maxPrice: toLatinDigits(maxPrice).replace(/\D/g, '') || null,
            });
          }}
          className="space-y-2"
        >
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              placeholder="از"
              aria-label="کمترین قیمت"
              className="field h-9 text-sm tabular-nums"
            />
            <span className="text-muted">تا</span>
            <input
              inputMode="numeric"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              placeholder="تا"
              aria-label="بیشترین قیمت"
              className="field h-9 text-sm tabular-nums"
            />
          </div>
          {facets.priceRange && (
            <p className="hint">
              از {formatToman(facets.priceRange.min)} تا {formatToman(facets.priceRange.max)}
            </p>
          )}
          <Button type="submit" variant="secondary" size="sm" className="w-full">اعمال قیمت</Button>
        </form>
      </FilterGroup>

      {facets.manufacturers.length > 1 && (
        <FilterGroup title="سازنده">
          <select
            className="field text-sm"
            value={state.manufacturer ?? ''}
            onChange={(e) => apply({ manufacturer: e.target.value || null })}
            aria-label="انتخاب سازنده"
          >
            <option value="">همهٔ سازندگان</option>
            {facets.manufacturers.map((m) => (
              <option key={m.name} value={m.name}>{m.name} ({toPersianDigits(m.count)})</option>
            ))}
          </select>
        </FilterGroup>
      )}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="mb-2.5 text-[0.8125rem] font-bold text-steel-800">{title}</h3>
      {children}
    </section>
  );
}

/** Sort control; also URL-driven. */
export function SortSelect({ value }: { value: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="shrink-0 text-muted">مرتب‌سازی:</span>
      <select
        className="field h-9 w-auto min-w-40 py-0 text-sm"
        value={value}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set('sort', e.target.value);
          params.delete('page');
          router.push(`?${params.toString()}`);
        }}
      >
        <option value="relevance">مرتبط‌ترین</option>
        <option value="newest">جدیدترین</option>
        <option value="price-asc">ارزان‌ترین</option>
        <option value="price-desc">گران‌ترین</option>
      </select>
    </label>
  );
}

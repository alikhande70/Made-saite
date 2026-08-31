'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SearchIcon, CloseIcon, LatinId, Spinner } from './ui';

interface Suggestion {
  slug: string;
  titleFa: string;
  sku: string;
  oemNumber: string | null;
  imageUrl: string | null;
}

/**
 * Header search. Submits as a normal navigation (so it works without JS) and
 * layers debounced suggestions on top when JS is available.
 */
export function SearchBox({ initialQuery = '', autoFocus = false }: { initialQuery?: string; autoFocus?: boolean }) {
  const router = useRouter();
  // The header renders a desktop and a mobile SearchBox on the same page, so the
  // input id must be per-instance or the two labels collide.
  const inputId = useId();
  const listboxId = `${inputId}-suggestions`;
  const [value, setValue] = useState(initialQuery);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /**
   * `searching` vs `searched` are distinct on purpose. Without the second flag
   * an empty result set is indistinguishable from "the request has not come
   * back yet", and the customer is left staring at nothing wondering which.
   */
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = value.trim();
    if (term.length < 2) {
      setItems([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { ok: boolean; data?: Suggestion[] };
        setItems(body.data ?? []);
        setActive(-1);
        setSearched(true);
      } catch {
        /* aborted or offline — suggestions are optional */
      } finally {
        // An abort means a newer keystroke owns the spinner; do not clear it.
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [value]);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  function submit(term: string) {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(term.trim())}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || items.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      const chosen = items[active];
      if (chosen) {
        setOpen(false);
        router.push(`/products/${encodeURIComponent(chosen.slug)}`);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative w-full">
      <form
        role="search"
        action="/search"
        method="get"
        onSubmit={(e) => {
          if (!value.trim()) return;
          e.preventDefault();
          submit(value);
        }}
      >
        <label htmlFor={inputId} className="sr-only">جست‌وجوی قطعات</label>
        <div className="relative">
          {/* `ps-`/`pe-` keep the icon on the reading-start side in any direction. */}
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-steel-400" />
          <input
            id={inputId}
            name="q"
            type="search"
            autoComplete="off"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => { setValue(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="نام قطعه، کد فنی، OEM یا خودرو…"
            role="combobox"
            aria-expanded={open && items.length > 0}
            aria-autocomplete="list"
            aria-controls={listboxId}
            className="field h-11 ps-10 pe-24 text-sm"
          />
          {value && (
            <button
              type="button"
              onClick={() => { setValue(''); setItems([]); }}
              aria-label="پاک کردن جست‌وجو"
              className="absolute end-[5.5rem] top-1/2 -translate-y-1/2 rounded p-1 text-steel-400 hover:text-steel-700"
            >
              <CloseIcon className="size-4" />
            </button>
          )}
          <button
            type="submit"
            className="absolute end-1.5 top-1/2 h-8 -translate-y-1/2 rounded-md bg-steel-800 px-3 text-sm font-semibold text-white hover:bg-steel-900"
          >
            جست‌وجو
          </button>
        </div>
      </form>

      {/*
        * Searching and no-results are rendered, not left blank. The panel is
        * opaque and lifted rather than frosted: it carries the part numbers a
        * shopper is about to click, over whatever page they were on.
        */}
      {open && searching && items.length === 0 && (
        <div className="motion-fade absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-line bg-white p-4 shadow-pop">
          <p role="status" className="flex items-center gap-2 text-sm text-muted">
            <Spinner className="size-4" />
            در حال جست‌وجو…
          </p>
        </div>
      )}

      {open && !searching && searched && items.length === 0 && value.trim().length >= 2 && (
        <div className="motion-fade absolute inset-x-0 top-full z-40 mt-2 rounded-xl border border-line bg-white p-4 shadow-pop">
          <p role="status" className="text-sm font-semibold text-steel-900">
            نتیجه‌ای برای «{value.trim()}» پیدا نشد.
          </p>
          {/* Tell them what to try next, not just that nothing matched. */}
          <p className="hint mt-1">
            کد فنی یا شمارهٔ OEM را کامل وارد کنید، یا نام قطعه را همراه نام خودرو جست‌وجو کنید.
          </p>
        </div>
      )}

      {open && items.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="motion-fade absolute inset-x-0 top-full z-40 mt-2 max-h-96 overflow-y-auto rounded-xl border border-line bg-white py-1.5 shadow-pop"
        >
          {items.map((item, i) => (
            <li key={item.slug} role="option" aria-selected={i === active}>
              <Link
                href={`/products/${encodeURIComponent(item.slug)}`}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 ${i === active ? 'bg-steel-50' : 'hover:bg-steel-50'}`}
              >
                { }
                <img src={item.imageUrl ?? '/demo/oil-filter.svg'} alt="" className="size-10 shrink-0 rounded-md border border-line object-cover" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-steel-900">{item.titleFa}</span>
                  <LatinId className="block text-xs text-muted">{item.sku}</LatinId>
                </span>
                {isExactPartNumber(value, item) && (
                  <span className="shrink-0 rounded-md bg-accent-50 px-1.5 py-0.5 text-[0.6875rem] font-bold text-accent-800">
                    کد دقیق
                  </span>
                )}
              </Link>
            </li>
          ))}
          <li className="border-t border-line px-3 pt-2 pb-1">
            <button type="button" onClick={() => submit(value)} className="text-sm font-semibold text-steel-700 hover:underline">
              مشاهدهٔ همهٔ نتایج «{value.trim()}»
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}

/**
 * True when what the customer typed *is* this product's SKU or OEM number,
 * rather than merely matching some of its text. Compared case-insensitively
 * and without separators, because a part number written on a box, in a
 * catalogue and in a supplier's sheet rarely agrees on hyphens or spacing.
 */
function isExactPartNumber(query: string, item: Suggestion): boolean {
  const normalise = (v: string) => v.trim().toLowerCase().replace(/[\s\-_./]/g, '');
  const term = normalise(query);
  if (term.length < 3) return false;
  return normalise(item.sku) === term || (item.oemNumber ? normalise(item.oemNumber) === term : false);
}

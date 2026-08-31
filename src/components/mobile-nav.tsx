'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CloseIcon, MenuIcon, ChevronDown } from './ui';
import { toPersianDigits } from '@/lib/fa';

export interface NavCategory {
  slug: string;
  nameFa: string;
  productCount: number;
  children: { slug: string; nameFa: string; productCount: number }[];
}

/**
 * Mobile navigation drawer. In RTL it slides in from the right — the reading
 * start edge — using `inset-inline-start`/`end` rather than fixed left/right.
 */
export function MobileNav({ categories }: { categories: NavCategory[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="باز کردن منو"
        aria-expanded={open}
        className="inline-flex size-10 items-center justify-center rounded-lg text-steel-100 hover:bg-steel-700 lg:hidden"
      >
        <MenuIcon />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="scrim absolute inset-0"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="منوی دسته‌بندی‌ها"
            className="absolute inset-y-0 start-0 flex w-[86%] max-w-sm flex-col bg-white shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-extrabold text-steel-900">دسته‌بندی قطعات</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="بستن منو" className="rounded-lg p-2 text-steel-500 hover:bg-steel-50">
                <CloseIcon />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto py-2">
              <ul>
                {categories.map((cat) => (
                  <li key={cat.slug} className="border-b border-line/70">
                    <div className="flex items-stretch">
                      <Link
                        href={`/categories/${encodeURIComponent(cat.slug)}`}
                        onClick={() => setOpen(false)}
                        className="flex-1 px-4 py-3 text-[0.9375rem] font-semibold text-steel-800"
                      >
                        {cat.nameFa}
                        <span className="ms-2 text-xs font-normal text-muted">{toPersianDigits(cat.productCount)}</span>
                      </Link>
                      {cat.children.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === cat.slug ? null : cat.slug)}
                          aria-label={`زیرشاخه‌های ${cat.nameFa}`}
                          aria-expanded={expanded === cat.slug}
                          className="px-4 text-steel-400"
                        >
                          <ChevronDown className={`size-5 transition-transform ${expanded === cat.slug ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                    </div>
                    {expanded === cat.slug && cat.children.length > 0 && (
                      <ul className="bg-steel-50/70 pb-2">
                        {cat.children.map((child) => (
                          <li key={child.slug}>
                            <Link
                              href={`/categories/${encodeURIComponent(child.slug)}`}
                              onClick={() => setOpen(false)}
                              className="block ps-8 pe-4 py-2 text-sm text-steel-700"
                            >
                              {child.nameFa}
                              <span className="ms-2 text-xs text-muted">{toPersianDigits(child.productCount)}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              <ul className="mt-2 px-4 py-2 text-sm">
                {[
                  ['/vehicles', 'انتخاب بر اساس خودرو'],
                  ['/brands', 'برندها'],
                  ['/orders/track', 'پیگیری سفارش'],
                  ['/account', 'حساب کاربری'],
                ].map(([href, label]) => (
                  <li key={href}>
                    <Link href={href!} onClick={() => setOpen(false)} className="block py-2.5 font-semibold text-steel-700">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      )}
    </>
  );
}

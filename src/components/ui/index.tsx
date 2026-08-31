/**
 * Shared presentational primitives.
 *
 * Everything here uses CSS *logical* properties (ps/pe, ms/me, start/end,
 * text-start) rather than left/right, so the same markup is correct in RTL and
 * would be correct in LTR too. Directional icons carry `flip-rtl`.
 */
import Link from 'next/link';
import type { ReactNode, ComponentProps } from 'react';
import { formatToman, toPersianDigits } from '@/lib/fa';
import { discountPercent } from '@/domain/money';
import { STOCK_STATUS_LABEL_FA, type StockStatus } from '@/domain/inventory';

/* ── buttons ──────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-steel-800 text-white hover:bg-steel-900 disabled:bg-steel-300',
  accent: 'bg-accent-600 text-white hover:bg-accent-700 disabled:bg-steel-300',
  secondary: 'bg-white text-steel-800 border border-line hover:bg-steel-50 disabled:text-steel-300',
  ghost: 'bg-transparent text-steel-700 hover:bg-steel-50 disabled:text-steel-300',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-200',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-[0.9375rem] gap-2',
  lg: 'h-13 px-6 text-base gap-2',
};

export function buttonClass(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', extra = ''): string {
  return [
    'inline-flex items-center justify-center rounded-lg font-semibold',
    'transition-colors disabled:cursor-not-allowed select-none press',
    '[transition-duration:var(--motion-fast)]',
    VARIANTS[variant], SIZES[size], extra,
  ].join(' ');
}

/**
 * Indeterminate activity indicator.
 *
 * Indeterminate on purpose: the server reports no progress for a checkout or
 * an add-to-cart, so any percentage would be invented. A fake progress bar
 * that stalls at 90% is worse than an honest spinner.
 *
 * Purely decorative to assistive technology — the surrounding control carries
 * `aria-busy` and the status text, so a screen reader is told what is
 * happening rather than that a shape is rotating.
 */
export function Spinner({ className = 'size-4' }: { className?: string }) {
  return (
    <svg className={`spinner ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" className="opacity-25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Button with a first-class pending state.
 *
 * `loading` disables the control, marks it `aria-busy`, and swaps in a spinner
 * beside `loadingLabel`. Centralising it means every submit in the application
 * answers "is the system working?" the same way, and that a control can never
 * be pressed twice while its first press is still in flight — the client-side
 * half of the double-submit protection whose authority lives in the cart lock
 * (ADR-013).
 */
export function Button({
  variant = 'primary', size = 'md', className = '', loading = false, loadingLabel,
  children, disabled, ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Replaces the label while loading. Omit to keep the label beside the spinner. */
  loadingLabel?: string;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
    >
      {loading && <Spinner />}
      {loading && loadingLabel ? loadingLabel : children}
    </button>
  );
}

export function LinkButton({
  href, variant = 'primary', size = 'md', className = '', children, ...rest
}: { href: string; variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode } & Omit<ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </Link>
  );
}

/* ── price ────────────────────────────────────────────────────────────── */

export function Price({
  price, salePrice, size = 'md',
}: { price: number; salePrice?: number | null; size?: 'sm' | 'md' | 'lg' }) {
  const hasSale = salePrice !== null && salePrice !== undefined && salePrice < price;
  const current = hasSale ? salePrice : price;
  const off = hasSale ? discountPercent(price, salePrice) : 0;

  const currentSize = size === 'lg' ? 'text-2xl sm:text-3xl' : size === 'sm' ? 'text-sm' : 'text-lg';

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {hasSale && (
        <>
          <span className="text-xs text-muted line-through decoration-red-500/60">{formatToman(price)}</span>
          <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-700 tabular-nums">
            {toPersianDigits(off)}٪ تخفیف
          </span>
        </>
      )}
      <span className={`${currentSize} font-extrabold text-steel-900`}>{formatToman(current)}</span>
    </div>
  );
}

/* ── stock ────────────────────────────────────────────────────────────── */

const STOCK_STYLE: Record<StockStatus, string> = {
  IN_STOCK: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  LOW_STOCK: 'bg-amber-50 text-amber-800 ring-amber-600/25',
  OUT_OF_STOCK: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

export function StockBadge({ status, quantity }: { status: StockStatus; quantity?: number }) {
  const showCount = status === 'LOW_STOCK' && typeof quantity === 'number' && quantity > 0;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset ${STOCK_STYLE[status]}`}>
      <span aria-hidden className={`size-1.5 rounded-full ${
        status === 'IN_STOCK' ? 'bg-emerald-500' : status === 'LOW_STOCK' ? 'bg-amber-500' : 'bg-slate-400'
      }`} />
      {showCount ? `تنها ${toPersianDigits(quantity)} عدد باقی مانده` : STOCK_STATUS_LABEL_FA[status]}
    </span>
  );
}

/* ── layout helpers ───────────────────────────────────────────────────── */

/**
 * Section header. `as` defaults to `h2`; pass `h1` when this heading *is* the
 * page title, so every page keeps exactly one top-level heading.
 */
export function SectionHeading({
  title, subtitle, action, as: Tag = 'h2',
}: { title: string; subtitle?: string; action?: ReactNode; as?: 'h1' | 'h2' }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Tag className="text-xl font-extrabold text-steel-900 sm:text-2xl">{title}</Tag>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Breadcrumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="مسیر صفحه" className="scroll-x no-scrollbar -mx-1 mb-4">
      <ol className="flex items-center gap-1 whitespace-nowrap px-1 text-sm text-muted">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center gap-1">
            {i > 0 && <ChevronEnd className="size-3.5 shrink-0 text-steel-300" />}
            {item.href && i < items.length - 1 ? (
              <Link href={item.href} className="hover:text-steel-800 hover:underline">{item.label}</Link>
            ) : (
              <span className="font-semibold text-steel-800" aria-current={i === items.length - 1 ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function EmptyState({
  title, description, action, icon,
}: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-steel-300">{icon}</div>}
      <h3 className="text-lg font-bold text-steel-900">{title}</h3>
      {description && <p className="max-w-md text-sm text-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Alert({
  tone = 'info', title, children,
}: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: string; children: ReactNode }) {
  const styles = {
    info: 'bg-steel-50 text-steel-800 ring-steel-600/15',
    warning: 'bg-amber-50 text-amber-900 ring-amber-600/25',
    error: 'bg-red-50 text-red-800 ring-red-600/20',
    success: 'bg-emerald-50 text-emerald-900 ring-emerald-600/20',
  }[tone];
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${styles}`}>
      {title && <p className="mb-1 font-bold">{title}</p>}
      <div className="[&_a]:font-semibold [&_a]:underline">{children}</div>
    </div>
  );
}

/** Latin identifiers (SKU, OEM, tracking codes) inside Persian text. */
export function LatinId({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <span className={`latin-id ${className}`}>{children}</span>;
}

export function Pagination({
  page, totalPages, buildHref,
}: { page: number; totalPages: number; buildHref: (page: number) => string }) {
  if (totalPages <= 1) return null;

  const windowed: number[] = [];
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  for (let p = start; p <= Math.min(totalPages, start + 4); p += 1) windowed.push(p);

  return (
    <nav aria-label="صفحه‌بندی" className="mt-8 flex items-center justify-center gap-1.5">
      {/* In RTL the "previous" control sits on the right; the chevron mirrors. */}
      <PageLink href={buildHref(page - 1)} disabled={page <= 1} label="صفحهٔ قبل">
        <ChevronStart className="size-4" />
      </PageLink>
      {start > 1 && (
        <>
          <PageLink href={buildHref(1)} label="صفحهٔ ۱">{toPersianDigits(1)}</PageLink>
          <span className="px-1 text-muted">…</span>
        </>
      )}
      {windowed.map((p) => (
        <PageLink key={p} href={buildHref(p)} active={p === page} label={`صفحهٔ ${toPersianDigits(p)}`}>
          {toPersianDigits(p)}
        </PageLink>
      ))}
      {start + 4 < totalPages && (
        <>
          <span className="px-1 text-muted">…</span>
          <PageLink href={buildHref(totalPages)} label={`صفحهٔ ${toPersianDigits(totalPages)}`}>
            {toPersianDigits(totalPages)}
          </PageLink>
        </>
      )}
      <PageLink href={buildHref(page + 1)} disabled={page >= totalPages} label="صفحهٔ بعد">
        <ChevronEnd className="size-4" />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href, children, active, disabled, label,
}: { href: string; children: ReactNode; active?: boolean; disabled?: boolean; label: string }) {
  const base = 'inline-flex size-10 items-center justify-center rounded-lg text-sm font-semibold tabular-nums';
  if (disabled) {
    return <span aria-disabled className={`${base} cursor-not-allowed text-steel-300`}>{children}</span>;
  }
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`${base} ${active ? 'bg-steel-800 text-white' : 'bg-white text-steel-700 ring-1 ring-line hover:bg-steel-50'}`}
    >
      {children}
    </Link>
  );
}

/* ── icons ────────────────────────────────────────────────────────────── */
/* Inline SVGs: no icon-font download, and each one is direction-aware. */

type IconProps = { className?: string };

/** Points toward the *start* of the reading direction (right in RTL). */
export function ChevronStart({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={`flip-rtl ${className}`}>
      <path d="M12.5 15 7.5 10l5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Points toward the *end* of the reading direction (left in RTL). */
export function ChevronEnd({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={`flip-rtl ${className}`}>
      <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDown({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SearchIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.75" />
      <path d="m13.5 13.5 3.5 3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function CartIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M2.5 3h2l2.2 11.2a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L20 7H6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9.5" cy="20" r="1.5" fill="currentColor" />
      <circle cx="17.5" cy="20" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function UserIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <circle cx="12" cy="8" r="3.75" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function CarIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M3 13.5 4.6 8.7A2.5 2.5 0 0 1 7 7h10a2.5 2.5 0 0 1 2.4 1.7L21 13.5M3 13.5h18M3 13.5v4a1 1 0 0 0 1 1h1.5a1 1 0 0 0 1-1v-1m14-3v4a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1v-1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="7" cy="16" r="1" fill="currentColor" />
      <circle cx="17" cy="16" r="1" fill="currentColor" />
    </svg>
  );
}

export function MenuIcon({ className = 'size-6' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CheckIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden className={className}>
      <path d="m4.5 10.5 3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TruckIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M2.5 6.5h11v10h-11zM13.5 10h3.8l3.2 3.2v3.3h-7z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="7" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17.5" cy="18" r="1.6" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function ShieldIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M12 3 4.5 6v6c0 4.4 3.1 7.9 7.5 9 4.4-1.1 7.5-4.6 7.5-9V6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BoxIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M3.5 7.5 12 3.5l8.5 4v9L12 20.5l-8.5-4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M3.5 7.5 12 11.5m0 0 8.5-4M12 11.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function WrenchIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M15.6 3.6a5 5 0 0 0-6.2 6.2L3.8 15.4a2 2 0 1 0 2.8 2.8l5.6-5.6a5 5 0 0 0 6.2-6.2l-2.9 2.9-2.4-.5-.5-2.4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function TrashIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M4.5 6.5h15M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 6.5 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PhoneIcon({ className = 'size-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M7 3.5 9 8 7.2 9.8a12 12 0 0 0 5 5L14 13l4.5 2v3.5a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 3.5 7.7 2 2 0 0 1 5.5 5.5z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

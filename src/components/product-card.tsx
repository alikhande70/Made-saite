import Link from 'next/link';
import type { ProductCard as ProductCardData } from '@/application/catalog-service';
import type { CompatibilityVerdict } from '@/domain/fitment';
import { toPersianDigits } from '@/lib/fa';
import { LatinId, Price, StockBadge } from './ui';
import { VerdictChip } from './compatibility';
import { AddToCartButton } from './add-to-cart';

/**
 * Verdicts for the shopper's active vehicle, keyed by product id.
 *
 * All four outcomes are rendered, including «اطلاعات کافی نیست» — an unbadged
 * card must never be readable as an implicit "fits".
 */
export type VerdictMap = ReadonlyMap<string, CompatibilityVerdict>;

export function ProductCard({
  product, priority = false, verdict,
}: { product: ProductCardData; priority?: boolean; verdict?: CompatibilityVerdict }) {
  const href = `/products/${encodeURIComponent(product.slug)}`;
  const outOfStock = product.stockStatus === 'OUT_OF_STOCK';

  return (
    <article className="card group flex flex-col overflow-hidden transition-shadow hover:shadow-raised">
      <Link href={href} className="relative block aspect-square overflow-hidden bg-steel-50">
        { }
        <img
          src={product.imageUrl ?? '/demo/engine-part.svg'}
          alt={product.imageAlt ?? product.titleFa}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className={`size-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${outOfStock ? 'opacity-60 grayscale' : ''}`}
        />
        {outOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-steel-900/85 py-1.5 text-center text-xs font-bold text-white">
            ناموجود
          </span>
        )}
        {product.salePrice !== null && !outOfStock && (
          <span className="absolute top-2 start-2 rounded-md bg-red-600 px-2 py-1 text-[0.6875rem] font-bold text-white">
            فروش ویژه
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        {product.brandName && (
          <Link
            href={`/brands/${encodeURIComponent(product.brandSlug ?? '')}`}
            className="text-xs font-semibold text-steel-500 hover:text-steel-800"
          >
            {product.brandName}
          </Link>
        )}

        <h3 className="text-sm font-bold leading-6 text-steel-900">
          <Link href={href} className="line-clamp-2 hover:text-steel-700">{product.titleFa}</Link>
        </h3>

        {verdict && <VerdictChip verdict={verdict} className="self-start text-[0.6875rem]" />}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.6875rem] text-muted">
          <span>
            کد کالا: <LatinId>{product.sku}</LatinId>
          </span>
          {product.oemNumber && (
            <span>
              OEM: <LatinId>{product.oemNumber}</LatinId>
            </span>
          )}
        </div>

        <div className="mt-auto space-y-2.5 pt-1">
          <StockBadge status={product.stockStatus} quantity={product.quantityAvailable} />
          <Price price={product.price} salePrice={product.salePrice} />
          {product.warrantyMonths ? (
            <p className="text-[0.6875rem] text-muted">
              ‏{toPersianDigits(product.warrantyMonths)} ماه ضمانت
            </p>
          ) : null}
          <AddToCartButton
            productId={product.id}
            disabled={outOfStock}
            available={product.quantityAvailable}
            size="sm"
            label="افزودن به سبد"
          />
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({
  products, priorityCount = 4, verdicts,
}: { products: ProductCardData[]; priorityCount?: number; verdicts?: VerdictMap }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} priority={i < priorityCount} verdict={verdicts?.get(p.id)} />
      ))}
    </div>
  );
}

/** Horizontal rail used on the home and product pages. */
export function ProductRail({ products, verdicts }: { products: ProductCardData[]; verdicts?: VerdictMap }) {
  if (products.length === 0) return null;
  return (
    <div className="scroll-x no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-3 sm:gap-4">
        {products.map((p) => (
          <div key={p.id} className="w-[46%] shrink-0 sm:w-56 lg:w-60">
            <ProductCard product={p} verdict={verdicts?.get(p.id)} />
          </div>
        ))}
      </div>
    </div>
  );
}

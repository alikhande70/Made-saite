import { canonicalPath } from '@/domain/search-visibility';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCategoryBySlug, getCategoryTree } from '@/application/catalog-service';
import { getDb } from '@/infrastructure/db/client';
import { categories } from '@/infrastructure/db/schema';
import { eq } from 'drizzle-orm';
import { Breadcrumbs } from '@/components/ui';
import { ProductListing, type RawSearchParams } from '@/components/product-listing';
import { siteUrl } from '@/application/settings-service';
import { listingRobots } from '@/lib/seo';
import { toPersianDigits } from '@/lib/fa';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<RawSearchParams>;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const category = await getCategoryBySlug(decodeURIComponent(slug));
  if (!category) return { title: 'دسته یافت نشد' };

  return {
    title: category.seoTitle ?? category.nameFa,
    description: category.seoDescription ?? category.description ?? `خرید ${category.nameFa} با مشخصات فنی کامل.`,
    alternates: { canonical: canonicalPath({ kind: 'category', slug: category.slug }) },
    // Filtered variants of a category listing are noindex, follow (ADR-004).
    robots: listingRobots(query),
    openGraph: {
      title: category.nameFa,
      description: category.description ?? undefined,
      url: `${siteUrl()}/categories/${encodeURIComponent(category.slug)}`,
      images: category.imageUrl ? [{ url: category.imageUrl }] : undefined,
    },
  };
}

export default async function CategoryPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const decoded = decodeURIComponent(slug);
  const category = await getCategoryBySlug(decoded);
  if (!category || !category.isActive) notFound();

  const [parent, tree] = await Promise.all([
    category.parentId
      ? getDb().select().from(categories).where(eq(categories.id, category.parentId)).limit(1).then((r) => r[0] ?? null)
      : Promise.resolve(null),
    getCategoryTree(),
  ]);

  const node = findNode(tree, category.slug);

  const crumbs = [
    { label: 'خانه', href: '/' },
    { label: 'دسته‌بندی‌ها', href: '/categories' },
    ...(parent ? [{ label: parent.nameFa, href: `/categories/${encodeURIComponent(parent.slug)}` }] : []),
    { label: category.nameFa },
  ];

  return (
    <div className="container-page py-6">
      <Breadcrumbs items={crumbs} />

      <header className="mb-6">
        <h1 className="text-xl font-extrabold text-steel-900 sm:text-2xl">{category.nameFa}</h1>
        {category.description && (
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">{category.description}</p>
        )}
        {node && node.children.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {node.children.map((child) => (
              <li key={child.slug}>
                <Link
                  href={`/categories/${encodeURIComponent(child.slug)}`}
                  className="inline-block rounded-lg border border-line bg-white px-3 py-1.5 text-sm font-semibold text-steel-700 hover:border-steel-300 hover:bg-steel-50"
                >
                  {child.nameFa}
                  <span className="ms-1.5 text-xs font-normal text-muted">{toPersianDigits(child.productCount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </header>

      <ProductListing
        searchParams={query}
        overrides={{ category: category.slug }}
        lockCategory
        emptyTitle={`فعلاً کالایی در «${category.nameFa}» موجود نیست`}
        emptyDescription="فیلترها را بردارید یا دستهٔ دیگری را ببینید."
      />
    </div>
  );
}

function findNode(tree: Awaited<ReturnType<typeof getCategoryTree>>, slug: string) {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const child = node.children.find((c) => c.slug === slug);
    if (child) return { ...child, children: [] as typeof node.children };
  }
  return null;
}

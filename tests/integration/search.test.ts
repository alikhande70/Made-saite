/**
 * Persian search and filtering. Covers the normalisation the storefront depends
 * on: Arabic vs Persian letter forms, Persian vs Latin digits, ZWNJ, part
 * numbers, and vehicle fitment narrowing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '@/infrastructure/db/client';
import {
  getFacets, getProductBySlug, getRelatedProducts, getSimilarByVehicle,
  getCategoryTree, getVehicleTree, searchProducts, suggest,
} from '@/application/catalog-service';
import { productQuerySchema } from '@/lib/validation';
import { addFitment, createBrand, createCategory, createProduct, createVehicle, resetDatabase } from '../helpers/factory';

const q = (params: Record<string, unknown>) => searchProducts(productQuerySchema.parse(params));

beforeEach(resetDatabase);
afterAll(closePool);

describe('Persian text normalisation in search', () => {
  it('matches Arabic yeh/kaf against the Persian spelling', async () => {
    await createProduct({ titleFa: 'لنت ترمز جلو کیا سراتو' });
    expect((await q({ q: 'كيا' })).total).toBe(1); // Arabic ك and ي
    expect((await q({ q: 'کیا' })).total).toBe(1); // Persian ک and ی
  });

  it('matches Persian and Arabic-Indic digits against Latin digits', async () => {
    await createProduct({ titleFa: 'لنت ترمز پژو 206' });
    expect((await q({ q: 'پژو ۲۰۶' })).total).toBe(1);
    expect((await q({ q: 'پژو ٢٠٦' })).total).toBe(1);
    expect((await q({ q: 'پژو 206' })).total).toBe(1);
  });

  it('treats a zero-width non-joiner as a word break', async () => {
    await createProduct({ titleFa: 'فیلتر‌هوا موتور ملی' });
    expect((await q({ q: 'فیلتر هوا' })).total).toBe(1);
  });

  it('ignores harakat', async () => {
    await createProduct({ titleFa: 'محرک دریچه گاز' });
    expect((await q({ q: 'مُحَرِّک' })).total).toBe(1);
  });
});

describe('part-number search', () => {
  it('finds a product by its exact SKU', async () => {
    await createProduct({ sku: 'BRK-PAD-206F', titleFa: 'لنت ترمز' });
    await createProduct({ sku: 'FLT-OIL-001', titleFa: 'فیلتر روغن' });
    const r = await q({ q: 'BRK-PAD-206F' });
    expect(r.total).toBe(1);
    expect(r.items[0]!.sku).toBe('BRK-PAD-206F');
  });

  it('finds products by a partial SKU prefix', async () => {
    await createProduct({ sku: 'BRK-PAD-206F' });
    await createProduct({ sku: 'BRK-PAD-405F' });
    await createProduct({ sku: 'FLT-OIL-001' });
    expect((await q({ q: 'BRK-PAD' })).total).toBe(2);
  });

  it('finds a product by OEM number, case-insensitively', async () => {
    await createProduct({ oemNumber: '1109AY', titleFa: 'فیلتر روغن' });
    expect((await q({ q: '1109AY' })).total).toBe(1);
    expect((await q({ q: '1109ay' })).total).toBe(1);
  });

  it('ranks an exact part-number hit above a title mention', async () => {
    await createProduct({ sku: 'OTHER-1', titleFa: 'مجموعه شامل قطعه 1109AY' });
    const target = await createProduct({ sku: 'REAL-1', oemNumber: '1109AY', titleFa: 'فیلتر روغن' });
    const r = await q({ q: '1109AY' });
    expect(r.items[0]!.id).toBe(target.id);
  });
});

describe('fuzzy matching', () => {
  it('tolerates a small typo', async () => {
    await createProduct({ titleFa: 'فیلتر روغن پژو ۲۰۶' });
    expect((await q({ q: 'فیلتر روغنن' })).total).toBe(1);
  });

  it('returns nothing for an unrelated query', async () => {
    await createProduct({ titleFa: 'فیلتر روغن پژو ۲۰۶' });
    expect((await q({ q: 'یخچال فریزر ساید بای ساید' })).total).toBe(0);
  });
});

describe('filters', () => {
  it('includes descendants when filtering by a parent category', async () => {
    const parent = await createCategory('فیلترها');
    const { getDb } = await import('@/infrastructure/db/client');
    const { categories } = await import('@/infrastructure/db/schema');
    const [child] = await getDb().insert(categories)
      .values({ slug: 'child-oil', nameFa: 'فیلتر روغن', parentId: parent.id, isActive: true })
      .returning();

    await createProduct({ categoryId: parent.id });
    await createProduct({ categoryId: child!.id });
    await createProduct();

    expect((await q({ category: parent.slug })).total).toBe(2);
    expect((await q({ category: 'child-oil' })).total).toBe(1);
  });

  it('filters by brand, price band and availability', async () => {
    const bosch = await createBrand('بوش');
    const other = await createBrand('والئو');
    await createProduct({ brandId: bosch.id, price: 500_000, stock: 5 });
    await createProduct({ brandId: bosch.id, price: 3_000_000, stock: 0 });
    await createProduct({ brandId: other.id, price: 900_000, stock: 5 });

    expect((await q({ brand: bosch.slug })).total).toBe(2);
    expect((await q({ minPrice: 400_000, maxPrice: 1_000_000 })).total).toBe(2);
    expect((await q({ inStock: true })).total).toBe(2);
    expect((await q({ brand: bosch.slug, inStock: true })).total).toBe(1);
  });

  it('uses the sale price for price filtering, not the list price', async () => {
    await createProduct({ price: 2_000_000, salePrice: 700_000 });
    expect((await q({ maxPrice: 1_000_000 })).total).toBe(1);
    expect((await q({ minPrice: 1_500_000 })).total).toBe(0);
  });

  it('hides inactive products from every storefront query', async () => {
    await createProduct({ isActive: false, titleFa: 'پیش‌نویس محصول' });
    expect((await q({})).total).toBe(0);
    expect((await q({ q: 'پیش‌نویس' })).total).toBe(0);
  });
});

describe('vehicle compatibility filtering', () => {
  it('narrows by model, then engine, then production year', async () => {
    const { model, engine } = await createVehicle();
    const anyEngine = await createProduct({ titleFa: 'باتری ۶۰ آمپر' });
    const tu5Only = await createProduct({ titleFa: 'واشر سرسیلندر TU5' });
    const oldOnly = await createProduct({ titleFa: 'چراغ جلو مدل قدیم' });
    await createProduct({ titleFa: 'قطعهٔ بی‌ربط' });

    await addFitment(anyEngine.id, model.id, null);
    await addFitment(tu5Only.id, model.id, engine.id);
    await addFitment(oldOnly.id, model.id, null, { from: 1380, to: 1390 });

    expect((await q({ vehicleModel: model.slug })).total).toBe(3);
    // Engine-specific search still includes parts that fit every engine.
    expect((await q({ vehicleModel: model.slug, vehicleEngine: 'TU5' })).total).toBe(3);
    expect((await q({ vehicleModel: model.slug, vehicleYear: 1400 })).total).toBe(2);
    expect((await q({ vehicleModel: model.slug, vehicleYear: 1385 })).total).toBe(3);
  });

  it('combines a vehicle filter with a text query', async () => {
    const { model } = await createVehicle();
    const a = await createProduct({ titleFa: 'لنت ترمز جلو' });
    const b = await createProduct({ titleFa: 'فیلتر روغن' });
    await addFitment(a.id, model.id);
    await addFitment(b.id, model.id);

    const r = await q({ vehicleModel: model.slug, q: 'لنت' });
    expect(r.total).toBe(1);
    expect(r.items[0]!.id).toBe(a.id);
  });
});

describe('sorting and pagination', () => {
  it('sorts by price in both directions', async () => {
    await createProduct({ price: 3_000_000 });
    await createProduct({ price: 1_000_000 });
    await createProduct({ price: 2_000_000 });

    expect((await q({ sort: 'price-asc' })).items.map((i) => i.effectivePrice))
      .toEqual([1_000_000, 2_000_000, 3_000_000]);
    expect((await q({ sort: 'price-desc' })).items.map((i) => i.effectivePrice))
      .toEqual([3_000_000, 2_000_000, 1_000_000]);
  });

  it('paginates deterministically with no duplicates across pages', async () => {
    for (let i = 0; i < 12; i += 1) await createProduct({ price: 1_000_000 });

    const p1 = await q({ perPage: 5, page: 1 });
    const p2 = await q({ perPage: 5, page: 2 });
    const p3 = await q({ perPage: 5, page: 3 });

    expect(p1.total).toBe(12);
    expect(p1.totalPages).toBe(3);
    expect(p3.items).toHaveLength(2);

    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(12);
  });

  it('returns identical results for repeated identical queries', async () => {
    for (let i = 0; i < 6; i += 1) await createProduct({ price: 1_000_000 });
    const a = await q({ perPage: 3, page: 1 });
    const b = await q({ perPage: 3, page: 1 });
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });
});

describe('facets', () => {
  it('keeps every brand visible after a brand is selected', async () => {
    const bosch = await createBrand('بوش');
    const valeo = await createBrand('والئو');
    await createProduct({ brandId: bosch.id, price: 500_000 });
    await createProduct({ brandId: valeo.id, price: 900_000 });

    const facets = await getFacets(productQuerySchema.parse({ brand: bosch.slug }));
    expect(facets.brands).toHaveLength(2);
    // The price range does reflect the active filter.
    expect(facets.priceRange).toEqual({ min: 500_000, max: 500_000 });
  });
});

describe('product detail and recommendations', () => {
  it('loads images, specs, fitments and stock status', async () => {
    const category = await createCategory();
    const brand = await createBrand();
    const { model, engine } = await createVehicle();
    const p = await createProduct({ categoryId: category.id, brandId: brand.id, stock: 2, lowStockThreshold: 3 });
    await addFitment(p.id, model.id, engine.id, { from: 1390, to: 1402 });

    const detail = await getProductBySlug(p.slug);
    expect(detail).not.toBeNull();
    expect(detail!.images).toHaveLength(1);
    expect(detail!.brand!.id).toBe(brand.id);
    expect(detail!.category!.id).toBe(category.id);
    expect(detail!.compatibility).toHaveLength(1);
    expect(detail!.compatibility[0]!.engineCode).toBe('TU5');
    expect(detail!.stockStatus).toBe('LOW_STOCK');
  });

  it('does not expose an inactive product by slug', async () => {
    const p = await createProduct({ isActive: false });
    expect(await getProductBySlug(p.slug)).toBeNull();
    expect(await getProductBySlug(p.slug, { includeInactive: true })).not.toBeNull();
  });

  it('suggests related parts from the same category, excluding itself', async () => {
    const category = await createCategory();
    const p = await createProduct({ categoryId: category.id });
    await createProduct({ categoryId: category.id });
    await createProduct();

    const related = await getRelatedProducts(p.id, category.id);
    expect(related).toHaveLength(1);
    expect(related.map((r) => r.id)).not.toContain(p.id);
  });

  it('suggests parts that fit the same vehicle', async () => {
    const { model } = await createVehicle();
    const p = await createProduct();
    const sameCar = await createProduct();
    await createProduct();
    await addFitment(p.id, model.id);
    await addFitment(sameCar.id, model.id);

    const similar = await getSimilarByVehicle(p.id);
    expect(similar.map((s) => s.id)).toEqual([sameCar.id]);
  });
});

describe('taxonomy trees', () => {
  it('nests categories and counts products across the subtree', async () => {
    const parent = await createCategory('فیلترها');
    const { getDb } = await import('@/infrastructure/db/client');
    const { categories } = await import('@/infrastructure/db/schema');
    const [child] = await getDb().insert(categories)
      .values({ slug: 'sub-1', nameFa: 'فیلتر روغن', parentId: parent.id, isActive: true }).returning();
    await createProduct({ categoryId: child!.id });
    await createProduct({ categoryId: parent.id });

    const tree = await getCategoryTree();
    const root = tree.find((t) => t.id === parent.id)!;
    expect(root.children).toHaveLength(1);
    expect(root.productCount).toBe(2);
    expect(root.children[0]!.productCount).toBe(1);
  });

  it('nests vehicle models under their brand', async () => {
    await createVehicle();
    const tree = await getVehicleTree();
    expect(tree).toHaveLength(1);
    expect(tree[0]!.models).toHaveLength(1);
    expect(tree[0]!.models[0]!.nameFa).toBe('پژو ۲۰۶');
  });
});

describe('suggestions', () => {
  it('returns matches for two or more characters and nothing below that', async () => {
    await createProduct({ titleFa: 'لنت ترمز جلو پژو ۲۰۶' });
    expect(await suggest('ل')).toHaveLength(0);
    expect((await suggest('لنت')).length).toBeGreaterThan(0);
  });

  it('never suggests an inactive product', async () => {
    await createProduct({ titleFa: 'لنت ترمز مخفی', isActive: false });
    expect(await suggest('لنت')).toHaveLength(0);
  });
});

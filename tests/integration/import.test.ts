/**
 * The transactional half of bulk import: reference resolution, all-or-nothing
 * commit, and the guarantees that stop an import from damaging live orders.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { closePool, getDb } from '@/infrastructure/db/client';
import { inventory, products } from '@/infrastructure/db/schema';
import { commitImport, getImportJob, validateImport } from '@/application/import-service';
import { evaluateProductForConfiguration, getOrCreateConfiguration, listProductReferences } from '@/application/fitment-service';
import {
  createBrand, createCategory, createProduct, createTrim, createUser, createVehicle, resetDatabase, stockOf,
} from '../helpers/factory';

beforeEach(resetDatabase);
afterAll(closePool);

const HEADER = 'sku,title_fa,brand,category,price,stock,fitment,references';

async function validate(csv: string, actorUserId: string | null = null) {
  return validateImport(csv, { filename: 'supplier.csv', actorUserId });
}

describe('validation against the live catalogue', () => {
  it('rejects a brand, category or vehicle the store does not define', async () => {
    const preview = await validate(
      `${HEADER}\nNEW-1,فیلتر روغن,ghost-brand,ghost-category,100000,5,ghost-model||||DIRECT,`,
    );
    expect(preview.validRows).toBe(0);
    expect(preview.status).toBe('FAILED');
    const messages = preview.errors.map((e) => e.message).join(' ');
    expect(messages).toContain('ghost-brand');
    expect(messages).toContain('ghost-category');
    expect(messages).toContain('ghost-model');
  });

  it('rejects an engine or trim that does not belong to the named model', async () => {
    const { model } = await createVehicle();
    const preview = await validate(`${HEADER}\nNEW-1,قطعه,,,100000,1,${model.slug}|XU7|||DIRECT,`);
    expect(preview.validRows).toBe(0);
    expect(preview.errors[0]!.message).toContain('XU7');
  });

  it('requires a name and price for a product that does not exist yet', async () => {
    const preview = await validate(`sku,stock\nBRAND-NEW-1,5`);
    expect(preview.validRows).toBe(0);
    const messages = preview.errors.map((e) => e.message).join(' ');
    expect(messages).toContain('بدون نام');
    expect(messages).toContain('بدون قیمت');
  });

  it('catches a price that would sit below the product’s existing sale price', async () => {
    const existing = await createProduct({ sku: 'SALE-1', titleFa: 'کالای تخفیف‌دار', price: 1_000_000 });
    await getDb().update(products).set({ salePrice: 900_000 }).where(eq(products.id, existing.id));

    // Lowering the price alone would leave a "discount" above the price.
    const bad = await validate(`sku,price\n${existing.sku},500000`);
    expect(bad.validRows).toBe(0);
    expect(bad.errors[0]!.message).toContain('سازگار نیست');

    // Supplying both together is fine.
    const good = await validate(`sku,price,sale_price\n${existing.sku},500000,450000`);
    expect(good.validRows).toBe(1);
  });

  it('allows a partial row for a product that already exists', async () => {
    const existing = await createProduct({ sku: 'EXIST-1', titleFa: 'کالای موجود' });
    const preview = await validate(`sku,stock\n${existing.sku},7`);
    expect(preview.validRows).toBe(1);
    expect(preview.willUpdate).toBe(1);
    expect(preview.willCreate).toBe(0);
  });

  it('writes nothing during validation', async () => {
    const before = await getDb().select({ id: products.id }).from(products);
    await validate(`${HEADER}\nNEW-1,فیلتر,,,100000,5,,`);
    const after = await getDb().select({ id: products.id }).from(products);
    expect(after).toHaveLength(before.length);
  });
});

describe('committing a validated job', () => {
  it('creates products, sets stock and records fitment and references', async () => {
    const brand = await createBrand('مان فیلتر');
    const category = await createCategory('فیلتر روغن');
    const { model, engine } = await createVehicle();
    const admin = await createUser('admin', '09120000099');

    const preview = await validate(
      `${HEADER}\n` +
      `IMP-1,فیلتر روغن وارداتی,${brand.slug},${category.slug},۳۸۵٬۰۰۰,۱۲,${model.slug}|${engine.code}|||DIRECT,CROSS_REFERENCE:OC90:Mahle`,
      admin.id,
    );
    expect(preview.validRows).toBe(1);

    const result = await commitImport(preview.jobId, admin.id);
    expect(result).toMatchObject({ created: 1, updated: 0 });

    const [created] = await getDb().select().from(products).where(eq(products.sku, 'IMP-1'));
    expect(created!.titleFa).toBe('فیلتر روغن وارداتی');
    // Persian digits and separators must survive as a real integer price.
    expect(created!.price).toBe(385_000);
    expect((await stockOf(created!.id)).quantityOnHand).toBe(12);

    const configurationId = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    expect((await evaluateProductForConfiguration(created!.id, configurationId)).verdict).toBe('COMPATIBLE');

    const refs = await listProductReferences(created!.id);
    expect(refs[0]).toMatchObject({ relationType: 'CROSS_REFERENCE', targetNumber: 'OC90', targetBrand: 'Mahle' });
  });

  it('leaves untouched columns alone when updating', async () => {
    const existing = await createProduct({ sku: 'UPD-1', titleFa: 'نام اصلی', price: 500_000 });
    const preview = await validate(`sku,price\n${existing.sku},۶۰۰۰۰۰`);
    await commitImport(preview.jobId, null);

    const [row] = await getDb().select().from(products).where(eq(products.id, existing.id));
    expect(row!.price).toBe(600_000);
    expect(row!.titleFa).toBe('نام اصلی');
  });

  it('gives two new rows with the same title distinct slugs', async () => {
    const preview = await validate(`sku,title_fa,price\nA-1,لنت ترمز,100000\nA-2,لنت ترمز,120000`);
    await commitImport(preview.jobId, null);
    const rows = await getDb().select({ slug: products.slug }).from(products);
    expect(new Set(rows.map((r) => r.slug)).size).toBe(rows.length);
  });

  it('rolls the whole file back when one row fails', async () => {
    const held = await createProduct({ sku: 'HELD-1', titleFa: 'کالای رزروشده', stock: 5 });
    // Simulate an open order holding stock.
    await getDb().update(inventory).set({ quantityReserved: 4 }).where(eq(inventory.productId, held.id));

    const preview = await validate(
      `sku,title_fa,price,stock\nOK-1,کالای سالم,100000,10\n${held.sku},,,1`,
    );
    expect(preview.validRows).toBe(2);

    // Row 2 would push on-hand below the 4 reserved units.
    await expect(commitImport(preview.jobId, null)).rejects.toThrow(/رزرو/);

    // The good row must not have survived the failed transaction.
    const created = await getDb().select().from(products).where(eq(products.sku, 'OK-1'));
    expect(created).toHaveLength(0);
    expect((await stockOf(held.id)).quantityOnHand).toBe(5);

    const job = await getImportJob(preview.jobId);
    expect(job!.status).toBe('VALIDATED'); // not marked committed
  });

  it('refuses to apply the same job twice', async () => {
    const preview = await validate(`sku,title_fa,price\nONCE-1,کالا,100000`);
    await commitImport(preview.jobId, null);
    await expect(commitImport(preview.jobId, null)).rejects.toThrow(/قبلاً اعمال شده/);
  });

  it('refuses a job that was never validated successfully', async () => {
    const preview = await validate(`${HEADER}\nBAD-1,کالا,ghost-brand,,100000,1,,`);
    expect(preview.status).toBe('FAILED');
    await expect(commitImport(preview.jobId, null)).rejects.toThrow();
  });

  it('re-checks references at commit time, not just at preview', async () => {
    const category = await createCategory('فیلتر');
    const preview = await validate(`${HEADER}\nLATE-1,کالا,,${category.slug},100000,1,,`);
    expect(preview.validRows).toBe(1);

    // The catalogue changes between preview and apply.
    await resetDatabase();

    await expect(commitImport(preview.jobId, null)).rejects.toThrow();
  });

  it('records an unchanged stock value without reporting a change', async () => {
    const existing = await createProduct({ sku: 'SAME-1', titleFa: 'کالا', stock: 8 });
    const preview = await validate(`sku,stock\n${existing.sku},8`);
    const result = await commitImport(preview.jobId, null);
    expect(result.stockAdjusted).toBe(0);
  });

  it('replaces a product’s fitment set rather than appending to it', async () => {
    const { model, engine } = await createVehicle();
    const trim = await createTrim(model.id);

    const first = await validate(`${HEADER}\nFIT-1,کالا,,,100000,1,${model.slug}|${engine.code}|||DIRECT,`);
    await commitImport(first.jobId, null);

    const second = await validate(`${HEADER}\nFIT-1,,,,,,${model.slug}||${trim.code}||NOT_COMPATIBLE,`);
    await commitImport(second.jobId, null);

    const [row] = await getDb().select({ id: products.id }).from(products).where(eq(products.sku, 'FIT-1'));
    const engineConfig = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    // The DIRECT row is gone, so the engine-only vehicle is now undecided.
    expect((await evaluateProductForConfiguration(row!.id, engineConfig)).verdict).toBe('UNKNOWN');

    const trimConfig = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleTrimId: trim.id });
    expect((await evaluateProductForConfiguration(row!.id, trimConfig)).verdict).toBe('INCOMPATIBLE');
  });
});

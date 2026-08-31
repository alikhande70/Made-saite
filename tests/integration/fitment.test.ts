/**
 * Fitment resolution, «گاراژ من» and the curated landing pages, against a real
 * database.
 *
 * The unit tests in tests/unit/fitment.test.ts prove the matching *rules*;
 * these prove the queries that feed them — configuration de-duplication,
 * ownership scoping, and the inventory counts that decide indexability.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '@/infrastructure/db/client';
import {
  evaluateManyForConfiguration,
  evaluateProductForConfiguration,
  getConfiguration,
  getOrCreateConfiguration,
  listProductReferences,
  setProductFitments,
  setProductReferences,
} from '@/application/fitment-service';
import {
  addVehicle, getDefaultVehicle, listGarage, MAX_GARAGE_VEHICLES, removeVehicle, setDefaultVehicle,
} from '@/application/garage-service';
import { getVehicleLandingPage, listVehicleLandingPages, searchProducts } from '@/application/catalog-service';
import { productQuerySchema } from '@/lib/validation';
import {
  addFitment, createCategory, createProduct, createTrim, createUser, createVehicle, resetDatabase,
} from '../helpers/factory';

beforeEach(resetDatabase);
afterAll(closePool);

describe('vehicle configurations', () => {
  it('returns the same configuration for the same tuple instead of duplicating it', async () => {
    const { model, engine } = await createVehicle();
    const a = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    const b = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    expect(b).toBe(a);
  });

  it('treats a narrowed tuple as a different configuration', async () => {
    const { model, engine } = await createVehicle();
    const trim = await createTrim(model.id);
    const broad = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    const narrow = await getOrCreateConfiguration({
      vehicleModelId: model.id, vehicleEngineId: engine.id, vehicleTrimId: trim.id,
    });
    expect(narrow).not.toBe(broad);
  });

  it('survives concurrent creation of the same tuple', async () => {
    const { model } = await createVehicle();
    const ids = await Promise.all(
      Array.from({ length: 8 }, () => getOrCreateConfiguration({ vehicleModelId: model.id, yearFrom: 1395, yearTo: 1395 })),
    );
    expect(new Set(ids).size).toBe(1);
  });

  it('refuses a model that does not exist, rather than leaking a constraint error', async () => {
    await expect(
      getOrCreateConfiguration({ vehicleModelId: '11111111-1111-1111-1111-111111111111' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a trim or engine belonging to a different model', async () => {
    const a = await createVehicle();
    const b = await createVehicle();
    const trimOfB = await createTrim(b.model.id, 'OTHER', 'تیپ دیگر');

    /*
     * Each narrowing column has its own foreign key, so the database is happy
     * to pair one model with another model's engine. Only this check stops a
     * configuration describing a car that does not exist.
     */
    await expect(
      getOrCreateConfiguration({ vehicleModelId: a.model.id, vehicleEngineId: b.engine.id }),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      getOrCreateConfiguration({ vehicleModelId: a.model.id, vehicleTrimId: trimOfB.id }),
    ).rejects.toMatchObject({ status: 422 });

    // The matching pair still works.
    await expect(
      getOrCreateConfiguration({ vehicleModelId: b.model.id, vehicleEngineId: b.engine.id }),
    ).resolves.toBeTruthy();
  });

  it('resolves a configuration to readable Persian names', async () => {
    const { model, engine } = await createVehicle();
    const id = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    const resolved = await getConfiguration(id);
    expect(resolved).not.toBeNull();
    expect(resolved!.modelNameFa).toBe('پژو ۲۰۶');
    expect(resolved!.engineCode).toBe('TU5');
  });
});

describe('compatibility against a stored vehicle', () => {
  it('reports a definitive fit, a definitive exclusion, and honest uncertainty', async () => {
    const { model, engine } = await createVehicle();
    const trim = await createTrim(model.id, 'TIP5', 'تیپ ۵');

    const fits = await createProduct({ titleFa: 'لنت سازگار' });
    const excluded = await createProduct({ titleFa: 'لنت ناسازگار' });
    const unknown = await createProduct({ titleFa: 'قطعهٔ بدون داده' });

    await addFitment(fits.id, model.id, engine.id);
    await addFitment(excluded.id, model.id, engine.id, {}, { type: 'NOT_COMPATIBLE', note: 'قطر دیسک متفاوت است' });

    const configurationId = await getOrCreateConfiguration({
      vehicleModelId: model.id, vehicleEngineId: engine.id, vehicleTrimId: trim.id,
    });

    expect((await evaluateProductForConfiguration(fits.id, configurationId)).verdict).toBe('COMPATIBLE');

    const no = await evaluateProductForConfiguration(excluded.id, configurationId);
    expect(no.verdict).toBe('INCOMPATIBLE');
    expect(no.reasonFa).toContain('قطر دیسک متفاوت است');

    // No recorded row must never become "does not fit".
    expect((await evaluateProductForConfiguration(unknown.id, configurationId)).verdict).toBe('UNKNOWN');
  });

  it('lets a specific exclusion override a broader fit', async () => {
    const { model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'دیسک ترمز' });
    await addFitment(product.id, model.id, null);                                   // fits the model
    await addFitment(product.id, model.id, engine.id, {}, { type: 'NOT_COMPATIBLE' }); // except this engine

    const withEngine = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    expect((await evaluateProductForConfiguration(product.id, withEngine)).verdict).toBe('INCOMPATIBLE');

    const modelOnly = await getOrCreateConfiguration({ vehicleModelId: model.id });
    expect((await evaluateProductForConfiguration(product.id, modelOnly)).verdict).toBe('COMPATIBLE');
  });

  it('evaluates a whole page of products in one query', async () => {
    const { model, engine } = await createVehicle();
    const a = await createProduct({ titleFa: 'الف' });
    const b = await createProduct({ titleFa: 'ب' });
    const c = await createProduct({ titleFa: 'ج' });
    await addFitment(a.id, model.id, engine.id);
    await addFitment(b.id, model.id, engine.id, {}, { type: 'NOT_COMPATIBLE' });

    const configurationId = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    const map = await evaluateManyForConfiguration([a.id, b.id, c.id], configurationId);

    expect(map.get(a.id)!.verdict).toBe('COMPATIBLE');
    expect(map.get(b.id)!.verdict).toBe('INCOMPATIBLE');
    // A product with no rows still gets an entry, so an unbadged card is impossible.
    expect(map.get(c.id)!.verdict).toBe('UNKNOWN');
  });

  it('excludes a part from the vehicle listing when the only row is an exclusion', async () => {
    const { model, engine } = await createVehicle();
    const excluded = await createProduct({ titleFa: 'قطعهٔ کنارگذاشته' });
    await addFitment(excluded.id, model.id, engine.id, {}, { type: 'NOT_COMPATIBLE' });

    const results = await searchProducts(productQuerySchema.parse({ vehicleModel: model.slug }));
    expect(results.items.map((i) => i.id)).not.toContain(excluded.id);
  });
});

describe('product references', () => {
  it('stores typed part-number relations and links the ones we stock', async () => {
    const original = await createProduct({ titleFa: 'فیلتر قدیمی', sku: 'OLD-1' });
    const replacement = await createProduct({ titleFa: 'فیلتر جدید', sku: 'NEW-1' });

    await setProductReferences(original.id, [
      { relationType: 'SUPERSEDED_BY', targetProductId: replacement.id },
      { relationType: 'CROSS_REFERENCE', targetNumber: 'W 712/52', targetBrand: 'MANN' },
      // A row with neither a target product nor a number is not a reference.
      { relationType: 'ALTERNATE', targetNumber: '   ' },
    ]);

    const refs = await listProductReferences(original.id);
    expect(refs).toHaveLength(2);
    expect(refs.find((r) => r.relationType === 'SUPERSEDED_BY')!.target!.sku).toBe('NEW-1');
    expect(refs.find((r) => r.relationType === 'CROSS_REFERENCE')!.target).toBeNull();
  });

  it('replaces the whole set rather than accumulating duplicates', async () => {
    const product = await createProduct({ titleFa: 'قطعه' });
    await setProductReferences(product.id, [{ relationType: 'CROSS_REFERENCE', targetNumber: 'A-1' }]);
    await setProductReferences(product.id, [{ relationType: 'CROSS_REFERENCE', targetNumber: 'B-2' }]);
    const refs = await listProductReferences(product.id);
    expect(refs.map((r) => r.targetNumber)).toEqual(['B-2']);
  });
});

describe('«گاراژ من»', () => {
  it('makes the first saved vehicle the default and keeps exactly one', async () => {
    const user = await createUser();
    const { model, engine } = await createVehicle();

    const first = await addVehicle(user.id, { vehicleModelId: model.id });
    expect(first.isDefault).toBe(true);

    const second = await addVehicle(user.id, { vehicleModelId: model.id, vehicleEngineId: engine.id, makeDefault: true });
    const garage = await listGarage(user.id);
    expect(garage.filter((v) => v.isDefault)).toHaveLength(1);
    expect((await getDefaultVehicle(user.id))!.id).toBe(second.id);
  });

  it('promotes another vehicle when the default is removed', async () => {
    const user = await createUser();
    const { model, engine } = await createVehicle();
    const first = await addVehicle(user.id, { vehicleModelId: model.id });
    await addVehicle(user.id, { vehicleModelId: model.id, vehicleEngineId: engine.id });

    await removeVehicle(user.id, first.id);
    const remaining = await listGarage(user.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.isDefault).toBe(true);
  });

  it('refuses to touch another customer’s vehicle', async () => {
    const owner = await createUser('customer', '09120000011');
    const attacker = await createUser('customer', '09120000012');
    const { model } = await createVehicle();
    const vehicle = await addVehicle(owner.id, { vehicleModelId: model.id });

    // Ownership lives in the WHERE clause, so a foreign id simply matches nothing.
    await expect(removeVehicle(attacker.id, vehicle.id)).rejects.toThrow();
    await expect(setDefaultVehicle(attacker.id, vehicle.id)).rejects.toThrow();
    expect(await listGarage(owner.id)).toHaveLength(1);
  });

  it('caps the garage size', async () => {
    const user = await createUser();
    const { model } = await createVehicle();
    for (let year = 1380; year < 1380 + MAX_GARAGE_VEHICLES; year += 1) {
      await addVehicle(user.id, { vehicleModelId: model.id, yearFrom: year, yearTo: year });
    }
    await expect(
      addVehicle(user.id, { vehicleModelId: model.id, yearFrom: 1399, yearTo: 1399 }),
    ).rejects.toThrow();
  });
});

describe('curated landing pages (ADR-004)', () => {
  it('counts only live products with a non-excluding fitment', async () => {
    const category = await createCategory('لنت ترمز');
    const { model } = await createVehicle();

    const live = await Promise.all([
      createProduct({ titleFa: 'لنت ۱', categoryId: category.id }),
      createProduct({ titleFa: 'لنت ۲', categoryId: category.id }),
      createProduct({ titleFa: 'لنت ۳', categoryId: category.id }),
    ]);
    for (const p of live) await addFitment(p.id, model.id);

    const excluded = await createProduct({ titleFa: 'لنت ناسازگار', categoryId: category.id });
    await addFitment(excluded.id, model.id, null, {}, { type: 'NOT_COMPATIBLE' });

    const inactive = await createProduct({ titleFa: 'لنت غیرفعال', categoryId: category.id, isActive: false });
    await addFitment(inactive.id, model.id);

    const page = await getVehicleLandingPage(category.slug, model.slug);
    expect(page!.productCount).toBe(3);

    const indexable = await listVehicleLandingPages(3);
    expect(indexable.some((p) => p.categorySlug === category.slug && p.modelSlug === model.slug)).toBe(true);
  });

  it('keeps a thin pairing out of the indexable set', async () => {
    const category = await createCategory('دیسک ترمز');
    const { model } = await createVehicle();
    const only = await createProduct({ titleFa: 'دیسک تنها', categoryId: category.id });
    await addFitment(only.id, model.id);

    expect((await getVehicleLandingPage(category.slug, model.slug))!.productCount).toBe(1);
    const indexable = await listVehicleLandingPages(3);
    expect(indexable.some((p) => p.categorySlug === category.slug && p.modelSlug === model.slug)).toBe(false);
  });

  it('returns null for a pairing whose category or vehicle does not exist', async () => {
    const { model } = await createVehicle();
    expect(await getVehicleLandingPage('no-such-category', model.slug)).toBeNull();
    const category = await createCategory('فیلتر');
    expect(await getVehicleLandingPage(category.slug, 'no-such-model')).toBeNull();
  });
});

describe('admin fitment writes', () => {
  it('replaces a product’s fitment set and creates configurations on demand', async () => {
    const { model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });

    await setProductFitments(product.id, [
      { vehicleModelId: model.id, vehicleEngineId: engine.id, fitmentType: 'DIRECT' },
      { vehicleModelId: model.id, yearFrom: 1390, yearTo: 1395, fitmentType: 'WITH_MODIFICATION', note: 'نیازمند تغییر' },
    ]);

    const configurationId = await getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id });
    expect((await evaluateProductForConfiguration(product.id, configurationId)).verdict).toBe('COMPATIBLE');

    await setProductFitments(product.id, []);
    expect((await evaluateProductForConfiguration(product.id, configurationId)).verdict).toBe('UNKNOWN');
  });
});

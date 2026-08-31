/**
 * Vehicle taxonomy administration.
 *
 * The load-bearing behaviour here is deletion. `vehicle_models` cascades down
 * through configurations to fitments, so a careless DELETE destroys
 * compatibility data and silently turns a product's «سازگار» into
 * «اطلاعات کافی نیست». These tests assert that cannot happen by accident.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closePool } from '@/infrastructure/db/client';
import {
  countDependants, deleteVehicleEntity, getModelDetail, listVehicleTaxonomy,
  upsertVehicleBrand, upsertVehicleChild, upsertVehicleModel,
} from '@/application/vehicle-admin-service';
import { addVehicle, listGarage } from '@/application/garage-service';
import { getOrCreateConfiguration } from '@/application/fitment-service';
import { addFitment, createProduct, createUser, createVehicle, resetDatabase } from '../helpers/factory';

beforeEach(resetDatabase);
afterAll(closePool);

describe('creating taxonomy', () => {
  it('creates a brand, a model and its narrowing entities', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'ایران خودرو', nameEn: 'IKCO', sortOrder: 1 });
    const model = await upsertVehicleModel({
      vehicleBrandId: brand.id, nameFa: 'دنا پلاس', nameEn: 'Dena Plus', yearFrom: 1396, yearTo: 1404,
    });

    await upsertVehicleChild('generation', {
      vehicleModelId: model.id, code: 'GEN1', nameFa: 'نسل اول', yearFrom: 1396, yearTo: 1400,
    });
    await upsertVehicleChild('trim', { vehicleModelId: model.id, code: 'TURBO', nameFa: 'توربو' });
    await upsertVehicleChild('engine', {
      vehicleModelId: model.id, code: 'EF7-TC', nameFa: 'موتور EF7 توربو', displacementCc: 1700, fuelType: 'بنزین',
    });

    const detail = await getModelDetail(model.id);
    expect(detail.generations).toHaveLength(1);
    expect(detail.trims).toHaveLength(1);
    // Technical codes are stored verbatim — slugifying would break the match
    // against a supplier's spreadsheet.
    expect(detail.engines[0]!.code).toBe('EF7-TC');
  });

  it('derives distinct slugs for models sharing a name', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند' });
    const a = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'پژو ۲۰۶', nameEn: 'Peugeot 206' });
    const b = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'پژو ۲۰۶', nameEn: 'Peugeot 206' });

    const taxonomy = await listVehicleTaxonomy();
    const slugs = taxonomy.flatMap((br) => br.models.map((m) => m.slug));
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(a.id).not.toBe(b.id);
  });

  it('rejects an inverted year window and an unknown parent', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند' });
    await expect(
      upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل', yearFrom: 1400, yearTo: 1390 }),
    ).rejects.toThrow(/سال شروع/);
    await expect(
      upsertVehicleModel({ vehicleBrandId: '11111111-1111-1111-1111-111111111111', nameFa: 'مدل' }),
    ).rejects.toThrow(/برند خودرو یافت نشد/);
  });

  it('rejects a trim whose generation belongs to another model', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند' });
    const a = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل الف' });
    const b = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل ب' });
    const generationOfB = await upsertVehicleChild('generation', {
      vehicleModelId: b.id, code: 'G1', nameFa: 'نسل ب',
    });

    await expect(
      upsertVehicleChild('trim', {
        vehicleModelId: a.id, code: 'T1', nameFa: 'تیپ', vehicleGenerationId: generationOfB.id,
      }),
    ).rejects.toThrow(/تعلق ندارد/);
  });

  it('rejects an empty technical code', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند' });
    const model = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل' });
    await expect(
      upsertVehicleChild('engine', { vehicleModelId: model.id, code: '   ', nameFa: 'موتور' }),
    ).rejects.toThrow(/کد فنی/);
  });
});

describe('usage counts', () => {
  it('counts the fitments and saved vehicles that depend on a row', async () => {
    const { model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });
    await addFitment(product.id, model.id, engine.id);

    const user = await createUser();
    await addVehicle(user.id, { vehicleModelId: model.id, vehicleEngineId: engine.id });

    expect(await countDependants('model', model.id)).toEqual({ fitments: 1, savedVehicles: 1 });
    expect(await countDependants('engine', engine.id)).toEqual({ fitments: 1, savedVehicles: 1 });
  });

  it('reports zero for a row nothing references', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند' });
    const model = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل' });
    expect(await countDependants('model', model.id)).toEqual({ fitments: 0, savedVehicles: 0 });
  });

  it('surfaces usage counts on the taxonomy listing', async () => {
    const { model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });
    await addFitment(product.id, model.id, engine.id);
    await upsertVehicleChild('trim', { vehicleModelId: model.id, code: 'T', nameFa: 'تیپ' });

    const taxonomy = await listVehicleTaxonomy();
    const row = taxonomy.flatMap((b) => b.models).find((m) => m.id === model.id)!;
    expect(row.fitmentCount).toBe(1);
    expect(row.engineCount).toBe(1);
    expect(row.trimCount).toBe(1);
  });
});

describe('deletion safety', () => {
  it('refuses to delete a model that fitments depend on, and says why', async () => {
    const { model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });
    await addFitment(product.id, model.id, engine.id);

    await expect(deleteVehicleEntity('model', model.id)).rejects.toThrow(/رکورد سازگاری/);
    // Nothing was removed.
    expect(await countDependants('model', model.id)).toEqual({ fitments: 1, savedVehicles: 0 });
  });

  it('refuses to delete an engine a customer has saved', async () => {
    const { model, engine } = await createVehicle();
    const user = await createUser();
    await addVehicle(user.id, { vehicleModelId: model.id, vehicleEngineId: engine.id });

    await expect(deleteVehicleEntity('engine', engine.id)).rejects.toThrow(/خودروی ذخیره‌شده/);
    expect(await listGarage(user.id)).toHaveLength(1);
  });

  it('refuses to delete a brand when any of its models carry fitments', async () => {
    const { brand, model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });
    await addFitment(product.id, model.id, engine.id);

    await expect(deleteVehicleEntity('brand', brand.id)).rejects.toThrow(/حذف ممکن نیست/);
  });

  it('allows deleting a row nothing depends on', async () => {
    const brand = await upsertVehicleBrand({ nameFa: 'برند بلااستفاده' });
    const model = await upsertVehicleModel({ vehicleBrandId: brand.id, nameFa: 'مدل بلااستفاده' });
    const engine = await upsertVehicleChild('engine', {
      vehicleModelId: model.id, code: 'X1', nameFa: 'موتور',
    });

    await expect(deleteVehicleEntity('engine', engine.id)).resolves.toBeUndefined();
    await expect(deleteVehicleEntity('model', model.id)).resolves.toBeUndefined();
    await expect(deleteVehicleEntity('brand', brand.id)).resolves.toBeUndefined();
    expect(await listVehicleTaxonomy()).toHaveLength(0);
  });

  it('offers deactivation as the alternative to a refused delete', async () => {
    const { brand, model, engine } = await createVehicle();
    const product = await createProduct({ titleFa: 'قطعه' });
    await addFitment(product.id, model.id, engine.id);

    await expect(deleteVehicleEntity('model', model.id)).rejects.toThrow(/غیرفعال/);

    // Deactivating keeps the compatibility data intact.
    await upsertVehicleModel({ id: model.id, vehicleBrandId: brand.id, nameFa: model.nameFa, isActive: false });
    const taxonomy = await listVehicleTaxonomy();
    const row = taxonomy.flatMap((b) => b.models).find((m) => m.id === model.id)!;
    expect(row.isActive).toBe(false);
    expect(row.fitmentCount).toBe(1);

    // And the configuration still resolves, so existing orders keep their meaning.
    await expect(
      getOrCreateConfiguration({ vehicleModelId: model.id, vehicleEngineId: engine.id }),
    ).rejects.toThrow(/مدل خودرو یافت نشد/);
  });
});

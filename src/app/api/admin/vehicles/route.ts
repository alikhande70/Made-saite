/**
 * Vehicle taxonomy administration.
 *
 * Bulk import refuses to create vehicles from a supplier file, so this is the
 * only way a new model enters the system — deliberately, by a person working
 * from a real specification.
 */
import { z } from 'zod';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';
import { uuidSchema } from '@/lib/validation';
import {
  deleteVehicleEntity, listVehicleTaxonomy, upsertVehicleBrand, upsertVehicleChild, upsertVehicleModel,
} from '@/application/vehicle-admin-service';
import { recordAudit } from '@/application/audit-service';

const jalaliYear = z.coerce.number().int().min(1300).max(1450).nullable().optional();
const name = z.string().trim().min(1, 'نام نمی‌تواند خالی باشد.').max(140);
const code = z.string().trim().min(1, 'کد فنی نمی‌تواند خالی باشد.').max(60);

const brandSchema = z.object({
  kind: z.literal('brand'),
  id: uuidSchema.optional(),
  nameFa: name,
  nameEn: z.string().trim().max(120).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

const modelSchema = z.object({
  kind: z.literal('model'),
  id: uuidSchema.optional(),
  vehicleBrandId: uuidSchema,
  nameFa: name,
  nameEn: z.string().trim().max(140).nullable().optional(),
  yearFrom: jalaliYear,
  yearTo: jalaliYear,
  isActive: z.boolean().optional(),
});

const childSchema = z.object({
  kind: z.enum(['generation', 'trim', 'engine']),
  id: uuidSchema.optional(),
  vehicleModelId: uuidSchema,
  code,
  nameFa: name,
  isActive: z.boolean().optional(),
  yearFrom: jalaliYear,
  yearTo: jalaliYear,
  displacementCc: z.coerce.number().int().min(0).max(20_000).nullable().optional(),
  fuelType: z.string().trim().max(40).nullable().optional(),
  vehicleGenerationId: uuidSchema.nullable().optional(),
});

const writeSchema = z.discriminatedUnion('kind', [brandSchema, modelSchema, childSchema]);

const deleteSchema = z.object({
  kind: z.enum(['brand', 'model', 'generation', 'trim', 'engine']),
  id: uuidSchema,
});

const KIND_LABEL_FA: Record<string, string> = {
  brand: 'برند خودرو', model: 'مدل خودرو',
  generation: 'نسل خودرو', trim: 'تیپ خودرو', engine: 'موتور خودرو',
};

export const GET = adminRoute(async () => jsonOk(await listVehicleTaxonomy()));

export const POST = adminRoute(async (request, _admin, _ctx, audit) => {
  const input = writeSchema.parse(await readJson(request));

  const result = input.kind === 'brand'
    ? await upsertVehicleBrand(input)
    : input.kind === 'model'
      ? await upsertVehicleModel(input)
      : await upsertVehicleChild(input.kind, input);

  await recordAudit({
    actorUserId: audit.admin.id,
    action: 'vehicle.upsert',
    entityType: input.kind,
    entityId: result.id,
    summary: `${input.id ? 'ویرایش' : 'ثبت'} ${KIND_LABEL_FA[input.kind]}: ${input.nameFa}`,
    ipHash: audit.ipHash,
  });
  return jsonOk(result, { status: input.id ? 200 : 201 });
});

export const DELETE = adminRoute(async (request, _admin, _ctx, audit) => {
  const url = new URL(request.url);
  const input = deleteSchema.parse({ kind: url.searchParams.get('kind'), id: url.searchParams.get('id') });

  // Throws with the dependant counts when compatibility data would be lost.
  await deleteVehicleEntity(input.kind, input.id);

  await recordAudit({
    actorUserId: audit.admin.id,
    action: 'vehicle.delete',
    entityType: input.kind,
    entityId: input.id,
    summary: `حذف ${KIND_LABEL_FA[input.kind]}`,
    ipHash: audit.ipHash,
  });
  return jsonOk({ deleted: true });
});

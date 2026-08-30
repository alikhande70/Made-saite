import { z } from 'zod';
import { tomanSchema, uuidSchema } from '@/lib/validation';
import { IRAN_PROVINCES } from '@/lib/provinces';
import {
  deleteProvinceRate, deleteShippingMethod, listShippingMethodsAdmin,
  upsertProvinceRate, upsertShippingMethod,
} from '@/application/shipping-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';

const methodSchema = z.object({
  kind: z.literal('method'),
  id: uuidSchema.optional(),
  code: z.string().trim().min(2).max(40).regex(/^[a-z0-9-]+$/, 'کد روش ارسال فقط می‌تواند شامل حروف کوچک لاتین، رقم و خط تیره باشد.'),
  methodKind: z.enum(['STANDARD', 'COURIER', 'POST', 'PICKUP']),
  nameFa: z.string().trim().min(2, 'نام روش ارسال الزامی است.').max(120),
  description: z.string().trim().max(300).optional(),
  baseCost: tomanSchema,
  perKgCost: tomanSchema,
  freeOverSubtotal: tomanSchema.optional().nullable(),
  estimatedDaysMin: z.coerce.number().int().min(0).max(90).optional().nullable(),
  estimatedDaysMax: z.coerce.number().int().min(0).max(90).optional().nullable(),
  availableProvinces: z.array(z.enum(IRAN_PROVINCES)).default([]),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

const rateSchema = z.object({
  kind: z.literal('rate'),
  methodId: uuidSchema,
  province: z.enum(IRAN_PROVINCES),
  costOverride: tomanSchema.optional().nullable(),
  surcharge: z.coerce.number().int().min(-100_000_000).max(100_000_000).default(0),
});

export const GET = adminRoute(async () => jsonOk(await listShippingMethodsAdmin()));

export const POST = adminRoute(async (request) => {
  const body = z.discriminatedUnion('kind', [methodSchema, rateSchema]).parse(await readJson(request));

  if (body.kind === 'method') {
    const { kind: _kind, methodKind, ...rest } = body;
    return jsonOk(await upsertShippingMethod({ ...rest, kind: methodKind }));
  }
  return jsonOk(
    await upsertProvinceRate({
      methodId: body.methodId,
      province: body.province,
      costOverride: body.costOverride ?? null,
      surcharge: body.surcharge,
    }),
  );
});

export const DELETE = adminRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  const methodId = params.get('methodId');
  const rateId = params.get('rateId');
  if (rateId) {
    await deleteProvinceRate(uuidSchema.parse(rateId));
  } else {
    await deleteShippingMethod(uuidSchema.parse(methodId));
  }
  return jsonOk({ deleted: true });
});

import { z } from 'zod';
import { skuSchema, tomanSchema, uuidSchema, imageUrlSchema } from '@/lib/validation';
import { createProduct, listProductsAdmin } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
import { jsonOk, readJson } from '@/lib/http';

const nullableString = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

export const productBodySchema = z.object({
  sku: skuSchema,
  oemNumber: nullableString(80),
  mpn: nullableString(80),
  slug: nullableString(200),
  titleFa: z.string().trim().min(3, 'عنوان کالا باید حداقل ۳ کاراکتر باشد.').max(260),
  titleEn: nullableString(260),
  descriptionFa: z.string().trim().max(8000).optional(),
  categoryId: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
  brandId: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
  manufacturer: nullableString(140),
  price: tomanSchema,
  salePrice: tomanSchema.optional().nullable(),
  weightGrams: z.coerce.number().int().min(0).max(500_000).optional().nullable(),
  lengthMm: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  widthMm: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  heightMm: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  warrantyMonths: z.coerce.number().int().min(0).max(240).optional().nullable(),
  countryOfOrigin: nullableString(80),
  condition: z.enum(['new', 'refurbished', 'used']).default('new'),
  installationNotes: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().max(60)).max(30).default([]),
  seoTitle: nullableString(200),
  seoDescription: nullableString(320),
  isActive: z.boolean().default(false),
  images: z.array(z.object({ url: imageUrlSchema, alt: z.string().trim().max(250).optional() })).max(10).default([]),
  specs: z.array(z.object({
    specKey: z.string().trim().min(1).max(120),
    specValue: z.string().trim().min(1).max(240),
    unit: z.string().trim().max(40).optional(),
  })).max(60).default([]),
  fitments: z.array(z.object({
    vehicleModelId: uuidSchema,
    vehicleTrimId: uuidSchema.optional().nullable(),
    vehicleEngineId: uuidSchema.optional().nullable(),
    yearFrom: z.coerce.number().int().min(1300).max(1450).optional().nullable(),
    yearTo: z.coerce.number().int().min(1300).max(1450).optional().nullable(),
    fitmentType: z.enum(['DIRECT', 'WITH_MODIFICATION', 'NOT_COMPATIBLE']).default('DIRECT'),
    note: z.string().trim().max(240).optional().nullable(),
  })).max(500).default([]),
  references: z.array(z.object({
    relationType: z.enum(['SUPERSEDES', 'SUPERSEDED_BY', 'ALTERNATE', 'CROSS_REFERENCE']),
    targetProductId: uuidSchema.optional().nullable(),
    targetNumber: z.string().trim().max(80).optional().nullable(),
    targetBrand: z.string().trim().max(140).optional().nullable(),
    note: z.string().trim().max(240).optional().nullable(),
  }).refine(
    (r) => Boolean(r.targetProductId || r.targetNumber),
    'برای هر کد معادل، شمارهٔ قطعه یا کالای مقصد الزامی است.',
  )).max(200).default([]),
  productFamily: nullableString(140),
  allowBackorder: z.boolean().default(false),
  initialStock: z.coerce.number().int().min(0).max(100_000).optional(),
});

export const GET = adminRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return jsonOk(
    await listProductsAdmin({
      q: params.get('q') ?? undefined,
      categoryId: params.get('categoryId') ?? undefined,
      status: (params.get('status') as 'active' | 'inactive' | null) ?? undefined,
      lowStock: params.get('lowStock') === '1',
      page: Number(params.get('page') ?? 1),
    }),
  );
});

export const POST = adminRoute(async (request, admin, _ctx, audit) => {
  const input = productBodySchema.parse(await readJson(request));
  const created = await createProduct(input, admin.id);
  await recordAudit({
    actorUserId: admin.id,
    action: 'product.create',
    entityType: 'product',
    entityId: created.id,
    summary: `کالای «${input.titleFa}» با کد ${input.sku} ایجاد شد.`,
    metadata: { sku: input.sku, price: input.price, isActive: input.isActive },
    ipHash: audit.ipHash,
  });
  return jsonOk(created, { status: 201 });
});

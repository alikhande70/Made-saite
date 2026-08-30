import { z } from 'zod';
import { uuidSchema, imageUrlSchema } from '@/lib/validation';
import { deleteBrand, listBrandsAdmin, upsertBrand } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
import { jsonOk, readJson } from '@/lib/http';

const schema = z.object({
  id: uuidSchema.optional(),
  nameFa: z.string().trim().min(2, 'نام برند الزامی است.').max(140),
  nameEn: z.string().trim().max(140).optional(),
  slug: z.string().trim().max(140).optional(),
  country: z.string().trim().max(80).optional(),
  logoUrl: imageUrlSchema.optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
});

export const GET = adminRoute(async () => jsonOk(await listBrandsAdmin()));

export const POST = adminRoute(async (request, admin, _ctx, audit) => {
  const input = schema.parse(await readJson(request));
  const row = await upsertBrand(input);
  await recordAudit({
    actorUserId: admin.id,
    action: 'brand.upsert',
    entityType: 'brand',
    entityId: row.id,
    summary: `برند «${row.nameFa}» ${input.id ? 'ویرایش' : 'ایجاد'} شد.`,
    ipHash: audit.ipHash,
  });
  return jsonOk(row);
});

export const DELETE = adminRoute(async (request, admin, _ctx, audit) => {
  const id = uuidSchema.parse(new URL(request.url).searchParams.get('id'));
  await deleteBrand(id);
  await recordAudit({
    actorUserId: admin.id, action: 'brand.delete', entityType: 'brand', entityId: id,
    summary: 'برند حذف شد.', ipHash: audit.ipHash,
  });
  return jsonOk({ deleted: true });
});

import { z } from 'zod';
import { uuidSchema, imageUrlSchema } from '@/lib/validation';
import { deleteBrand, listBrandsAdmin, upsertBrand } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
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

export const POST = adminRoute(async (request) =>
  jsonOk(await upsertBrand(schema.parse(await readJson(request)))),
);

export const DELETE = adminRoute(async (request) => {
  const id = uuidSchema.parse(new URL(request.url).searchParams.get('id'));
  await deleteBrand(id);
  return jsonOk({ deleted: true });
});

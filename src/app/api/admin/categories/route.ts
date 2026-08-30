import { z } from 'zod';
import { uuidSchema, imageUrlSchema } from '@/lib/validation';
import { deleteCategory, listCategoriesAdmin, upsertCategory } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';

const schema = z.object({
  id: uuidSchema.optional(),
  nameFa: z.string().trim().min(2, 'نام دسته الزامی است.').max(140),
  nameEn: z.string().trim().max(140).optional(),
  slug: z.string().trim().max(140).optional(),
  parentId: uuidSchema.optional().or(z.literal('').transform(() => undefined)),
  description: z.string().trim().max(1000).optional(),
  imageUrl: imageUrlSchema.optional(),
  icon: z.string().trim().max(40).optional(),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
  seoTitle: z.string().trim().max(200).optional(),
  seoDescription: z.string().trim().max(320).optional(),
});

export const GET = adminRoute(async () => jsonOk(await listCategoriesAdmin()));

export const POST = adminRoute(async (request) =>
  jsonOk(await upsertCategory(schema.parse(await readJson(request)))),
);

export const DELETE = adminRoute(async (request) => {
  const id = uuidSchema.parse(new URL(request.url).searchParams.get('id'));
  await deleteCategory(id);
  return jsonOk({ deleted: true });
});

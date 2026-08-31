import { z } from 'zod';
import { getStoreProfile, updateStoreProfile } from '@/application/settings-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
import { jsonOk, readJson } from '@/lib/http';

const schema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  tagline: z.string().trim().max(300).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(255).optional(),
  address: z.string().trim().max(500).optional(),
  workingHours: z.string().trim().max(200).optional(),
  isDemo: z.boolean().optional(),
  demoNotice: z.string().trim().max(300).optional(),
});

export const GET = adminRoute(async () => jsonOk(await getStoreProfile()));

export const PATCH = adminRoute(async (request, admin, _ctx, audit) => {
  const patch = schema.parse(await readJson(request));
  await updateStoreProfile(patch);
  await recordAudit({
    actorUserId: admin.id,
    action: 'settings.update',
    entityType: 'store',
    summary: `تنظیمات فروشگاه به‌روزرسانی شد (${Object.keys(patch).join('، ')}).`,
    metadata: patch as Record<string, unknown>,
    ipHash: audit.ipHash,
  });
  return jsonOk(await getStoreProfile());
});

import { z } from 'zod';
import { uuidSchema } from '@/lib/validation';
import { listCustomers, setCustomerActive } from '@/application/admin-service';
import { adminRoute } from '@/lib/admin-http';
import { recordAudit } from '@/application/audit-service';
import { jsonOk, readJson } from '@/lib/http';

export const GET = adminRoute(async (request) => {
  const params = new URL(request.url).searchParams;
  return jsonOk(await listCustomers({ q: params.get('q') ?? undefined, page: Number(params.get('page') ?? 1) }));
});

export const PATCH = adminRoute(async (request, admin, _ctx, audit) => {
  const body = z.object({ userId: uuidSchema, isActive: z.boolean() }).parse(await readJson(request));
  await setCustomerActive(body.userId, body.isActive);
  await recordAudit({
    actorUserId: admin.id,
    action: body.isActive ? 'customer.activate' : 'customer.deactivate',
    entityType: 'user',
    entityId: body.userId,
    summary: body.isActive ? 'حساب مشتری فعال شد.' : 'حساب مشتری مسدود و نشست‌های او باطل شد.',
    ipHash: audit.ipHash,
  });
  return jsonOk({ isActive: body.isActive });
});

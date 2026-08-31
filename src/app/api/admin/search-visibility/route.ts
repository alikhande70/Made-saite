/**
 * Admin actions for search visibility. Read-only data is fetched by the page
 * itself; this handler exists for the two things that change state.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';
import { recordAudit } from '@/application/audit-service';
import {
  getAdapter, processSubmissionQueue, retryFailedSubmissions,
} from '@/application/search-visibility';
import { errors } from '@/domain/errors';

const actionSchema = z.object({
  action: z.enum(['retryFailed', 'drainNow']),
  adapter: z.string().trim().min(1).max(40),
});

export const POST = adminRoute(async (request, admin, _ctx, audit) => {
  const input = actionSchema.parse(await readJson(request));

  const adapter = getAdapter(input.adapter);
  if (!adapter) throw errors.notFound('این سرویس جست‌وجو تعریف نشده است.');

  if (input.action === 'retryFailed') {
    const requeued = await retryFailedSubmissions(adapter.id);
    await recordAudit({
      actorUserId: admin.id, ipHash: audit.ipHash,
      action: 'seo.submissions.retry', entityType: 'search_submission', entityId: adapter.id,
      summary: `${requeued} ارسال ناموفق دوباره در صف قرار گرفت.`,
    });
    return jsonOk({ requeued });
  }

  const result = await processSubmissionQueue();
  await recordAudit({
    actorUserId: admin.id, ipHash: audit.ipHash,
    action: 'seo.submissions.drain', entityType: 'search_submission', entityId: adapter.id,
    summary: `صف ارسال پردازش شد: ${result.succeeded} موفق، ${result.failed} ناموفق.`,
  });
  return NextResponse.json({ ok: true, data: result });
});

/**
 * Bulk import: validate (POST) then commit (PUT).
 *
 * The two phases are separate requests on purpose — nothing is written until
 * an administrator has seen the preview and explicitly applied the job.
 */
import { z } from 'zod';
import { adminRoute } from '@/lib/admin-http';
import { jsonOk, readJson } from '@/lib/http';
import { uuidSchema } from '@/lib/validation';
import {
  commitImport, discardImportJob, listImportJobs, validateImport,
} from '@/application/import-service';
import { recordAudit } from '@/application/audit-service';
import { errors } from '@/domain/errors';
import { toPersianDigits } from '@/lib/fa';

/** Guards against a memory-exhaustion upload before the text is even parsed. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/*
 * Measured in bytes, not characters. Persian is two to three bytes per
 * character in UTF-8, so a character-counted limit would let a Persian file
 * through at two to three times the intended size — which is exactly the file
 * this endpoint receives.
 */
const withinByteLimit = (value: string) => Buffer.byteLength(value, 'utf8') <= MAX_UPLOAD_BYTES;

const validateSchema = z.object({
  filename: z.string().trim().max(240).optional(),
  content: z
    .string()
    .min(1, 'فایل خالی است.')
    .refine(withinByteLimit, `حجم فایل بیش از حد مجاز است (حداکثر ${MAX_UPLOAD_BYTES / 1024 / 1024} مگابایت).`),
});

const commitSchema = z.object({
  jobId: uuidSchema,
  action: z.enum(['commit', 'discard']).default('commit'),
});

export const GET = adminRoute(async () => jsonOk(await listImportJobs()));

export const POST = adminRoute(async (request, _admin, _ctx, audit) => {
  const input = validateSchema.parse(await readJson(request));
  const preview = await validateImport(input.content, {
    filename: input.filename ?? null,
    actorUserId: audit.admin.id,
  });

  await recordAudit({
    actorUserId: audit.admin.id,
    action: 'import.validate',
    entityType: 'import_job',
    entityId: preview.jobId,
    summary:
      `بررسی فایل درون‌ریزی «${input.filename ?? 'بدون نام'}»: ` +
      `${toPersianDigits(preview.validRows)} ردیف معتبر، ${toPersianDigits(preview.errorRows)} ردیف دارای خطا`,
    ipHash: audit.ipHash,
  });

  return jsonOk(preview);
});

export const PUT = adminRoute(async (request, _admin, _ctx, audit) => {
  const input = commitSchema.parse(await readJson(request));

  if (input.action === 'discard') {
    await discardImportJob(input.jobId);
    await recordAudit({
      actorUserId: audit.admin.id,
      action: 'import.discard',
      entityType: 'import_job',
      entityId: input.jobId,
      summary: 'فایل درون‌ریزی بدون اعمال کنار گذاشته شد',
      ipHash: audit.ipHash,
    });
    return jsonOk({ discarded: true });
  }

  const result = await commitImport(input.jobId, audit.admin.id);
  await recordAudit({
    actorUserId: audit.admin.id,
    action: 'import.commit',
    entityType: 'import_job',
    entityId: input.jobId,
    summary:
      `اعمال فایل درون‌ریزی: ${toPersianDigits(result.created)} کالای جدید، ` +
      `${toPersianDigits(result.updated)} به‌روزرسانی، ${toPersianDigits(result.stockAdjusted)} تغییر موجودی`,
    ipHash: audit.ipHash,
  });
  return jsonOk(result);
});

export const DELETE = adminRoute(async () => {
  throw errors.validation('حذف گزارش درون‌ریزی پشتیبانی نمی‌شود؛ گزارش‌ها سابقهٔ تغییرات هستند.');
});

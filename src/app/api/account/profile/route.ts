import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { emailSchema, fullNameSchema } from '@/lib/validation';
import { updateProfile } from '@/application/auth-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { requireUser } from '@/lib/session';

const schema = z.object({
  fullName: fullNameSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
});

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = schema.parse(await readJson(request));
    return jsonOk(await updateProfile(user.id, input));
  } catch (e) {
    return jsonError(e);
  }
}

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { passwordSchema } from '@/lib/validation';
import { changePassword } from '@/application/auth-service';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { clearSessionCookie, requireUser } from '@/lib/session';

const schema = z.object({
  currentPassword: z.string().min(1, 'رمز عبور فعلی را وارد کنید.'),
  newPassword: passwordSchema,
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = schema.parse(await readJson(request));
    await changePassword(user.id, input.currentPassword, input.newPassword);
    // changePassword revokes every session, including this one.
    await clearSessionCookie();
    return jsonOk({ changed: true });
  } catch (e) {
    return jsonError(e);
  }
}

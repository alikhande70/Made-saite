/** Customer address book. Every query is scoped to the signed-in user (anti-IDOR). */
import type { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { addressSchema, uuidSchema } from '@/lib/validation';
import { getDb, withTransaction } from '@/infrastructure/db/client';
import { addresses } from '@/infrastructure/db/schema';
import { assertSameOrigin, jsonError, jsonOk, readJson } from '@/lib/http';
import { requireUser } from '@/lib/session';
import { errors } from '@/domain/errors';

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk(await getDb().select().from(addresses).where(eq(addresses.userId, user.id)));
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = addressSchema.parse(await readJson(request));

    const row = await withTransaction(async (tx) => {
      if (input.isDefault) {
        await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, user.id));
      }
      const [created] = await tx
        .insert(addresses)
        .values({
          userId: user.id,
          label: input.label ?? null,
          fullName: input.fullName,
          phone: input.phone,
          province: input.province,
          city: input.city,
          postalAddress: input.postalAddress,
          postalCode: input.postalCode,
          isDefault: input.isDefault,
        })
        .returning();
      return created!;
    });

    return jsonOk(row, { status: 201 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const id = uuidSchema.parse(new URL(request.url).searchParams.get('id'));

    // The user id is part of the WHERE clause, so one customer can never delete
    // another's address even by guessing its id.
    const deleted = await getDb()
      .delete(addresses)
      .where(and(eq(addresses.id, id), eq(addresses.userId, user.id)))
      .returning({ id: addresses.id });

    if (deleted.length === 0) throw errors.notFound('آدرس یافت نشد.');
    return jsonOk({ deleted: true });
  } catch (e) {
    return jsonError(e);
  }
}

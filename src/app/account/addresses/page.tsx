import type { Metadata } from 'next';
import { desc, eq } from 'drizzle-orm';
import { getDb } from '@/infrastructure/db/client';
import { addresses } from '@/infrastructure/db/schema';
import { requireUser } from '@/lib/session';
import { AddressManager } from '@/components/address-manager';
import { SectionHeading } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'آدرس‌های من', robots: { index: false, follow: false } };

export default async function AddressesPage() {
  const user = await requireUser();
  const rows = await getDb()
    .select()
    .from(addresses)
    .where(eq(addresses.userId, user.id))
    .orderBy(desc(addresses.isDefault), desc(addresses.createdAt));

  return (
    <>
      <SectionHeading title="آدرس‌های من" as="h1" subtitle="آدرس‌های ذخیره‌شده هنگام تکمیل سفارش قابل انتخاب هستند." />
      <AddressManager
        initial={rows.map((a) => ({
          id: a.id, label: a.label, fullName: a.fullName, phone: a.phone,
          province: a.province, city: a.city, postalAddress: a.postalAddress,
          postalCode: a.postalCode, isDefault: a.isDefault,
        }))}
        defaults={{ fullName: user.fullName, phone: user.phone }}
      />
    </>
  );
}

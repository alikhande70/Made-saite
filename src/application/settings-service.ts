/**
 * Store settings: a small typed key/value store the admin panel edits.
 */
import { eq, inArray } from 'drizzle-orm';
import { getDb, type Database } from '@/infrastructure/db/client';
import { storeSettings } from '@/infrastructure/db/schema';

export interface StoreProfile {
  name: string;
  tagline: string;
  phone: string;
  email: string;
  address: string;
  workingHours: string;
  isDemo: boolean;
  demoNotice: string;
}

const DEFAULTS: StoreProfile = {
  name: 'مِیدساخت | فروشگاه قطعات یدکی خودرو',
  tagline: 'قطعات یدکی اصل خودروهای ایرانی و وارداتی',
  phone: '۰۲۱-۱۲۳۴۵۶۷۸',
  email: 'info@example.invalid',
  address: 'تهران (نشانی نمایشی)',
  workingHours: 'شنبه تا چهارشنبه ۹ تا ۱۸',
  isDemo: true,
  demoNotice: 'این یک فروشگاه نمایشی است. هیچ سفارش واقعی پردازش یا ارسال نمی‌شود.',
};

const KEYS: Record<keyof StoreProfile, string> = {
  name: 'store.name',
  tagline: 'store.tagline',
  phone: 'store.phone',
  email: 'store.email',
  address: 'store.address',
  workingHours: 'store.workingHours',
  isDemo: 'store.isDemo',
  demoNotice: 'store.demoNotice',
};

export async function getStoreProfile(db: Database = getDb()): Promise<StoreProfile> {
  try {
    const rows = await db
      .select()
      .from(storeSettings)
      .where(inArray(storeSettings.key, Object.values(KEYS)));
    const map = new Map(rows.map((r) => [r.key, r.value]));
    const read = <K extends keyof StoreProfile>(key: K): StoreProfile[K] => {
      const raw = map.get(KEYS[key]);
      return (raw === undefined || raw === null ? DEFAULTS[key] : raw) as StoreProfile[K];
    };
    return {
      name: read('name'), tagline: read('tagline'), phone: read('phone'), email: read('email'),
      address: read('address'), workingHours: read('workingHours'),
      isDemo: read('isDemo'), demoNotice: read('demoNotice'),
    };
  } catch {
    // The storefront must still render before the first migration/seed.
    return DEFAULTS;
  }
}

export async function updateStoreProfile(
  patch: Partial<StoreProfile>,
  db: Database = getDb(),
): Promise<void> {
  for (const [field, value] of Object.entries(patch)) {
    const key = KEYS[field as keyof StoreProfile];
    if (!key || value === undefined) continue;
    // jsonb accepts any JSON value; Drizzle types the column as `object`.
    const json = value as unknown as object;
    await db
      .insert(storeSettings)
      .values({ key, value: json })
      .onConflictDoUpdate({ target: storeSettings.key, set: { value: json, updatedAt: new Date() } });
  }
}

export async function getSetting<T>(key: string, fallback: T, db: Database = getDb()): Promise<T> {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.key, key)).limit(1);
  return (row?.value as T) ?? fallback;
}

/**
 * Absolute origin used for canonical URLs, Open Graph tags, the sitemap and
 * payment callback URLs.
 *
 * `SITE_URL` is read first and is deliberately *not* a NEXT_PUBLIC variable:
 * Next inlines NEXT_PUBLIC_* at build time, which would bake the build
 * machine's hostname into the server bundle and make one build unpromotable
 * between environments. `NEXT_PUBLIC_SITE_URL` stays as a fallback.
 */
export function siteUrl(): string {
  return process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
}

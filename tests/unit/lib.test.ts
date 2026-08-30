import { describe, expect, it } from 'vitest';
import {
  formatCount, formatDeliveryWindow, formatNumber, formatToman, formatTomanCompact,
  formatYearRange, toLatinDigits, toPersianDigits, currentJalaliYear, formatDate,
} from '@/lib/fa';
import { slugify, uniqueSlug } from '@/lib/slug';
import { hashPassword, verifyPassword, hmacSign, hmacVerify, generateOrderNumber, sha256, randomToken } from '@/lib/crypto';
import {
  checkoutSchema, fieldErrors, phoneSchema, postalCodeSchema, productQuerySchema,
  passwordSchema, quantitySchema, skuSchema, provinceSchema,
} from '@/lib/validation';
import { IRAN_PROVINCES } from '@/lib/provinces';
import { serializeJsonLd } from '@/lib/json-ld';

describe('Persian formatting', () => {
  it('folds Persian and Arabic-Indic digits to Latin', () => {
    expect(toLatinDigits('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('BRK-۲۰۶')).toBe('BRK-206');
  });

  it('renders Persian digits for display', () => {
    expect(toPersianDigits(1402)).toBe('۱۴۰۲');
    expect(formatNumber(1_250_000)).toBe('۱٬۲۵۰٬۰۰۰');
    expect(formatToman(1_250_000)).toBe('۱٬۲۵۰٬۰۰۰ تومان');
  });

  it('formats compact prices', () => {
    expect(formatTomanCompact(1_250_000)).toContain('میلیون');
    expect(formatTomanCompact(85_000)).toContain('هزار');
    expect(formatTomanCompact(500)).toBe('۵۰۰ تومان');
  });

  it('formats dates in the Jalali calendar', () => {
    const text = formatDate(new Date('2026-08-29T09:00:00Z'));
    // «۷ شهریور ۱۴۰۵» — Persian month name and Persian-digit Jalali year.
    expect(text).toMatch(/شهریور/);
    expect(text).toMatch(/[۰-۹]{4}/);
    expect(text).not.toMatch(/[0-9]/);
  });

  it('reports a plausible current Jalali year', () => {
    const y = currentJalaliYear(new Date('2026-08-29T09:00:00Z'));
    expect(y).toBeGreaterThan(1400);
    expect(y).toBeLessThan(1420);
  });

  it('formats year ranges and delivery windows in Persian', () => {
    expect(formatYearRange(1390, 1402)).toBe('۱۳۹۰ تا ۱۴۰۲');
    expect(formatYearRange(1395, null)).toBe('از ۱۳۹۵');
    expect(formatYearRange(null, null)).toBe('همهٔ سال‌ها');
    expect(formatYearRange(1400, 1400)).toBe('۱۴۰۰');
    expect(formatDeliveryWindow(2, 5)).toBe('۲ تا ۵ روز کاری');
    expect(formatDeliveryWindow(1, 1)).toBe('۱ روز کاری');
    expect(formatDeliveryWindow(null, null)).toBeNull();
    expect(formatCount(3)).toBe('۳ مورد');
  });
});

describe('slugs', () => {
  it('keeps Persian letters and strips punctuation', () => {
    expect(slugify('لنت ترمز جلو پژو ۲۰۶ (تیپ ۵)')).toBe('لنت-ترمز-جلو-پژو-206-تیپ-5');
  });

  it('produces URL-safe output with no leading or trailing dashes', () => {
    const s = slugify('  --فیلتر / روغن--  ');
    expect(s.startsWith('-')).toBe(false);
    expect(s.endsWith('-')).toBe(false);
    expect(s).not.toContain('/');
  });

  it('de-duplicates against taken slugs', () => {
    const taken = new Set(['لنت-ترمز', 'لنت-ترمز-2']);
    expect(uniqueSlug('لنت ترمز', taken)).toBe('لنت-ترمز-3');
  });
});

describe('crypto', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('Correct@Horse1');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('Correct@Horse1', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('produces a different hash for the same password (per-user salt)', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('rejects malformed stored hashes without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
  });

  it('verifies HMAC signatures and rejects tampering', () => {
    const sig = hmacSign('order|ref|SUCCEEDED|1000', 'secret-key');
    expect(hmacVerify('order|ref|SUCCEEDED|1000', sig, 'secret-key')).toBe(true);
    expect(hmacVerify('order|ref|SUCCEEDED|9999', sig, 'secret-key')).toBe(false);
    expect(hmacVerify('order|ref|SUCCEEDED|1000', sig, 'other-key')).toBe(false);
    expect(hmacVerify('order|ref|SUCCEEDED|1000', 'short', 'secret-key')).toBe(false);
  });

  it('generates unguessable, unique order numbers and tokens', () => {
    const numbers = new Set(Array.from({ length: 400 }, () => generateOrderNumber()));
    expect(numbers.size).toBe(400);
    expect([...numbers][0]).toMatch(/^MS-\d{4}-[0-9A-HJ-NP-Z]{8}$/);
    expect(randomToken(24)).toHaveLength(32);
    expect(sha256('x')).toHaveLength(64);
  });
});

describe('validation (Persian messages)', () => {
  it('accepts Persian-digit phone numbers and rejects bad ones', () => {
    expect(phoneSchema.parse('۰۹۱۲۳۴۵۶۷۸۹')).toBe('09123456789');
    expect(phoneSchema.safeParse('12345').success).toBe(false);
    const r = phoneSchema.safeParse('0812345678');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain('شماره موبایل');
  });

  it('requires a 10-digit postal code, accepting Persian digits', () => {
    expect(postalCodeSchema.parse('۱۲۳۴۵۶۷۸۹۰')).toBe('1234567890');
    expect(postalCodeSchema.safeParse('12345').success).toBe(false);
  });

  it('enforces password strength in Persian', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('abcdefghij').success).toBe(false);
    expect(passwordSchema.safeParse('abcdefgh1').success).toBe(true);
    expect(passwordSchema.safeParse('رمزعبور۱۲۳').success).toBe(true);
  });

  it('caps quantity at the per-line maximum', () => {
    expect(quantitySchema.parse('۳')).toBe(3);
    expect(quantitySchema.parse(2)).toBe(2);
    expect(quantitySchema.safeParse(21).success).toBe(false);
    expect(quantitySchema.safeParse(0).success).toBe(false);
  });

  it('restricts SKUs to Latin part-number characters', () => {
    expect(skuSchema.parse('BRK-PAD-206F')).toBe('BRK-PAD-206F');
    expect(skuSchema.safeParse('کد فارسی').success).toBe(false);
  });

  it('accepts only real Iranian provinces', () => {
    expect(provinceSchema.safeParse('تهران').success).toBe(true);
    expect(provinceSchema.safeParse('Tehran').success).toBe(false);
    expect(IRAN_PROVINCES).toHaveLength(31);
  });

  it('never lets a client-supplied price into a checkout payload', () => {
    const parsed = checkoutSchema.parse({
      fullName: 'علی رضایی', phone: '۰۹۱۲۳۴۵۶۷۸۹', province: 'تهران', city: 'تهران',
      postalAddress: 'خیابان نمونه، پلاک ۱۰', postalCode: '۱۲۳۴۵۶۷۸۹۰',
      shippingMethodCode: 'post-pishtaz',
      // hostile extras:
      grandTotal: 1, shippingTotal: 0, subtotal: 1, price: 1,
    });
    expect(parsed).not.toHaveProperty('grandTotal');
    expect(parsed).not.toHaveProperty('price');
    expect(parsed).not.toHaveProperty('shippingTotal');
  });

  it('clamps listing pagination to a sane range', () => {
    expect(productQuerySchema.parse({}).perPage).toBe(24);
    expect(productQuerySchema.safeParse({ perPage: 10_000 }).success).toBe(false);
    expect(productQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(productQuerySchema.parse({ sort: 'price-asc' }).sort).toBe('price-asc');
    expect(productQuerySchema.safeParse({ sort: 'random' }).success).toBe(false);
  });

  it('flattens Zod issues into per-field Persian messages', () => {
    const r = checkoutSchema.safeParse({ fullName: 'ع', phone: 'x' });
    expect(r.success).toBe(false);
    if (!r.success) {
      const f = fieldErrors(r.error);
      expect(f.fullName).toContain('نام');
      expect(f.phone).toContain('موبایل');
    }
  });
});


describe('JSON-LD serialisation', () => {
  it('escapes characters that could close the script element', () => {
    const html = serializeJsonLd({ name: '</script><img src=x onerror=alert(1)>' });
    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<img');
    expect(html).toContain('\\u003c');
    // The payload is unchanged for any JSON parser.
    expect(JSON.parse(html)).toEqual({ name: '</script><img src=x onerror=alert(1)>' });
  });

  it('escapes JavaScript line terminators that are legal in JSON', () => {
    const html = serializeJsonLd({ name: 'a\u2028b\u2029c' });
    expect(html).not.toContain('\u2028');
    expect(JSON.parse(html).name).toBe('a\u2028b\u2029c');
  });

  it('round-trips Persian text unchanged', () => {
    const data = { name: 'لنت ترمز جلو پژو ۲۰۶', sku: 'BRK-PAD-206F' };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

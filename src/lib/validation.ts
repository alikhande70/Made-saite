/**
 * Input validation. Every value crossing an HTTP boundary is parsed here first;
 * handlers receive typed data or a Persian error, never raw input.
 */
import { z } from 'zod';
import { toLatinDigits } from './fa';
import { IRAN_PROVINCES } from './provinces';
import { ORDER_STATUSES } from '@/domain/order-status';

/** Normalises Persian/Arabic digits before any numeric or pattern check. */
const digitsNormalized = z.string().transform((s) => toLatinDigits(s).trim());

/** Same, but also accepts an already-numeric value (JSON bodies send numbers). */
const numericInput = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? v : toLatinDigits(v).trim()));

export const phoneSchema = digitsNormalized.pipe(
  z
    .string()
    .regex(/^09\d{9}$/, 'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۳۴۵۶۷۸۹).'),
);

export const postalCodeSchema = digitsNormalized.pipe(
  z.string().regex(/^\d{10}$/, 'کد پستی باید دقیقاً ۱۰ رقم باشد.'),
);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('نشانی ایمیل معتبر نیست.')
  .max(255, 'نشانی ایمیل بیش از حد طولانی است.');

export const passwordSchema = z
  .string()
  .min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد.')
  .max(200, 'رمز عبور بیش از حد طولانی است.')
  .refine((v) => /[A-Za-z؀-ۿ]/.test(v), 'رمز عبور باید حداقل یک حرف داشته باشد.')
  .refine((v) => /\d/.test(toLatinDigits(v)), 'رمز عبور باید حداقل یک رقم داشته باشد.');

export const fullNameSchema = z
  .string()
  .trim()
  .min(3, 'نام و نام خانوادگی باید حداقل ۳ کاراکتر باشد.')
  .max(160, 'نام و نام خانوادگی بیش از حد طولانی است.');

export const provinceSchema = z.enum(IRAN_PROVINCES, {
  errorMap: () => ({ message: 'استان انتخاب‌شده معتبر نیست.' }),
});

export const citySchema = z
  .string()
  .trim()
  .min(2, 'نام شهر را وارد کنید.')
  .max(80, 'نام شهر بیش از حد طولانی است.');

export const addressLineSchema = z
  .string()
  .trim()
  .min(10, 'نشانی پستی باید حداقل ۱۰ کاراکتر باشد.')
  .max(500, 'نشانی پستی بیش از حد طولانی است.');

export const uuidSchema = z.string().uuid('شناسه معتبر نیست.');

/**
 * Image locations accepted from the admin panel: a site-relative path or an
 * absolute https URL. This blocks `javascript:` and `data:` values from ever
 * reaching an `src` attribute.
 */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => v.startsWith('/') || v.startsWith('https://'),
    'نشانی تصویر باید یک مسیر داخلی (شروع با /) یا یک نشانی https باشد.',
  );


export const quantitySchema = numericInput.pipe(
  z.coerce
    .number({ invalid_type_error: 'تعداد باید یک عدد باشد.' })
    .int('تعداد باید عدد صحیح باشد.')
    .min(1, 'تعداد باید حداقل ۱ باشد.')
    .max(20, 'حداکثر ۲۰ عدد از هر کالا در هر سفارش قابل خرید است.'),
);

export const tomanSchema = z.coerce
  .number({ invalid_type_error: 'مبلغ باید یک عدد باشد.' })
  .int('مبلغ باید عدد صحیح (تومان) باشد.')
  .min(0, 'مبلغ نمی‌تواند منفی باشد.')
  .max(Number.MAX_SAFE_INTEGER);

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'نشانی یکتا (slug) الزامی است.')
  .max(200)
  .regex(/^[^\s/?#]+$/u, 'نشانی یکتا نباید شامل فاصله یا کاراکترهای «/ ? #» باشد.');

export const skuSchema = z
  .string()
  .trim()
  .min(2, 'کد کالا (SKU) الزامی است.')
  .max(64, 'کد کالا بیش از حد طولانی است.')
  .regex(/^[A-Za-z0-9._\-\/]+$/, 'کد کالا فقط می‌تواند شامل حروف لاتین، ارقام و «- _ . /» باشد.');

export const jalaliYearSchema = numericInput.pipe(
  z.coerce
    .number()
    .int()
    .min(1300, 'سال باید بین ۱۳۰۰ تا ۱۴۵۰ باشد.')
    .max(1450, 'سال باید بین ۱۳۰۰ تا ۱۴۵۰ باشد.'),
);

export const orderStatusSchema = z.enum(ORDER_STATUSES, {
  errorMap: () => ({ message: 'وضعیت سفارش معتبر نیست.' }),
});

/* ── composed request schemas ── */

export const registerSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  password: passwordSchema,
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1, 'رمز عبور را وارد کنید.'),
});

export const addressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  fullName: fullNameSchema,
  phone: phoneSchema,
  province: provinceSchema,
  city: citySchema,
  postalAddress: addressLineSchema,
  postalCode: postalCodeSchema,
  isDefault: z.boolean().optional().default(false),
});

export const checkoutSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  province: provinceSchema,
  city: citySchema,
  postalAddress: addressLineSchema,
  postalCode: postalCodeSchema,
  deliveryNotes: z.string().trim().max(500, 'توضیحات نباید بیش از ۵۰۰ کاراکتر باشد.').optional(),
  shippingMethodCode: z.string().trim().min(1, 'روش ارسال را انتخاب کنید.').max(40),
  paymentProvider: z.string().trim().min(1).max(40).optional(),
});

export const addToCartSchema = z.object({
  productId: uuidSchema,
  quantity: quantitySchema.default(1),
});

export const updateCartItemSchema = z.object({
  productId: uuidSchema,
  quantity: z.coerce.number().int().min(0).max(20),
});

/** Search / listing query parameters. Unknown keys are dropped. */
export const productQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(140).optional(),
  brand: z.union([z.string(), z.array(z.string())]).optional(),
  vehicleModel: z.string().trim().max(140).optional(),
  vehicleEngine: z.string().trim().max(140).optional(),
  vehicleYear: z.coerce.number().int().min(1300).max(1450).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  inStock: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === 'true' || v === '1')
    .optional(),
  manufacturer: z.string().trim().max(140).optional(),
  sort: z.enum(['relevance', 'newest', 'price-asc', 'price-desc']).default('relevance'),
  page: z.coerce.number().int().min(1).max(500).default(1),
  perPage: z.coerce.number().int().min(1).max(60).default(24),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;

/** Flattens a ZodError into `{ field: 'پیام فارسی' }` for form rendering. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

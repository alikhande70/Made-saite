/**
 * The vocabulary of administrative actions.
 *
 * Lives in the domain layer, not the service, because the admin UI needs the
 * Persian labels in the browser — importing them from the service would drag
 * the Postgres driver into the client bundle.
 */

export type AuditAction =
  | 'product.create' | 'product.update' | 'product.publish' | 'product.unpublish'
  | 'inventory.adjust'
  | 'order.transition' | 'order.tracking' | 'order.settle_cash'
  | 'category.upsert' | 'category.delete'
  | 'brand.upsert' | 'brand.delete'
  | 'shipping.upsert' | 'shipping.delete'
  | 'customer.activate' | 'customer.deactivate'
  | 'settings.update'
  | 'import.validate' | 'import.commit' | 'import.discard'
  | 'vehicle.upsert' | 'vehicle.delete'
  | 'seo.submissions.retry' | 'seo.submissions.drain';

/** Persian labels, shown verbatim in the admin audit log. */
export const AUDIT_ACTION_LABEL_FA: Record<string, string> = {
  'product.create': 'ایجاد کالا',
  'product.update': 'ویرایش کالا',
  'product.publish': 'انتشار کالا',
  'product.unpublish': 'خروج کالا از انتشار',
  'inventory.adjust': 'تغییر موجودی',
  'order.transition': 'تغییر وضعیت سفارش',
  'order.tracking': 'ثبت کد رهگیری',
  'order.settle_cash': 'ثبت دریافت وجه',
  'category.upsert': 'ثبت/ویرایش دسته',
  'category.delete': 'حذف دسته',
  'brand.upsert': 'ثبت/ویرایش برند',
  'brand.delete': 'حذف برند',
  'shipping.upsert': 'ثبت/ویرایش روش ارسال',
  'shipping.delete': 'حذف روش ارسال',
  'customer.activate': 'فعال‌سازی مشتری',
  'customer.deactivate': 'مسدودسازی مشتری',
  'settings.update': 'تغییر تنظیمات فروشگاه',
  'seo.submissions.retry': 'تلاش دوباره برای ارسال به موتور جست‌وجو',
  'seo.submissions.drain': 'پردازش صف ارسال به موتور جست‌وجو',
  'import.validate': 'بررسی فایل ورودی',
  'import.commit': 'اعمال فایل ورودی',
  'import.discard': 'کنارگذاشتن فایل ورودی',
  'vehicle.upsert': 'ثبت/ویرایش خودرو',
  'vehicle.delete': 'حذف خودرو',
};

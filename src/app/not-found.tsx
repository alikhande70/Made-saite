import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <div className="container-page flex min-h-[60vh] max-w-lg flex-col items-center justify-center py-10 text-center">
      <p className="text-5xl font-extrabold tabular-nums text-steel-200">۴۰۴</p>
      <h1 className="mt-3 text-xl font-extrabold text-steel-900">صفحه‌ای که دنبالش بودید پیدا نشد</h1>
      <p className="mt-2 text-sm text-muted">
        ممکن است نشانی تغییر کرده باشد یا کالای موردنظر از فروشگاه حذف شده باشد.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <LinkButton href="/" variant="accent">بازگشت به صفحهٔ اصلی</LinkButton>
        <LinkButton href="/categories" variant="secondary">مرور دسته‌بندی‌ها</LinkButton>
      </div>
    </div>
  );
}

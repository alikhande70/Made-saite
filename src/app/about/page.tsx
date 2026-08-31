import type { Metadata } from 'next';
import { getStoreProfile } from '@/application/settings-service';
import { StaticPage } from '@/components/static-page';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'دربارهٔ فروشگاه',
  description: 'دربارهٔ فروشگاه اینترنتی قطعات یدکی خودرو و نحوهٔ ارائهٔ خدمات.',
  alternates: { canonical: '/about' },
};

export default async function AboutPage() {
  const store = await getStoreProfile();
  return (
    <StaticPage
      breadcrumb="دربارهٔ فروشگاه"
      title="دربارهٔ فروشگاه"
      intro={store.tagline}
      sections={[
        ...(store.isDemo
          ? [{
              heading: 'وضعیت این نسخه',
              paragraphs: [
                'این یک نسخهٔ نمایشی از سامانهٔ فروشگاه است. کالاها، قیمت‌ها، موجودی‌ها و حساب‌های کاربری در این نسخه ساختگی هستند و هیچ سفارش واقعی پردازش، بسته‌بندی یا ارسال نمی‌شود.',
                'درگاه پرداخت این نسخه یک درگاه آزمایشی است و هیچ تراکنش مالی واقعی انجام نمی‌دهد.',
              ],
            }]
          : []),
        {
          heading: 'چه می‌فروشیم',
          paragraphs: [
            'قطعات یدکی خودروهای سواری ایرانی و وارداتی، شامل فیلترها، سیستم ترمز، قطعات موتور، جلوبندی، برق خودرو، بدنه، روغن و روانکار، تسمه، شمع و باتری.',
          ],
        },
        {
          heading: 'چرا انتخاب قطعه اینجا ساده‌تر است',
          list: [
            'انتخاب قطعه بر اساس برند، مدل، سال ساخت و موتور خودرو — بدون حدس و خطا.',
            'جست‌وجو با نام قطعه، کد کالا یا شمارهٔ OEM؛ ارقام فارسی و انگلیسی یکسان در نظر گرفته می‌شوند.',
            'مشخصات فنی کامل، ابعاد، وزن، کشور سازنده و مدت ضمانت در صفحهٔ هر کالا.',
            'نمایش شفاف موجودی: هیچ کالایی بیش از موجودی انبار فروخته نمی‌شود.',
          ],
        },
        {
          heading: 'تماس',
          paragraphs: [`تلفن: ${store.phone}`, `نشانی: ${store.address}`, `ساعات کاری: ${store.workingHours}`],
        },
      ]}
    />
  );
}

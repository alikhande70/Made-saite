import Link from 'next/link';
import type { StoreProfile } from '@/application/settings-service';
import { BoxIcon, PhoneIcon, ShieldIcon, TruckIcon, WrenchIcon } from './ui';

const TRUST = [
  { icon: ShieldIcon, title: 'ضمانت اصالت کالا', text: 'تمام قطعات با فاکتور رسمی و ضمانت اصالت عرضه می‌شوند.' },
  { icon: TruckIcon, title: 'ارسال به سراسر کشور', text: 'پست پیشتاز، باربری و پیک تهران بر اساس وزن و مقصد.' },
  { icon: BoxIcon, title: 'بسته‌بندی ایمن', text: 'قطعات حساس با بسته‌بندی ضربه‌گیر ارسال می‌شوند.' },
  { icon: WrenchIcon, title: 'راهنمای فنی', text: 'مشخصات فنی و سازگاری هر قطعه با خودرو در صفحهٔ محصول.' },
];

export function SiteFooter({ store }: { store: StoreProfile }) {
  return (
    <footer className="mt-16 border-t border-line bg-white">
      <div className="container-page grid gap-6 border-b border-line py-10 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST.map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-steel-50 text-steel-700">
              <Icon className="size-5" />
            </span>
            <div>
              <p className="text-sm font-bold text-steel-900">{title}</p>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-muted">{text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="container-page grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-base font-extrabold text-steel-900">{store.name}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">{store.tagline}</p>
          <p className="mt-4 flex items-center gap-2 text-sm text-steel-800">
            <PhoneIcon className="size-4 text-steel-500" />
            <span className="latin-id font-semibold">{store.phone}</span>
          </p>
          <p className="mt-1 text-sm text-muted">{store.address}</p>
        </div>

        <FooterColumn
          title="خرید"
          links={[
            ['/categories', 'دسته‌بندی قطعات'],
            ['/vehicles', 'انتخاب بر اساس خودرو'],
            ['/brands', 'برندها'],
            ['/products', 'همهٔ محصولات'],
          ]}
        />
        <FooterColumn
          title="خدمات مشتریان"
          links={[
            ['/orders/track', 'پیگیری سفارش'],
            ['/account/orders', 'سفارش‌های من'],
            ['/shipping', 'شیوه‌ها و هزینهٔ ارسال'],
            ['/contact', 'تماس با ما'],
          ]}
        />
        <FooterColumn
          title="راهنما"
          links={[
            ['/faq', 'پرسش‌های پرتکرار'],
            ['/about', 'دربارهٔ فروشگاه'],
            ['/terms', 'قوانین و مقررات'],
            ['/privacy', 'حریم خصوصی'],
          ]}
        />
      </div>

      <div className="border-t border-line py-5">
        <div className="container-page flex flex-col items-center justify-between gap-2 text-center text-xs text-muted sm:flex-row sm:text-start">
          <p>© {new Date().getFullYear()} — {store.name}</p>
          {store.isDemo && (
            <p className="rounded-md bg-signal-50 px-2.5 py-1 font-semibold text-signal-800">
              نسخهٔ نمایشی — داده‌ها و قیمت‌ها واقعی نیستند.
            </p>
          )}
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="mb-3 text-sm font-bold text-steel-900">{title}</p>
      <ul className="space-y-2 text-sm">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="text-muted transition-colors hover:text-steel-800">{label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

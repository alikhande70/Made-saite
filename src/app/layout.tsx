import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { ToastProvider } from '@/components/ui/toast';
import { getStoreProfile, siteUrl } from '@/application/settings-service';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const store = await getStoreProfile();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: store.name, template: `%s | ${store.name}` },
    description: store.tagline,
    applicationName: store.name,
    alternates: { canonical: '/' },
    openGraph: {
      type: 'website',
      locale: 'fa_IR',
      siteName: store.name,
      title: store.name,
      description: store.tagline,
    },
    robots: { index: true, follow: true },
    formatDetection: { telephone: false },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#16273b',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await getStoreProfile();

  return (
    /* Persian-first: the document itself is fa/RTL, not a bolted-on override. */
    <html lang="fa" dir="rtl">
      <head>
        {/*
          * Preloaded so the Arabic-range face is in hand before first paint.
          * With `font-display: optional` that is what decides whether the real
          * font is used at all on a cold cache — without the hint it often
          * loses the race and the visitor gets the fallback for the whole view.
          */}
        <link
          rel="preload"
          href="/fonts/vazirmatn-arabic-wght-normal.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
      </head>
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-3 focus:rounded-lg focus:bg-steel-900 focus:px-4 focus:py-2 focus:text-white"
        >
          پرش به محتوای اصلی
        </a>
        <ToastProvider>
          <div className="flex min-h-dvh flex-col">
            <SiteHeader />
            <main id="main" className="flex-1">{children}</main>
            <SiteFooter store={store} />
          </div>
        </ToastProvider>
      </body>
    </html>
  );
}

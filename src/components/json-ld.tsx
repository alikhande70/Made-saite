import { serializeJsonLd } from '@/lib/json-ld';

/** Emits a structured-data block, escaped so page content cannot break out. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}

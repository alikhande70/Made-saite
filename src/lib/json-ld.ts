/**
 * Safe JSON-LD serialisation.
 *
 * `JSON.stringify` does NOT escape `<`, so a value containing `</script>`
 * -- a product title, a description, an admin-entered spec -- would terminate
 * the script element early and let the rest of the string be parsed as HTML.
 * The site's CSP allows inline scripts (Next requires it), so that would be a
 * live stored-XSS vector.
 *
 * Escaping the characters that can start markup inside a script element closes
 * it. U+2028/U+2029 are escaped too: they are valid inside a JSON string but
 * are line terminators in JavaScript, which breaks any consumer that evaluates
 * the block. All five are valid JSON string escapes, so parsers still see
 * exactly the same data.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * BreadcrumbList from the same crumb array the page renders visibly.
 *
 * Only crumbs with an `href` get an `item`: schema.org allows the final crumb
 * (the current page) to omit it, and giving the product a self-referential
 * item would duplicate the canonical.
 */
export function breadcrumbJsonLd(
  crumbs: readonly { label: string; href?: string }[],
  base: string,
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.label,
      ...(crumb.href ? { item: `${base}${crumb.href}` } : {}),
    })),
  };
}

/**
 * Organization + WebSite for the site root.
 *
 * Emitted only from real store-profile data. Fields the shop has not filled in
 * are omitted rather than defaulted, and nothing here asserts a rating, a
 * review count or a claim the shop has not made about itself.
 */
export function organizationJsonLd(input: {
  name: string;
  url: string;
  logoUrl?: string | null;
  phone?: string | null;
  email?: string | null;
}): Record<string, unknown> {
  const contact = input.phone || input.email
    ? {
        contactPoint: [{
          '@type': 'ContactPoint',
          contactType: 'customer service',
          ...(input.phone ? { telephone: input.phone } : {}),
          ...(input.email ? { email: input.email } : {}),
          areaServed: 'IR',
          availableLanguage: ['fa'],
        }],
      }
    : {};
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: input.name,
    url: input.url,
    ...(input.logoUrl ? { logo: `${input.url}${input.logoUrl}` } : {}),
    ...contact,
  };
}

export function webSiteJsonLd(input: { name: string; url: string }): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: input.name,
    url: input.url,
    inLanguage: 'fa-IR',
  };
}

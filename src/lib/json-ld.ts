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

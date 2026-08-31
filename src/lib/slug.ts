/**
 * URL slugs. Persian characters are kept (they are valid in URLs once
 * percent-encoded and read far better than transliteration), while spaces,
 * punctuation and direction marks are stripped.
 */
import { toLatinDigits } from './fa';

export function slugify(input: string): string {
  return toLatinDigits(input)
    .trim()
    .toLowerCase()
    .replace(/[​-‏‪-‮]/g, '') // zero-width & direction marks
    .replace(/[ً-ٰٟ]/g, '')        // harakat
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

/** Appends `-2`, `-3`, … until the slug is unique among `taken`. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const slug = slugify(base) || 'item';
  if (!taken.has(slug)) return slug;
  let n = 2;
  while (taken.has(`${slug}-${n}`)) n += 1;
  return `${slug}-${n}`;
}

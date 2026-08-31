/**
 * Kept as a thin re-export so existing page imports keep working. The rules
 * themselves live in `@/domain/search-visibility`, which is the single
 * authority — two implementations of indexability is exactly the duplication
 * this phase set out to remove.
 */
export type { RawParams } from '@/domain/search-visibility';
export { listingRobots } from '@/domain/search-visibility';

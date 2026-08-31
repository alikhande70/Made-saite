/**
 * No-op stand-in for the `server-only` package under Vitest.
 *
 * The real module throws when imported outside a React Server Component, which
 * is the point of the guard; a Node test runner is neither a server component
 * nor a client bundle, so the check does not apply.
 */
export {};

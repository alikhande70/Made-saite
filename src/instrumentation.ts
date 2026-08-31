/**
 * Startup hook. Next calls `register()` once per server process, before the
 * first request — the only moment a configuration check is worth anything.
 *
 * On a dangerous production configuration this **exits the process**. Throwing
 * is not enough, and that was verified rather than assumed: Next catches the
 * hook's error, logs "Failed to prepare server", and then keeps the process
 * alive answering 500 to every request. A container in that state reports
 * itself as running while serving nothing but errors — an orchestrator sees
 * "up", an operator sees no clear cause, and the deployment's readiness gate
 * has to infer the problem from a 500.
 *
 * Exiting non-zero instead means the container fails to start, the deploy
 * script's readiness gate times out, and the previous release keeps serving.
 */
export async function register(): Promise<void> {
  // Node runtime only: the check reads process.env and must not run in an edge
  // or browser context.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertProductionConfig } = await import('./lib/production-config');

  try {
    assertProductionConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    // Deliberately fatal. See the note above on why throwing is insufficient.
    process.exit(1);
  }
}

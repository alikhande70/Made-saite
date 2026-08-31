/**
 * Verifies the end-to-end database is ready. It no longer creates it.
 *
 * Creation moved to `scripts/e2e-db.ts`, invoked from Playwright's
 * `webServer.command`, because Playwright starts the web server *before*
 * globalSetup: a bootstrap here could not run on a machine where the database
 * had never existed, since the server's readiness probe would 500 until the
 * webServer timeout aborted the whole run.
 *
 * What remains is a guard. If the database is somehow missing or unseeded, the
 * suite should say so in one line rather than fail later as a pile of
 * unexplained assertion errors.
 */
import { E2E_DB_NAME, e2eDatabaseIsReady } from '../../scripts/e2e-db';

export default async function globalSetup(): Promise<void> {
  if (await e2eDatabaseIsReady()) return;

  throw new Error(
    `The end-to-end database "${E2E_DB_NAME}" is missing or has no seeded products.\n` +
    'It is normally created by `npm run test:e2e:db`, which Playwright runs as part of\n' +
    'webServer.command. Run that command directly to see why it failed.',
  );
}

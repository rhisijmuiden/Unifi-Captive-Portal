/**
 * Server-side administrator tasks, run by the installer and by `captive-portal-admin` (as the app user):
 *   node dist/cli/admin.js create            first main administrator with a generated password (only while there are no users)
 *   node dist/cli/admin.js reset [login]     new generated password for a main administrator
 *   node dist/cli/admin.js issue             refresh the console banner
 * Prints JSON, so shell scripts can read it with jq.
 */
import { pool } from '../db/index.js';
import { createInstallerAdmin, refreshConsoleIssue, resetAdminPassword } from '../services/installerAdmin.js';

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case 'create': {
      const creds = await createInstallerAdmin();
      return creds ? { created: true, ...creds } : { created: false };
    }
    case 'reset':
      return { reset: true, ...(await resetAdminPassword(arg)) };
    case 'issue':
      await refreshConsoleIssue();
      return { ok: true };
    default:
      throw new Error('Usage: admin.js create | reset [login] | issue');
  }
}

main()
  .then(async (result) => {
    console.log(JSON.stringify(result));
    await pool.end();
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await pool.end().catch(() => {});
    process.exit(1);
  });

import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { buildApp } from './app.js';
import { syncAllConsoles } from './services/consoles.js';
import { checkHostnames } from './services/hostnames.js';
import { runMonthlyReports } from './services/notifications.js';
import { pollOpenPayments } from './services/payments.js';

await mkdir(config.dataDir, { recursive: true });
await runMigrations();
const app = await buildApp();

const every = (ms: number, job: () => Promise<unknown>) => setInterval(() => job().catch((err) => app.log.error(err)), ms);
const jobs = [
  every(3600_000, purgeExpiredSessions),
  // Keeps the access-point list current, so guests on new access points are recognised
  every(3600_000, syncAllConsoles),
  // Hostnames waiting for DNS or a certificate are retried; active ones are re-verified
  every(5 * 60_000, () => checkHostnames(['pending', 'dns_ok', 'error'])),
  every(6 * 3600_000, () => checkHostnames(['active'])),
  // Payments without a webhook (or a missed one) are checked with the provider
  every(60_000, pollOpenPayments),
  // Last month's report goes out once per customer; checking hourly survives restarts
  every(3600_000, () => runMonthlyReports()),
];

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    jobs.forEach(clearInterval);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`Captive Portal ${config.version} luistert op http://${config.host}:${config.port}`);

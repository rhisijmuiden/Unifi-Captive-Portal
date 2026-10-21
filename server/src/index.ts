import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { buildApp } from './app.js';
import { runScheduledBackups } from './services/backups.js';
import { pollInvoicePayments, runBilling } from './services/billing.js';
import { syncAllConsoles } from './services/consoles.js';
import { checkHostnames } from './services/hostnames.js';
import { runMonitoringAlerts } from './services/monitoring.js';
import { runMonthlyReports } from './services/notifications.js';
import { purgeApiRequests } from './services/apiKeys.js';
import { pollOpenPayments } from './services/payments.js';
import { deliverDue, purgeDeliveries } from './services/webhooks.js';

await mkdir(config.dataDir, { recursive: true });
await runMigrations();
const app = await buildApp();

const every = (ms: number, job: () => Promise<unknown>) => setInterval(() => job().catch((err) => app.log.error(err)), ms);
const jobs = [
  every(3600_000, purgeExpiredSessions),
  // Checks every console: keeps the access-point list current (so guests on new access points are
  // recognised) and tracks outages; customers are alerted once an outage passes their threshold
  every(5 * 60_000, () => syncAllConsoles().then(() => runMonitoringAlerts())),
  // Hostnames waiting for DNS or a certificate are retried; active ones are re-verified
  every(5 * 60_000, () => checkHostnames(['pending', 'dns_ok', 'error'])),
  every(6 * 3600_000, () => checkHostnames(['active'])),
  // Payments without a webhook (or a missed one) are checked with the provider
  every(60_000, pollOpenPayments),
  // Last month's report goes out once per customer; checking hourly survives restarts
  every(3600_000, () => runMonthlyReports()),
  // Subscription invoices, reminders and pausing portals for unpaid invoices; hourly is safe, each step runs once
  every(3600_000, () => runBilling()),
  every(60_000, pollInvoicePayments),
  // Backup schedules are checked every minute; one backup runs at a time
  every(60_000, () => runScheduledBackups()),
  // Webhook retries; the API audit trail and delivery history are trimmed daily
  every(30_000, () => deliverDue()),
  every(24 * 3600_000, () => Promise.all([purgeApiRequests(), purgeDeliveries()])),
];
// Run the billing once shortly after start, so a restart on the 1st does not wait an hour
setTimeout(() => runBilling().catch((err) => app.log.error(err)), 30_000).unref();

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

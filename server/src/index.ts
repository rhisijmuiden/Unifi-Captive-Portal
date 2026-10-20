import { mkdir } from 'node:fs/promises';
import { config } from './config.js';
import { pool } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { purgeExpiredSessions } from './lib/auth.js';
import { buildApp } from './app.js';

await mkdir(config.dataDir, { recursive: true });
await runMigrations();
const app = await buildApp();

const cleanup = setInterval(() => purgeExpiredSessions().catch((err) => app.log.error(err)), 3600_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    clearInterval(cleanup);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`Captive Portal ${config.version} luistert op http://${config.host}:${config.port}`);

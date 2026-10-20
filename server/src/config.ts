import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    APP_SECRET: z.string().min(16, 'APP_SECRET must be at least 16 characters'),
    PORT: z.coerce.number().int().default(8080),
    HOST: z.string().default('0.0.0.0'),
    PUBLIC_URL: z.string().url().default('http://localhost:8080'),
    DATA_DIR: z.string().default('./data'),
    UPDATE_REPO: z.string().default('rhisijmuiden/Unifi-Captive-Portal'),
    NODE_ENV: z.string().default('production'),
  })
  .parse(process.env);

function readVersion(): string {
  // dist/config.js and src/config.ts both resolve ../../package.json to the repository root
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  return pkg.version as string;
}

export const config = {
  databaseUrl: env.DATABASE_URL,
  appSecret: env.APP_SECRET,
  port: env.PORT,
  host: env.HOST,
  publicUrl: env.PUBLIC_URL.replace(/\/$/, ''),
  dataDir: resolve(env.DATA_DIR),
  updateRepo: env.UPDATE_REPO,
  isDev: env.NODE_ENV === 'development',
  version: readVersion(),
};

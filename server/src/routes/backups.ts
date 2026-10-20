import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, requireSuperadmin } from '../lib/auth.js';
import { getSettings } from '../services/settings.js';
import {
  createTarget,
  currentJob,
  deleteTarget,
  ensureSshKey,
  listRuns,
  listTargets,
  localBase,
  publicTarget,
  readRestoreStatus,
  regenerateSshKey,
  remoteSets,
  saveBackupSettings,
  startBackup,
  startRestore,
  targetSchema,
  testTarget,
  updateTarget,
} from '../services/backups.js';
import { selfUpdateEnabled } from '../services/updater.js';

/** Backups are a server feature: only the platform admin sees and manages them. */
export async function backupRoutes(app: FastifyInstance) {
  const overview = async () => {
    const settings = await getSettings('backup');
    return {
      settings: { passphraseSet: Boolean(settings.passphrase), notifyOnFailure: settings.notifyOnFailure, sshPublicKey: settings.sshPublicKey },
      targets: (await listTargets()).map(publicTarget),
      runs: await listRuns(),
      job: currentJob(),
      restore: await readRestoreStatus(),
      restoreAvailable: await selfUpdateEnabled(),
      localBase,
    };
  };

  app.get('/api/backups', async (req) => {
    requireSuperadmin(req);
    return overview();
  });

  // Polled while a backup or restore runs; small on purpose
  app.get('/api/backups/status', async (req) => {
    requireSuperadmin(req);
    return { job: currentJob(), restore: await readRestoreStatus() };
  });

  app.put('/api/backups/settings', async (req) => {
    requireSuperadmin(req);
    const input = z.object({ passphrase: z.string().max(500).nullable().optional(), notifyOnFailure: z.boolean().optional() }).parse(req.body);
    await saveBackupSettings(input);
    await audit(req, 'backup.settings_updated', { passphraseChanged: Boolean(input.passphrase) }, null);
    return overview();
  });

  app.post('/api/backups/ssh-key', async (req) => {
    requireSuperadmin(req);
    const { regenerate } = z.object({ regenerate: z.boolean().default(false) }).parse(req.body);
    const publicKey = regenerate ? await regenerateSshKey() : await ensureSshKey();
    if (regenerate) await audit(req, 'backup.ssh_key_regenerated', {}, null);
    return { publicKey };
  });

  app.post('/api/backups/targets/test', async (req) => {
    requireSuperadmin(req);
    const { id, ...form } = z.object({ id: z.string().uuid().optional() }).passthrough().parse(req.body);
    return testTarget(targetSchema.parse(form), id);
  });

  app.post('/api/backups/targets', async (req) => {
    requireSuperadmin(req);
    const target = await createTarget(targetSchema.parse(req.body));
    await audit(req, 'backup.target_created', { name: target.name, type: target.type }, null);
    return publicTarget(target);
  });

  app.put<{ Params: { id: string } }>('/api/backups/targets/:id', async (req) => {
    requireSuperadmin(req);
    const target = await updateTarget(req.params.id, targetSchema.parse(req.body));
    await audit(req, 'backup.target_updated', { name: target.name }, null);
    return publicTarget(target);
  });

  app.delete<{ Params: { id: string } }>('/api/backups/targets/:id', async (req) => {
    requireSuperadmin(req);
    await deleteTarget(req.params.id);
    await audit(req, 'backup.target_deleted', { id: req.params.id }, null);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/backups/targets/:id/run', async (req) => {
    requireSuperadmin(req);
    const { type } = z.object({ type: z.enum(['full', 'incremental']) }).parse(req.body);
    await startBackup(req.params.id, type);
    await audit(req, 'backup.started', { targetId: req.params.id, type }, null);
    return { job: currentJob() };
  });

  app.get<{ Params: { id: string } }>('/api/backups/targets/:id/sets', async (req) => {
    requireSuperadmin(req);
    return remoteSets(req.params.id);
  });

  app.post<{ Params: { id: string; setId: string } }>('/api/backups/targets/:id/sets/:setId/restore', async (req) => {
    const user = requireSuperadmin(req);
    const { passphrase, confirm } = z.object({ passphrase: z.string().max(500).optional(), confirm: z.literal(true) }).parse(req.body);
    void confirm;
    await audit(req, 'backup.restore_requested', { targetId: req.params.id, setId: req.params.setId }, null);
    await startRestore(req.params.id, req.params.setId, passphrase, user.email);
    return { job: currentJob(), restore: await readRestoreStatus() };
  });
}

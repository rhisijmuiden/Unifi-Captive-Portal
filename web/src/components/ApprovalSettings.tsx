import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Check, RotateCcw, ShieldOff, UserCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { useConfirm } from './controls';
import { Section } from './SignInSettings';
import { Badge, Button, Field, Switch, Textarea, cx } from './ui';

type Status = 'pending' | 'approved' | 'rejected' | 'revoked' | 'unblocked' | 'expired';
type AccessRequest = {
  id: string;
  clientMac: string;
  ssid: string | null;
  name: string | null;
  email: string | null;
  message: string | null;
  status: Status;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  /** The latest request of its device: the one in force. */
  current: boolean;
};

const tones: Record<Status, 'neutral' | 'online' | 'warning' | 'offline' | 'accent' | 'info'> = {
  pending: 'warning',
  approved: 'online',
  rejected: 'offline',
  revoked: 'neutral',
  unblocked: 'neutral',
  expired: 'neutral',
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const parseList = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

/** "Ask for access": who decides, and whether an approved device stays welcome. Saved with the portal settings. */
export function ApprovalSettings({
  approvers,
  remember,
  onApprovers,
  onRemember,
}: {
  approvers: string[];
  remember: boolean;
  onApprovers: (v: string[]) => void;
  onRemember: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(approvers.join('\n'));
  // Follow the saved list (e.g. after saving), but leave the text alone while it means the same
  useEffect(() => {
    setText((current) => (parseList(current).join('\n') === approvers.join('\n') ? current : approvers.join('\n')));
  }, [approvers]);
  const invalid = parseList(text).filter((e) => !EMAIL.test(e));
  return (
    <Section title={t('portalSettings.approval.title')} description={t('portalSettings.approval.description')}>
      {!approvers.length && <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">{t('portalSettings.approval.notReady')}</p>}
      <Field label={t('portalSettings.approval.approvers')} htmlFor="ap-list" hint={invalid.length ? undefined : t('portalSettings.approval.approversHint')} error={invalid.length ? t('portalSettings.approval.invalid', { list: invalid.join(', ') }) : undefined}>
        <Textarea
          id="ap-list"
          rows={4}
          className="font-mono text-sm"
          placeholder={'reception@example.com\nmanager@example.com'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onApprovers([...new Set(parseList(e.target.value))]);
          }}
        />
      </Field>
      <Switch checked={remember} onChange={onRemember} label={t('portalSettings.approval.remember')} description={t('portalSettings.approval.rememberHint')} />
      <p className="text-xs text-muted">{t('portalSettings.approval.mailNote')}</p>
    </Section>
  );
}

/** The requests, newest first, with the decision an admin can take on each device. */
export function AccessRequests({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [dialog, ask] = useConfirm();
  // New requests arrive while the page is open
  const { data } = useQuery({ queryKey: ['access-requests'], queryFn: () => api.get<{ requests: AccessRequest[] }>('/access-requests'), refetchInterval: 15_000 });
  const act = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' | 'clear' }) => api.post<{ status: Exclude<Status, 'pending' | 'expired'>; connected: boolean }>(`/access-requests/${id}/decision`, { decision }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      toast.success(d.status === 'approved' && d.connected ? t('portalSettings.approval.connected') : t(`portalSettings.approval.done.${d.status}`));
    },
    onError: (e: Error) => {
      qc.invalidateQueries({ queryKey: ['access-requests'] });
      toast.error(e.message);
    },
  });
  const requests = data?.requests ?? [];
  const busy = (id: string) => act.isPending && act.variables?.id === id;

  return (
    <Section title={t('portalSettings.approval.requests')} description={t('portalSettings.approval.requestsHint')}>
      {!requests.length ? (
        <p className="text-sm text-muted">{t('portalSettings.approval.none')}</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {requests.map((r) => {
            const open = r.current && (r.status === 'pending' || r.status === 'expired');
            return (
              <li key={r.id} className={cx('flex flex-wrap items-start gap-3 py-3', !r.current && 'opacity-60')}>
                <UserCheck className={cx('mt-0.5 size-4 shrink-0', r.status === 'approved' ? 'text-online' : r.status === 'rejected' ? 'text-offline' : 'text-muted')} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.name || '—'}
                    {r.email && <span className="font-normal text-muted"> · {r.email}</span>}
                  </p>
                  {r.message && <p className="mt-0.5 whitespace-pre-line text-muted">{r.message}</p>}
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-mono">{r.clientMac}</span>
                    {r.ssid && <> · {r.ssid}</>} · <span title={formatDate(r.createdAt)}>{timeAgo(r.createdAt)}</span>
                    {r.decidedBy && r.decidedAt && <> · {t('portalSettings.approval.decidedBy', { by: r.decidedBy, time: formatDate(r.decidedAt) })}</>}
                  </p>
                </div>
                <Badge tone={tones[r.status]}>{t(`portalSettings.approval.status.${r.status}`)}</Badge>
                {canManage && r.current && (
                  <div className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                    {open && (
                      <>
                        <Button size="sm" variant="accent" icon={<Check className="size-4" />} loading={busy(r.id) && act.variables?.decision === 'approve'} onClick={() => act.mutate({ id: r.id, decision: 'approve' })}>
                          {t('portalSettings.approval.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<X className="size-4" />}
                          loading={busy(r.id) && act.variables?.decision === 'reject'}
                          onClick={async () => (await ask(t('portalSettings.approval.rejectConfirm'))) && act.mutate({ id: r.id, decision: 'reject' })}
                        >
                          {t('portalSettings.approval.reject')}
                        </Button>
                      </>
                    )}
                    {r.status === 'approved' && (
                      <Button size="sm" variant="secondary" icon={<ShieldOff className="size-4" />} loading={busy(r.id)} onClick={async () => (await ask(t('portalSettings.approval.revokeConfirm'))) && act.mutate({ id: r.id, decision: 'clear' })}>
                        {t('portalSettings.approval.revoke')}
                      </Button>
                    )}
                    {r.status === 'rejected' && (
                      <Button size="sm" variant="secondary" icon={<RotateCcw className="size-4" />} loading={busy(r.id)} onClick={() => act.mutate({ id: r.id, decision: 'clear' })}>
                        {t('portalSettings.approval.unblock')}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="flex items-center gap-2 text-xs text-muted">
        <Ban className="size-3.5" />
        {t('portalSettings.approval.blockNote')}
      </p>
      {dialog}
    </Section>
  );
}

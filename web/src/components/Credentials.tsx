import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Mail, MailPlus, MailX, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Field, Modal, Select, Spinner, Switch, cx } from './ui';
import { api, type User } from '../lib/api';
import { useAuth } from '../lib/auth';

export type CredentialsMode = 'invite' | 'generate' | 'none';
export type GeneratedCredentials = { loginUrl: string; email: string; password: string; mustChangePassword: boolean };

/** How a new account gets in: an e-mail to choose a password, or login details to pass on right away. */
export function CredentialsChoice({
  value,
  onChange,
  mustChange,
  onMustChange,
  allowNone = false,
}: {
  allowNone?: boolean;
  value: CredentialsMode;
  onChange: (v: CredentialsMode) => void;
  mustChange: boolean;
  onMustChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  const options = [
    { value: 'invite' as const, icon: <MailPlus className="size-4" />, label: t('credentials.invite') },
    { value: 'generate' as const, icon: <KeyRound className="size-4" />, label: t('credentials.generate') },
    ...(allowNone ? [{ value: 'none' as const, icon: <MailX className="size-4" />, label: t('credentials.none') }] : []),
  ];
  return (
    <div className="space-y-3">
      <div className={cx('grid gap-2', allowNone ? 'sm:grid-cols-3' : 'sm:grid-cols-2')} role="radiogroup" aria-label={t('credentials.how')}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition',
              value === o.value ? 'border-koraal bg-koraal/8 text-ink ring-1 ring-koraal' : 'border-line text-muted hover:border-ink/30 hover:text-ink',
            )}
          >
            <span className={value === o.value ? 'text-accent' : ''}>{o.icon}</span>
            {o.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{t(`credentials.${value}Hint`)}</p>
      {value === 'generate' && <Switch checked={mustChange} onChange={onMustChange} label={t('credentials.mustChange')} description={t('credentials.mustChangeHint')} />}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const { t } = useTranslation();
  const copy = () => navigator.clipboard.writeText(value).then(() => toast.success(t('common.copied')));
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
        <code className={mono ? 'flex-1 truncate font-mono text-sm tracking-wide' : 'flex-1 truncate text-sm'}>{value}</code>
        <button type="button" className="text-muted hover:text-ink" aria-label={t('common.copy')} title={t('common.copy')} onClick={copy}>
          <Copy className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** Shows generated login details once, ready to paste into a chat app such as WhatsApp. */
export function CredentialsDialog({ credentials, name, onClose }: { credentials: GeneratedCredentials; name: string; onClose: () => void }) {
  const { t } = useTranslation();
  const message = [
    t('credentials.messageHello', { name }),
    '',
    t('credentials.messageIntro'),
    `${t('credentials.loginUrl')}: ${credentials.loginUrl}`,
    `${t('credentials.username')}: ${credentials.email}`,
    `${t('credentials.password')}: ${credentials.password}`,
    ...(credentials.mustChangePassword ? ['', t('credentials.messageChange')] : []),
  ].join('\n');
  const copyAll = () => navigator.clipboard.writeText(message).then(() => toast.success(t('credentials.messageCopied')));
  return (
    <Modal
      open
      onClose={onClose}
      title={t('credentials.title')}
      description={t('credentials.description', { name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="accent" icon={<Copy className="size-4" />} onClick={copyAll}>
            {t('credentials.copyMessage')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Row label={t('credentials.loginUrl')} value={credentials.loginUrl} />
        <Row label={t('credentials.username')} value={credentials.email} />
        <Row label={t('credentials.password')} value={credentials.password} mono />
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('credentials.preview')}</p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-sunken p-3 font-sans text-sm whitespace-pre-wrap">{message}</pre>
        </div>
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {t('credentials.onceWarning')}
        </p>
      </div>
    </Modal>
  );
}

type ResetMethod = 'mail' | 'generate';
const roleOrder: Record<string, number> = { reseller_admin: 0, tenant_admin: 1, tenant_user: 2, superadmin: 3 };

/**
 * Resets someone's password: a reset e-mail, or new login details to pass on yourself.
 * Pass a user directly (Users page), or a customer or reseller to pick one of its people.
 */
export function PasswordResetDialog({ user, scope, onClose }: { user?: User; scope?: { tenantId: string } | { resellerId: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: auth } = useAuth();
  const me = auth?.user;
  const mailAvailable = auth?.passwordResetAvailable ?? false;
  const query = scope ? ('tenantId' in scope ? `tenantId=${scope.tenantId}` : `resellerId=${scope.resellerId}`) : '';
  const people = useQuery({ queryKey: ['users', 'reset', query], queryFn: () => api.get<{ users: User[] }>(`/users?${query}`), enabled: !user });
  const candidates = user
    ? [user]
    : (people.data?.users ?? []).filter((u) => u.id !== me?.id && u.isActive).sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.name.localeCompare(b.name));
  const [pickedId, setPickedId] = useState('');
  const target = candidates.find((u) => u.id === pickedId) ?? candidates[0];
  const [method, setMethod] = useState<ResetMethod>(mailAvailable ? 'mail' : 'generate');
  const [mustChange, setMustChange] = useState(true);
  const [issued, setIssued] = useState<GeneratedCredentials | null>(null);

  const reset = useMutation({
    mutationFn: async (u: User) =>
      method === 'mail'
        ? { mail: await api.post<{ kind: 'reset' | 'invite' }>(`/users/${u.id}/reset-mail`) }
        : { credentials: (await api.post<{ credentials: GeneratedCredentials }>(`/users/${u.id}/password`, { mustChangePassword: mustChange })).credentials },
    onSuccess: (res, u) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      if (res.credentials) return setIssued(res.credentials);
      toast.success(t(res.mail?.kind === 'invite' ? 'passwordReset.inviteSent' : 'passwordReset.mailSent', { email: u.email }));
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (issued && target) return <CredentialsDialog credentials={issued} name={target.name} onClose={onClose} />;
  const methods = [
    { value: 'mail' as const, icon: <Mail className="size-4" />, label: t('passwordReset.mail'), disabled: !mailAvailable },
    { value: 'generate' as const, icon: <KeyRound className="size-4" />, label: t('passwordReset.generate'), disabled: false },
  ];
  const hint =
    method === 'mail'
      ? target && !target.hasPassword
        ? t('passwordReset.mailInviteHint')
        : t('passwordReset.mailHint')
      : t('passwordReset.generateHint', { name: target?.name ?? '' });

  return (
    <Modal
      open
      onClose={onClose}
      title={t('passwordReset.title')}
      description={target ? t('passwordReset.description', { name: target.name, email: target.email }) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="accent" disabled={!target} loading={reset.isPending} onClick={() => target && reset.mutate(target)}>
            {method === 'mail' ? t('passwordReset.sendMail') : t('passwordReset.generateConfirm')}
          </Button>
        </>
      }
    >
      {!user && people.isLoading ? (
        <Spinner />
      ) : !target ? (
        <p className="text-sm text-muted">{t('passwordReset.nobody')}</p>
      ) : (
        <div className="space-y-4">
          {candidates.length > 1 && (
            <Field label={t('passwordReset.who')} htmlFor="pr-user">
              <Select id="pr-user" value={target.id} onChange={(e) => setPickedId(e.target.value)}>
                {candidates.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} · {u.email} ({t(`roles.${u.role}`)})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t('passwordReset.how')}>
            {methods.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={method === o.value}
                disabled={o.disabled}
                onClick={() => setMethod(o.value)}
                className={cx(
                  'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                  method === o.value ? 'border-koraal bg-koraal/8 text-ink ring-1 ring-koraal' : 'border-line text-muted hover:border-ink/30 hover:text-ink',
                )}
              >
                <span className={method === o.value ? 'text-accent' : ''}>{o.icon}</span>
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">{hint}</p>
          {!mailAvailable && <p className="text-xs text-muted">{t('passwordReset.noMail')}</p>}
          {method === 'generate' && <Switch checked={mustChange} onChange={setMustChange} label={t('credentials.mustChange')} description={t('credentials.mustChangeHint')} />}
          {target.ssoLinked && <p className="text-xs text-muted">{t('passwordReset.ssoNote')}</p>}
          {target.twoFactorEnabled && <p className="text-xs text-muted">{t('passwordReset.twoFactorNote')}</p>}
        </div>
      )}
    </Modal>
  );
}

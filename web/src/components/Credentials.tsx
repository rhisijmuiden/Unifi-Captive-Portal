import { Copy, KeyRound, MailPlus, MailX, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button, Modal, Switch, cx } from './ui';

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

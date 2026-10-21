import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { useRefreshAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import { Copyable } from './controls';
import { Badge, Button, Card, CardHeader, Field, Input, Modal } from './ui';

/** The six-digit field for authenticator codes; also accepts recovery codes when allowed. */
export function CodeInput({ value, onChange, recovery, id = 'otp' }: { value: string; onChange: (v: string) => void; recovery?: boolean; id?: string }) {
  return (
    <Input
      id={id}
      autoFocus
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      maxLength={recovery ? 12 : 6}
      placeholder={recovery ? '123456 / ABCD-EFGH' : '123456'}
      className="h-12 text-center font-mono text-xl tracking-[0.35em]"
      value={value}
      onChange={(e) => onChange(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, ''))}
    />
  );
}

export function RecoveryCodes({ codes }: { codes: string[] }) {
  const { t } = useTranslation();
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${t('twoFactor.recoveryFileTitle')}\n\n${text}\n`], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'captive-portal-recovery-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="space-y-3">
      <p className="rounded-lg bg-warning/12 px-3 py-2 text-xs text-warning">{t('twoFactor.recoveryWarning')}</p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl bg-sunken p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="text-center">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(t('common.copied')))}>
          {t('common.copy')}
        </Button>
        <Button variant="secondary" size="sm" icon={<Download className="size-4" />} onClick={download}>
          {t('twoFactor.download')}
        </Button>
      </div>
    </div>
  );
}

/** Set-up in three steps: scan the QR code, confirm with a code, keep the recovery codes. */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const setup = useMutation({ mutationFn: () => api.post<{ secret: string; uri: string; qrSvg: string }>('/auth/2fa/setup') });
  const enable = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code }),
    onSuccess: (d) => setCodes(d.recoveryCodes),
  });

  if (codes)
    return (
      <div className="space-y-4">
        <p className="flex items-center gap-2 font-semibold text-online">
          <ShieldCheck className="size-5" /> {t('twoFactor.enabled')}
        </p>
        <p className="text-sm text-muted">{t('twoFactor.recoveryIntro')}</p>
        <RecoveryCodes codes={codes} />
        <Button variant="accent" className="w-full" onClick={onDone}>
          {t('twoFactor.savedCodes')}
        </Button>
      </div>
    );

  if (!setup.data)
    return (
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl bg-sunken p-4 text-sm">
          <Smartphone className="mt-0.5 size-5 shrink-0 text-accent" />
          <p className="text-muted">{t('twoFactor.appHint')}</p>
        </div>
        {setup.error && <p className="text-sm text-offline">{setup.error.message}</p>}
        <Button variant="accent" className="w-full" loading={setup.isPending} onClick={() => setup.mutate()}>
          {t('twoFactor.start')}
        </Button>
      </div>
    );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        enable.mutate();
      }}
    >
      <p className="text-sm text-muted">{t('twoFactor.scan')}</p>
      <div className="mx-auto w-48 rounded-xl border border-line bg-white p-2">
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.data.qrSvg)}`} alt={t('twoFactor.qrAlt')} className="block w-full" />
      </div>
      <Field label={t('twoFactor.manual')} hint={t('twoFactor.manualHint')}>
        <Copyable value={setup.data.secret.replace(/(.{4})/g, '$1 ').trim()} />
      </Field>
      <Field label={t('twoFactor.code')} htmlFor="tf-code">
        <CodeInput id="tf-code" value={code} onChange={setCode} />
      </Field>
      {enable.error && <p className="text-sm text-offline">{enable.error.message}</p>}
      <Button type="submit" variant="accent" className="w-full" loading={enable.isPending} disabled={code.length !== 6}>
        {t('twoFactor.confirm')}
      </Button>
    </form>
  );
}

type Status = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number; required: boolean };

/** Card on "My account": turn two-factor sign-in on or off, and renew the recovery codes. */
export function TwoFactorCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const refresh = useRefreshAuth();
  const { data } = useQuery({ queryKey: ['2fa'], queryFn: () => api.get<Status>('/auth/2fa') });
  const [modal, setModal] = useState<'setup' | 'disable' | 'codes' | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const done = () => {
    setModal(null);
    setCode('');
    setCodes(null);
    qc.invalidateQueries({ queryKey: ['2fa'] });
    refresh();
  };
  const disable = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable', { code }),
    onSuccess: () => {
      toast.success(t('twoFactor.disabled'));
      done();
    },
  });
  const renew = useMutation({ mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', { code }), onSuccess: (d) => setCodes(d.recoveryCodes) });

  return (
    <Card>
      <CardHeader
        title={t('twoFactor.title')}
        description={t('twoFactor.description')}
        action={data && (data.enabled ? <Badge tone="online">{t('twoFactor.on')}</Badge> : <Badge tone={data.required ? 'warning' : 'neutral'}>{t('twoFactor.off')}</Badge>)}
      />
      <div className="space-y-4 p-6">
        {data?.enabled ? (
          <>
            <p className="text-sm text-muted">
              {t('twoFactor.since', { date: formatDate(data.enabledAt) })} · {t('twoFactor.codesLeft', { count: data.recoveryCodesLeft })}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setModal('codes')}>
                {t('twoFactor.newCodes')}
              </Button>
              {!data.required && (
                <Button variant="ghost" icon={<ShieldOff className="size-4" />} onClick={() => setModal('disable')}>
                  {t('twoFactor.turnOff')}
                </Button>
              )}
            </div>
            {data.required && <p className="text-xs text-muted">{t('twoFactor.requiredNote')}</p>}
          </>
        ) : (
          <>
            <p className="text-sm text-muted">{data?.required ? t('twoFactor.requiredHint') : t('twoFactor.offHint')}</p>
            <Button variant="accent" icon={<ShieldCheck className="size-4" />} onClick={() => setModal('setup')}>
              {t('twoFactor.turnOn')}
            </Button>
          </>
        )}
      </div>

      <Modal open={modal === 'setup'} onClose={done} title={t('twoFactor.setupTitle')}>
        <TwoFactorSetup onDone={done} />
      </Modal>
      <Modal
        open={modal === 'disable' || modal === 'codes'}
        onClose={done}
        title={modal === 'disable' ? t('twoFactor.turnOff') : t('twoFactor.newCodes')}
        description={codes ? undefined : t('twoFactor.confirmWithCode')}
        footer={
          codes ? (
            <Button variant="accent" onClick={done}>
              {t('twoFactor.savedCodes')}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={done}>
                {t('common.cancel')}
              </Button>
              <Button variant={modal === 'disable' ? 'danger' : 'accent'} loading={disable.isPending || renew.isPending} onClick={() => (modal === 'disable' ? disable.mutate() : renew.mutate())}>
                {modal === 'disable' ? t('twoFactor.turnOff') : t('twoFactor.generate')}
              </Button>
            </>
          )
        }
      >
        {codes ? (
          <RecoveryCodes codes={codes} />
        ) : (
          <div className="space-y-2">
            <CodeInput value={code} onChange={setCode} recovery />
            {(disable.error || renew.error) && <p className="text-sm text-offline">{(disable.error ?? renew.error)!.message}</p>}
          </div>
        )}
      </Modal>
    </Card>
  );
}

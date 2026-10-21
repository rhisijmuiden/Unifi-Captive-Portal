import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { TwoFactorCard } from '../components/TwoFactor';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select } from '../components/ui';
import { useTranslation } from 'react-i18next';
import { languages, type Locale } from '../i18n';
import { useChangeLanguage } from '../components/LanguageSwitcher';
import { api } from '../lib/api';
import { useAuth, useRefreshAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

export function AccountPage() {
  const { t, i18n } = useTranslation();
  const changeLanguage = useChangeLanguage();
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const user = data!.user!;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { current, password }),
    onSuccess: () => {
      toast.success(t('account.passwordChanged'));
      setCurrent('');
      setPassword('');
      refresh();
    },
  });

  return (
    <>
      <PageHeader eyebrow={t('account.eyebrow')} title={t('account.title')} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title={t('account.profile')} />
          <dl className="divide-y divide-line text-sm">
            {[
              [t('account.name'), user.name],
              [t('account.email'), user.email],
              [t('account.role'), t(`roles.${user.role}`)],
              [t('account.lastLogin'), formatDate(user.lastLoginAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-6 py-3">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 px-6 py-3">
              <dt className="text-muted">{t('account.microsoft')}</dt>
              <dd>
                {user.ssoLinked ? (
                  <Badge tone="info">
                    <KeyRound className="size-3" /> {t('account.linked')}
                  </Badge>
                ) : (
                  <Badge>{t('account.notLinked')}</Badge>
                )}
              </dd>
            </div>
          </dl>
          <div className="border-t border-line px-6 py-4">
            <Field label={t('account.language')} htmlFor="lang" hint={t('account.languageHint')}>
              <Select id="lang" value={i18n.resolvedLanguage} onChange={(e) => changeLanguage(e.target.value as Locale)}>
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title={user.hasPassword ? t('account.changePassword') : t('account.setPassword')} />
          <form
            className="space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate();
            }}
          >
            {user.hasPassword && (
              <Field label={t('account.currentPassword')} htmlFor="cur">
                <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            )}
            <Field label={t('account.newPassword')} htmlFor="new" hint={t('auth.passwordHint')}>
              <Input id="new" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {change.error && <p className="text-sm text-offline">{change.error.message}</p>}
            <Button type="submit" loading={change.isPending}>
              {t('common.save')}
            </Button>
          </form>
        </Card>
        <TwoFactorCard />
      </div>
    </>
  );
}

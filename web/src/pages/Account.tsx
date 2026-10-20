import { useMutation } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader } from '../components/ui';
import { api, roleLabel } from '../lib/api';
import { useAuth, useRefreshAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

export function AccountPage() {
  const { data } = useAuth();
  const refresh = useRefreshAuth();
  const user = data!.user!;
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { current, password }),
    onSuccess: () => {
      toast.success('Wachtwoord gewijzigd');
      setCurrent('');
      setPassword('');
      refresh();
    },
  });

  return (
    <>
      <PageHeader eyebrow="Account" title="Mijn account" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profiel" />
          <dl className="divide-y divide-line text-sm">
            {[
              ['Naam', user.name],
              ['E-mailadres', user.email],
              ['Rol', roleLabel[user.role]],
              ['Laatst ingelogd', formatDate(user.lastLoginAt)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-6 py-3">
                <dt className="text-muted">{k}</dt>
                <dd className="font-medium">{v}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-4 px-6 py-3">
              <dt className="text-muted">Microsoft-account</dt>
              <dd>
                {user.ssoLinked ? (
                  <Badge tone="info">
                    <KeyRound className="size-3" /> Gekoppeld
                  </Badge>
                ) : (
                  <Badge>Niet gekoppeld</Badge>
                )}
              </dd>
            </div>
          </dl>
        </Card>
        <Card>
          <CardHeader title={user.hasPassword ? 'Wachtwoord wijzigen' : 'Wachtwoord instellen'} />
          <form
            className="space-y-4 p-6"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate();
            }}
          >
            {user.hasPassword && (
              <Field label="Huidig wachtwoord" htmlFor="cur">
                <Input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            )}
            <Field label="Nieuw wachtwoord" htmlFor="new" hint="Minimaal 10 tekens.">
              <Input id="new" type="password" autoComplete="new-password" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {change.error && <p className="text-sm text-offline">{change.error.message}</p>}
            <Button type="submit" loading={change.isPending}>
              Opslaan
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

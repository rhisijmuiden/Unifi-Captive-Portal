import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareQuote, Star } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Segmented } from '../components/controls';
import { Section } from '../components/SignInSettings';
import { Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, Spinner, Switch, cx } from '../components/ui';
import { languages } from '../i18n';
import { api } from '../lib/api';
import { formatDate } from '../lib/format';
import { useTenantScope } from '../lib/tenant';

type SurveyForm = { enabled: boolean; question: Record<string, string>; allowComment: boolean; googleReviewUrl: string; reviewButton: boolean };
type Results = {
  days: number;
  count: number;
  average: number | null;
  byStar: { rating: number; count: number }[];
  weeks: { week: string; count: number; average: number }[];
  comments: { id: string; rating: number; comment: string; locale: string | null; createdAt: string }[];
};

const Stars = ({ value, className }: { value: number; className?: string }) => (
  <span className={cx('inline-flex gap-0.5', className)} aria-label={`${value} / 5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} className={cx('size-4', n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-line')} />
    ))}
  </span>
);

function SurveySettings({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['survey-settings'], queryFn: () => api.get<{ settings: SurveyForm }>('/survey-settings') });
  const [form, setForm] = useState<SurveyForm | null>(null);
  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);
  const save = useMutation({
    mutationFn: () => api.put<{ settings: SurveyForm }>('/survey-settings', form),
    onSuccess: (d) => {
      qc.setQueryData(['survey-settings'], d);
      toast.success(t('common.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form) return <Spinner />;
  const set = <K extends keyof SurveyForm>(k: K, v: SurveyForm[K]) => setForm({ ...form, [k]: v });
  return (
    <Section
      title={t('feedback.settings')}
      description={t('feedback.settingsHint')}
      action={
        canManage && (
          <Button variant="accent" size="sm" loading={save.isPending} onClick={() => save.mutate()}>
            {t('common.save')}
          </Button>
        )
      }
    >
      <Switch checked={form.enabled} onChange={(v) => set('enabled', v)} label={t('feedback.enabled')} description={t('feedback.enabledHint')} />
      {form.enabled && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {languages.map((l) => (
              <Field key={l.code} label={`${t('feedback.question')} ${l.flag}`} htmlFor={`sv-q-${l.code}`}>
                <Input id={`sv-q-${l.code}`} maxLength={300} placeholder={t('feedback.questionPlaceholder', { lng: l.code })} value={form.question[l.code] ?? ''} disabled={!canManage} onChange={(e) => set('question', { ...form.question, [l.code]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Switch checked={form.allowComment} onChange={(v) => set('allowComment', v)} label={t('feedback.allowComment')} />
          <Field label={t('feedback.reviewUrl')} htmlFor="sv-review" hint={t('feedback.reviewUrlHint')}>
            <Input id="sv-review" type="url" placeholder="https://g.page/r/…/review" value={form.googleReviewUrl} disabled={!canManage} onChange={(e) => set('googleReviewUrl', e.target.value.trim())} />
          </Field>
          {form.googleReviewUrl && <Switch checked={form.reviewButton} onChange={(v) => set('reviewButton', v)} label={t('feedback.reviewButton')} description={t('feedback.reviewButtonHint')} />}
        </>
      )}
    </Section>
  );
}

export function FeedbackPage() {
  const { t } = useTranslation();
  const scope = useTenantScope();
  const [days, setDays] = useState('90');
  const { data, isLoading } = useQuery({ queryKey: ['survey', days], queryFn: () => api.get<Results>(`/survey?days=${days}`) });
  const max = Math.max(1, ...(data?.byStar ?? []).map((s) => s.count));

  return (
    <>
      <PageHeader eyebrow={t('nav.marketing')} title={t('feedback.title')} description={t('feedback.description')} actions={<Segmented value={days} onChange={setDays} options={['30', '90', '365'].map((d) => ({ value: d, label: t('marketing.days', { count: Number(d) }) }))} />} />
      <div className="space-y-6">
        {isLoading || !data ? (
          <Spinner />
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="flex flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-sm text-muted">{t('feedback.average')}</p>
              <p className="text-5xl font-semibold tabular-nums">{data.average != null ? data.average.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '–'}</p>
              <Stars value={data.average ?? 0} />
              <p className="text-sm text-muted">{t('feedback.responses', { count: data.count })}</p>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title={t('feedback.distribution')} />
              <ul className="space-y-3 p-6 pt-2">
                {[...data.byStar].reverse().map((s) => (
                  <li key={s.rating} className="flex items-center gap-3 text-sm">
                    <span className="flex w-10 items-center gap-1 font-medium tabular-nums">
                      {s.rating} <Star className="size-3.5 fill-amber-400 text-amber-400" />
                    </span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-sunken">
                      <div className="h-full rounded-full bg-amber-400" style={{ width: `${(s.count / max) * 100}%` }} />
                    </div>
                    <span className="w-12 text-right text-muted tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}
        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader title={t('feedback.comments')} />
            {!data?.comments.length ? (
              <EmptyState icon={<MessageSquareQuote className="size-6" />} title={t('feedback.noComments')} description={t('feedback.noCommentsHint')} />
            ) : (
              <ul className="max-h-[32rem] divide-y divide-line overflow-y-auto">
                {data.comments.map((c) => (
                  <li key={c.id} className="space-y-1 px-6 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <Stars value={c.rating} />
                      <span className="text-xs text-muted">{formatDate(c.createdAt)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-line">{c.comment}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <SurveySettings canManage={scope.canManage} />
        </div>
      </div>
    </>
  );
}

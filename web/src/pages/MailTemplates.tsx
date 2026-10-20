import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Code2, Eye, GripVertical, Mail, Monitor, Plus, RotateCcw, Send, Smartphone, Trash2, Wand2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { createMailBlock, renderMail, type MailBlock, type MailBlockType, type MailContent, type MailKind, type MailTheme } from '@shared/mailDesign';
import { CodeEditor } from '../components/CodeEditor';
import { ColorField, ImageUpload, Segmented, Slider, useConfirm } from '../components/controls';
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Spinner, Textarea, cx } from '../components/ui';
import i18n, { languages, type Locale } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';

type ListItem = { kind: MailKind; vars: string[]; data: boolean; custom: Record<string, boolean>; updatedAt: string | null };
type Detail = {
  template: MailContent;
  source: 'default' | 'platform' | 'tenant';
  custom: boolean;
  fallback: MailContent;
  vars: string[];
  data: boolean;
  sample: { vars: Record<string, string>; raw: Record<string, string>; dataText: string };
};

export function MailTemplatesPage() {
  const { t } = useTranslation();
  const { data: auth } = useAuth();
  const platform = auth?.user?.role === 'superadmin';
  const { data, isLoading } = useQuery({ queryKey: ['mail-templates'], queryFn: () => api.get<{ templates: ListItem[] }>('/mail-templates') });
  return (
    <>
      <PageHeader eyebrow={platform ? t('nav.system') : t('nav.portals')} title={platform ? t('mailTemplates.title') : t('mailTemplates.titleTenant')} description={platform ? t('mailTemplates.description') : t('mailTemplates.descriptionTenant')} />
      {isLoading ? (
        <Spinner />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.templates.map((tpl) => (
            <Link key={tpl.kind} to={`/mail-templates/${tpl.kind}`} className="group">
              <Card className="h-full p-5 transition group-hover:-translate-y-0.5 group-hover:shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-koraal/12 text-accent">
                    <Mail className="size-5" />
                  </span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {languages.map((l) => (
                      <Badge key={l.code} tone={tpl.custom[l.code] ? 'accent' : 'neutral'}>
                        {l.code.toUpperCase()} · {tpl.custom[l.code] ? t('mailTemplates.custom') : t('mailTemplates.standard')}
                      </Badge>
                    ))}
                  </div>
                </div>
                <p className="mt-4 font-semibold group-hover:text-accent">{t(`mailTemplates.kinds.${tpl.kind}`)}</p>
                <p className="mt-1 text-sm text-muted">{t(`mailTemplates.kindHints.${tpl.kind}`)}</p>
                {tpl.updatedAt && <p className="mt-3 text-xs text-muted">{formatDate(tpl.updatedAt)}</p>}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function BlockCard({ block, onChange, onRemove }: { block: MailBlock; onChange: (b: MailBlock) => void; onRemove: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const set = (patch: Partial<MailBlock>) => onChange({ ...block, ...patch } as MailBlock);
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cx('rounded-xl border border-line bg-raised', isDragging && 'z-10 shadow-2xl')}>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button type="button" className="cursor-grab touch-none rounded p-1 text-muted hover:bg-sunken" aria-label="drag" {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
        <span className="flex-1 text-sm font-medium">{t(`mailTemplates.types.${block.type}`)}</span>
        <button type="button" onClick={onRemove} className="rounded p-1 text-muted hover:bg-sunken hover:text-offline" aria-label={t('common.delete')}>
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="space-y-3 p-3">
        {block.type === 'heading' && <Input aria-label={t('mailTemplates.types.heading')} value={block.text} onChange={(e) => set({ text: e.target.value })} />}
        {block.type === 'text' && <Textarea aria-label={t('mailTemplates.types.text')} rows={4} className="font-sans text-sm" value={block.text} onChange={(e) => set({ text: e.target.value })} />}
        {block.type === 'button' && (
          <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={t('editor.label')} placeholder={t('editor.label')} value={block.label} onChange={(e) => set({ label: e.target.value })} />
            <Input aria-label={t('mailTemplates.buttonUrl')} placeholder="{{actionUrl}}" className="font-mono text-xs" value={block.url} onChange={(e) => set({ url: e.target.value })} />
          </div>
        )}
        {block.type === 'image' && (
          <>
            <ImageUpload value={block.src} onChange={(src) => set({ src })} />
            <Slider label={t('mailTemplates.width')} value={block.width} min={40} max={496} onChange={(width) => set({ width })} />
          </>
        )}
        {block.type === 'spacer' && <Slider label={t('editor.height')} value={block.size} min={4} max={80} onChange={(size) => set({ size })} />}
        {block.type === 'data' && <p className="text-xs text-muted">{t('mailTemplates.dataInfo')}</p>}
        {block.type === 'divider' && <hr className="border-line" />}
      </div>
    </div>
  );
}

function ThemePanel({ theme, onChange }: { theme: MailTheme; onChange: (th: MailTheme) => void }) {
  const { t } = useTranslation();
  const set = <K extends keyof MailTheme>(k: K, v: MailTheme[K]) => onChange({ ...theme, [k]: v });
  return (
    <div className="space-y-4">
      <ImageUpload label={t('mailTemplates.logo')} value={theme.logo} onChange={(v) => set('logo', v)} />
      {theme.logo && <Slider label={t('mailTemplates.logoHeight')} value={theme.logoHeight} min={16} max={120} onChange={(v) => set('logoHeight', v)} />}
      <div className="space-y-2.5">
        <ColorField label={t('editor.accent')} value={theme.accent} onChange={(v) => set('accent', v)} />
        <ColorField label={t('editor.buttonText')} value={theme.buttonText} onChange={(v) => set('buttonText', v)} />
        <ColorField label={t('editor.textColor')} value={theme.text} onChange={(v) => set('text', v)} />
        <ColorField label={t('editor.muted')} value={theme.muted} onChange={(v) => set('muted', v)} />
        <ColorField label={t('editor.card')} value={theme.card} onChange={(v) => set('card', v)} />
        <ColorField label={t('editor.background')} value={theme.background} onChange={(v) => set('background', v)} />
      </div>
      <Field label={t('mailTemplates.font')}>
        <Segmented value={theme.font} onChange={(v) => set('font', v)} options={(['sans', 'serif'] as const).map((f) => ({ value: f, label: t(`mailTemplates.fonts.${f}`) }))} />
      </Field>
      <Slider label={t('mailTemplates.radius')} value={theme.radius} min={0} max={32} onChange={(v) => set('radius', v)} />
    </div>
  );
}

const addable: MailBlockType[] = ['heading', 'text', 'button', 'image', 'divider', 'spacer', 'data'];

export function MailTemplateEditorPage() {
  const { kind } = useParams() as { kind: MailKind };
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [confirmDialog, ask] = useConfirm();
  const { data: auth } = useAuth();
  const [locale, setLocale] = useState<Locale>((i18n.resolvedLanguage as Locale) ?? 'en');
  const [content, setContent] = useState<MailContent | null>(null);
  const [saved, setSaved] = useState('');
  const [width, setWidth] = useState<'mobile' | 'desktop'>('desktop');
  const [adding, setAdding] = useState<MailBlockType>('text');
  const query = useQuery({ queryKey: ['mail-template', kind, locale], queryFn: () => api.get<Detail>(`/mail-templates/${kind}?locale=${locale}`) });
  const smtp = useQuery({ queryKey: ['settings', 'smtp'], queryFn: () => api.get<{ enabled: boolean }>('/settings/smtp'), enabled: auth?.user?.role === 'superadmin' });
  useEffect(() => {
    if (!query.data) return;
    setContent(query.data.template);
    setSaved(JSON.stringify(query.data.template));
  }, [query.data]);
  const dirty = content !== null && JSON.stringify(content) !== saved;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const preview = useMemo(() => {
    if (!content || !query.data) return null;
    try {
      return renderMail(content, { ...query.data.sample, baseUrl: window.location.origin, locale });
    } catch {
      return null;
    }
  }, [content, query.data, locale]);

  const save = useMutation({
    mutationFn: () => api.put(`/mail-templates/${kind}`, { locale, ...content }),
    onSuccess: () => {
      setSaved(JSON.stringify(content));
      qc.invalidateQueries({ queryKey: ['mail-templates'] });
      qc.invalidateQueries({ queryKey: ['mail-template', kind, locale] });
      toast.success(t('mailTemplates.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; to?: string; error?: string }>(`/mail-templates/${kind}/test`, { locale, ...content }),
    onSuccess: (d) => (d.ok ? toast.success(t('mailTemplates.testSent', { to: d.to })) : toast.error(d.error)),
    onError: (e: Error) => toast.error(e.message),
  });
  const reset = useMutation({
    mutationFn: () => api.del(`/mail-templates/${kind}?locale=${locale}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mail-templates'] });
      qc.invalidateQueries({ queryKey: ['mail-template', kind, locale] });
      toast.success(t('mailTemplates.resetDone'));
    },
  });

  if (!content || !query.data) return <Spinner />;
  const d = query.data;
  const setBlocks = (blocks: MailBlock[]) => setContent({ ...content, design: { ...content.design, blocks } });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const blocks = content.design.blocks;
    setBlocks(arrayMove(blocks, blocks.findIndex((b) => b.id === active.id), blocks.findIndex((b) => b.id === over.id)));
  };
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success(t('mailTemplates.copied', { value: v })));
  const fillFromVisual = () => setContent({ ...content, html: renderMail({ ...content, mode: 'visual' }, { vars: Object.fromEntries(d.vars.map((v) => [v, `{{${v}}}`])), raw: { data: '{{{data}}}' }, baseUrl: window.location.origin, locale }).html });

  return (
    <>
      <Link to="/mail-templates" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-4" /> {t('mailTemplates.back')}
      </Link>
      <PageHeader
        title={t(`mailTemplates.kinds.${kind}`)}
        description={t(`mailTemplates.kindHints.${kind}`)}
        actions={
          <>
            {d.custom && (
              <Button variant="ghost" icon={<RotateCcw className="size-4" />} onClick={async () => (await ask(t('mailTemplates.confirmReset'))) && reset.mutate()}>
                {t('mailTemplates.reset')}
              </Button>
            )}
            <Button variant="secondary" icon={<Send className="size-4" />} loading={test.isPending} disabled={smtp.data?.enabled === false} title={smtp.data?.enabled === false ? t('mailTemplates.smtpOff') : undefined} onClick={() => test.mutate()}>
              {t('mailTemplates.sendTest')}
            </Button>
            <Button variant="accent" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </>
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented value={locale} onChange={(v) => (dirty ? void ask(t('editor.unsaved'), false).then((ok) => ok && setLocale(v)) : setLocale(v))} options={languages.map((l) => ({ value: l.code, label: `${l.flag} ${l.label}` }))} label={t('mailTemplates.language')} />
        <Segmented
          value={content.mode}
          onChange={(mode) => setContent({ ...content, mode, html: mode === 'html' && !content.html ? d.fallback.html : content.html })}
          options={[
            { value: 'visual', label: <><Wand2 className="size-4" /> {t('mailTemplates.visual')}</> },
            { value: 'html', label: <><Code2 className="size-4" /> {t('mailTemplates.html')}</> },
          ]}
        />
        <Badge tone={d.source === 'default' ? 'neutral' : 'accent'}>{t(`mailTemplates.source.${d.source}`)}</Badge>
        {dirty && <span className="text-xs font-medium text-warning">● {t('editor.unsaved')}</span>}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <div className="space-y-4 p-5">
              <Field label={t('mailTemplates.subject')} htmlFor="m-subject">
                <Input id="m-subject" value={content.subject} onChange={(e) => setContent({ ...content, subject: e.target.value })} />
              </Field>
              <div>
                <p className="text-xs font-semibold tracking-wider text-muted uppercase">{t('mailTemplates.placeholders')}</p>
                <p className="mb-2 text-xs text-muted">{t('mailTemplates.placeholdersHint')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {d.vars.map((v) => (
                    <button key={v} type="button" onClick={() => copy(`{{${v}}}`)} className="rounded-md bg-sunken px-2 py-1 font-mono text-[11px] transition hover:bg-koraal/15 hover:text-accent">
                      {`{{${v}}}`}
                    </button>
                  ))}
                  {d.data && (
                    <button type="button" onClick={() => copy('{{{data}}}')} className="rounded-md bg-sunken px-2 py-1 font-mono text-[11px] transition hover:bg-koraal/15 hover:text-accent">
                      {'{{{data}}}'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {content.mode === 'visual' ? (
            <>
              <Card>
                <CardHeader
                  title={t('mailTemplates.blocks')}
                  action={
                    <div className="flex gap-2">
                      <Select className="h-8 w-auto text-xs" value={adding} onChange={(e) => setAdding(e.target.value as MailBlockType)} aria-label={t('mailTemplates.addBlock')}>
                        {addable.filter((a) => a !== 'data' || d.data).map((a) => (
                          <option key={a} value={a}>
                            {t(`mailTemplates.types.${a}`)}
                          </option>
                        ))}
                      </Select>
                      <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={() => setBlocks([...content.design.blocks, createMailBlock(adding)])}>
                        {t('mailTemplates.addBlock')}
                      </Button>
                    </div>
                  }
                />
                <div className="space-y-3 p-5">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                    <SortableContext items={content.design.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                      {content.design.blocks.map((b) => (
                        <BlockCard key={b.id} block={b} onChange={(nb) => setBlocks(content.design.blocks.map((x) => (x.id === nb.id ? nb : x)))} onRemove={() => setBlocks(content.design.blocks.filter((x) => x.id !== b.id))} />
                      ))}
                    </SortableContext>
                  </DndContext>
                </div>
              </Card>
              <Card>
                <CardHeader title={t('mailTemplates.design')} />
                <div className="p-5">
                  <ThemePanel theme={content.design.theme} onChange={(theme) => setContent({ ...content, design: { ...content.design, theme } })} />
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader
                title="HTML"
                description={t('mailTemplates.htmlHint')}
                action={
                  <Button size="sm" variant="ghost" icon={<Wand2 className="size-4" />} onClick={fillFromVisual}>
                    {t('mailTemplates.fromVisual')}
                  </Button>
                }
              />
              <div className="p-4">
                <CodeEditor value={content.html} onChange={(html) => setContent((c) => (c ? { ...c, html } : c))} label="HTML" />
              </div>
            </Card>
          )}
        </div>

        <div className="xl:sticky xl:top-6 xl:h-fit">
          <Card>
            <CardHeader
              title={t('mailTemplates.preview')}
              description={t('mailTemplates.previewHint')}
              action={
                <Segmented
                  value={width}
                  onChange={setWidth}
                  options={[
                    { value: 'mobile', label: <Smartphone className="size-4" aria-label={t('editor.mobile')} /> },
                    { value: 'desktop', label: <Monitor className="size-4" aria-label={t('editor.desktop')} /> },
                  ]}
                />
              }
            />
            <div className="border-b border-line px-5 py-3 text-sm">
              <span className="text-muted">{t('mailTemplates.subject')}: </span>
              <span className="font-semibold">{preview?.subject}</span>
            </div>
            <div className="flex justify-center bg-sunken p-4">
              {preview ? (
                <iframe title={t('mailTemplates.preview')} sandbox="" srcDoc={preview.html} className={cx('h-[640px] rounded-lg border border-line bg-white transition-all', width === 'mobile' ? 'w-[375px]' : 'w-full')} />
              ) : (
                <Eye className="size-6 text-muted" />
              )}
            </div>
          </Card>
        </div>
      </div>
      {confirmDialog}
    </>
  );
}

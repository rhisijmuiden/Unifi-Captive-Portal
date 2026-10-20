import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Heading,
  Image as ImageIcon,
  LayoutTemplate,
  LogIn,
  Minus,
  Monitor,
  MousePointerClick,
  MoveVertical,
  Paintbrush,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Type,
  Undo2,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useBlocker } from 'react-router';
import { toast } from 'sonner';
import { guestStrings, type GuestLocale } from '@shared/guestStrings';
import {
  createBlock,
  pageClass,
  portalCss,
  renderBlock,
  themeVars,
  type BlockType,
  type LoginMethod,
  type PortalBlock,
  type PortalDesign,
  type PortalTheme,
  type RenderContext,
} from '@shared/portalDesign';
import { portalTemplates } from '@shared/portalTemplates';
import { ColorField, ImageUpload, Segmented, Slider, useConfirm } from '../components/controls';
import { Button, Card, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, cx } from '../components/ui';
import i18n, { languages } from '../i18n';
import { api } from '../lib/api';
import { useTenantScope } from '../lib/tenant';

type DesignResponse = {
  design: PortalDesign;
  custom: boolean;
  languages: string[];
  auth: { methods: LoginMethod[]; emailName: 'off' | 'optional' | 'required'; emailPhone: 'off' | 'optional' | 'required'; marketingOptIn: boolean; paymentEmail: 'off' | 'optional' | 'required' };
  requireTerms: boolean;
  terms: Record<string, string>;
};
type Package = { id: string; name: Record<string, string>; priceCents: number; durationMinutes: number; active: boolean };

const palette: { type: BlockType; icon: LucideIcon }[] = [
  { type: 'logo', icon: Sparkles },
  { type: 'icon', icon: Wifi },
  { type: 'heading', icon: Heading },
  { type: 'text', icon: Type },
  { type: 'image', icon: ImageIcon },
  { type: 'button', icon: MousePointerClick },
  { type: 'divider', icon: Minus },
  { type: 'spacer', icon: MoveVertical },
];
const iconFor = (type: BlockType) => (type === 'login' ? LogIn : (palette.find((p) => p.type === type)?.icon ?? Square));

function PaletteItem({ type, icon: Icon, onAdd }: { type: BlockType; icon: LucideIcon; onAdd: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `palette:${type}`, data: { from: 'palette', type } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={onAdd}
      className={cx('flex w-full touch-none items-center gap-3 rounded-xl border border-line bg-raised px-3 py-2.5 text-left transition hover:border-koraal/60 hover:shadow-card', isDragging && 'opacity-40')}
    >
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-koraal/12 text-accent">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{t(`editor.types.${type}`)}</span>
        <span className="block truncate text-xs text-muted">{t(`editor.typeHints.${type}`)}</span>
      </span>
    </button>
  );
}

function CanvasBlock({ block, html, selected, onSelect }: { block: PortalBlock; html: string; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id, data: { from: 'canvas' } });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      aria-label={t(`editor.types.${block.type}`)}
      className={cx(
        'cp-block relative cursor-grab touch-none rounded-lg outline-offset-4 transition-[outline-color] [&_*]:pointer-events-none',
        selected ? 'outline-2 outline-koraal outline-solid' : 'outline-1 outline-transparent outline-dashed hover:outline-koraal/50',
        isDragging && 'z-10 opacity-60',
      )}
    >
      <div dangerouslySetInnerHTML={{ __html: html || '<div class="cp-placeholder">·</div>' }} />
    </div>
  );
}

function Canvas({ design, ctx, selected, onSelect, device }: { design: PortalDesign; ctx: RenderContext; selected: string | null; onSelect: (id: string | null) => void; device: 'mobile' | 'desktop' }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'canvas' });
  const vars = themeVars(design.theme) as React.CSSProperties;
  const body = (
    <div ref={setNodeRef} className={cx('cp-page', pageClass(design.theme))} style={{ ...vars, ['--cp-min-h' as string]: '100%', minHeight: '100%' }} onClick={() => onSelect(null)}>
      <main className={cx('cp-main', isOver && 'ring-2 ring-koraal/40')}>
        <SortableContext items={design.blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {design.blocks.map((b) => (
            <CanvasBlock key={b.id} block={b} html={renderBlock(b, ctx, true)} selected={selected === b.id} onSelect={() => onSelect(b.id)} />
          ))}
        </SortableContext>
        {ctx.languages.length > 1 && (
          <nav className="cp-langs">
            {ctx.languages.map((l, i) => (
              <span key={l.code}>
                {i > 0 && <span aria-hidden="true">· </span>}
                {l.code === ctx.locale ? <strong>{languages.find((x) => x.code === l.code)?.label ?? l.code}</strong> : (languages.find((x) => x.code === l.code)?.label ?? l.code)}
              </span>
            ))}
          </nav>
        )}
      </main>
      <footer className="cp-foot">Designed by RHIS</footer>
    </div>
  );
  if (device === 'desktop') {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-raised shadow-card">
        <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
            <span key={c} className="size-2.5 rounded-full" style={{ background: c }} />
          ))}
          <span className="ml-3 flex-1 truncate rounded-md bg-sunken px-3 py-1 font-mono text-[11px] text-muted">https://guest.example.com/portal</span>
        </div>
        <div className="h-[640px] overflow-y-auto">{body}</div>
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[390px] rounded-[2.6rem] border-[12px] border-nacht bg-nacht shadow-2xl">
      <div className="relative h-[720px] overflow-y-auto rounded-[1.9rem] bg-white">{body}</div>
    </div>
  );
}

function TextsField({ label, value, onChange, lang, multiline, hint, placeholder }: { label: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void; lang: string; multiline?: boolean; hint?: string; placeholder?: string }) {
  const id = `f-${label}`;
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      {multiline ? (
        <Textarea id={id} rows={5} className="font-sans text-sm" value={value[lang] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
      ) : (
        <Input id={id} value={value[lang] ?? ''} placeholder={placeholder} onChange={(e) => onChange({ ...value, [lang]: e.target.value })} />
      )}
    </Field>
  );
}

function BlockInspector({ block, lang, onChange }: { block: PortalBlock; lang: GuestLocale; onChange: (b: PortalBlock) => void }) {
  const { t } = useTranslation();
  const g = guestStrings[lang];
  const set = (patch: Partial<PortalBlock>) => onChange({ ...block, ...patch } as PortalBlock);
  switch (block.type) {
    case 'logo':
      return (
        <div className="space-y-5">
          <ImageUpload value={block.src} onChange={(src) => set({ src })} />
          <Slider label={t('editor.height')} value={block.height} min={24} max={160} onChange={(height) => set({ height })} />
        </div>
      );
    case 'heading':
      return (
        <div className="space-y-5">
          <TextsField label={t('editor.text')} lang={lang} value={block.text} placeholder={g.defaultTitle} onChange={(text) => set({ text })} />
          <Field label={t('editor.size')}>
            <Segmented value={block.size} onChange={(size) => set({ size })} options={(['md', 'lg', 'xl'] as const).map((v) => ({ value: v, label: t(`editor.sizes.${v}`) }))} />
          </Field>
        </div>
      );
    case 'text':
      return (
        <div className="space-y-5">
          <TextsField label={t('editor.text')} lang={lang} multiline hint={t('editor.textHint')} value={block.text} onChange={(text) => set({ text })} />
          <Field label={t('editor.size')}>
            <Segmented value={block.size} onChange={(size) => set({ size })} options={(['sm', 'md'] as const).map((v) => ({ value: v, label: t(`editor.sizes.${v}`) }))} />
          </Field>
        </div>
      );
    case 'image':
      return (
        <div className="space-y-5">
          <ImageUpload value={block.src} onChange={(src) => set({ src })} />
          <TextsField label={t('editor.altText')} lang={lang} value={block.alt} onChange={(alt) => set({ alt })} />
        </div>
      );
    case 'button':
      return (
        <div className="space-y-5">
          <TextsField label={t('editor.label')} lang={lang} value={block.label} onChange={(label) => set({ label })} />
          <Field label={t('editor.url')} htmlFor="b-url" hint={t('editor.urlHint')}>
            <Input id="b-url" value={block.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
          </Field>
        </div>
      );
    case 'spacer':
      return <Slider label={t('editor.height')} value={block.size} min={4} max={120} onChange={(size) => set({ size })} />;
    case 'login':
      return (
        <div className="space-y-4 text-sm text-muted">
          <p>{t('editor.loginInfo')}</p>
          <Link to="/portal-settings" className="inline-flex font-semibold text-accent hover:underline">
            {t('editor.openAccess')} →
          </Link>
        </div>
      );
    case 'icon':
      return <p className="text-sm text-muted">{t('editor.iconInfo')}</p>;
    default:
      return <p className="text-sm text-muted">{t('editor.noSettings')}</p>;
  }
}

function ThemeInspector({ theme, onChange }: { theme: PortalTheme; onChange: (th: PortalTheme) => void }) {
  const { t } = useTranslation();
  const set = <K extends keyof PortalTheme>(k: K, v: PortalTheme[K]) => onChange({ ...theme, [k]: v });
  const color = (k: 'accent' | 'buttonText' | 'background' | 'background2' | 'card' | 'text' | 'muted', label: string) => <ColorField label={label} value={theme[k]} onChange={(v) => set(k, v)} />;
  return (
    <div className="space-y-6">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">{t('editor.colors')}</p>
        {color('accent', t('editor.accent'))}
        {color('buttonText', t('editor.buttonText'))}
        {color('text', t('editor.textColor'))}
        {color('muted', t('editor.muted'))}
        {color('card', t('editor.card'))}
      </div>
      <div className="space-y-2.5">
        <p className="text-xs font-semibold tracking-wider text-muted uppercase">{t('editor.background')}</p>
        <Segmented value={theme.backgroundStyle} onChange={(v) => set('backgroundStyle', v)} options={(['solid', 'gradient', 'image'] as const).map((v) => ({ value: v, label: t(`editor.backgroundStyles.${v}`) }))} />
        {color('background', t('editor.background'))}
        {theme.backgroundStyle === 'gradient' && color('background2', t('editor.background2'))}
        {theme.backgroundStyle === 'image' && <ImageUpload value={theme.backgroundImage} onChange={(v) => set('backgroundImage', v)} />}
      </div>
      <Field label={t('editor.font')} htmlFor="th-font" hint={t('editor.fontHint')}>
        <Select id="th-font" value={theme.font} onChange={(e) => set('font', e.target.value as PortalTheme['font'])}>
          {(['system', 'rounded', 'humanist', 'serif'] as const).map((f) => (
            <option key={f} value={f}>
              {t(`editor.fonts.${f}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('editor.layout')}>
        <Segmented value={theme.layout} onChange={(v) => set('layout', v)} options={(['card', 'plain'] as const).map((v) => ({ value: v, label: t(`editor.layouts.${v}`) }))} />
      </Field>
      <Field label={t('editor.align')}>
        <Segmented value={theme.align} onChange={(v) => set('align', v)} options={(['left', 'center'] as const).map((v) => ({ value: v, label: t(`editor.aligns.${v}`) }))} />
      </Field>
      <Slider label={t('editor.radius')} value={theme.radius} min={0} max={32} onChange={(v) => set('radius', v)} />
    </div>
  );
}

function TemplatePreview({ design, ctx }: { design: PortalDesign; ctx: RenderContext }) {
  return (
    <div className="pointer-events-none h-[300px] overflow-hidden rounded-xl border border-line">
      <div className="origin-top-left scale-[0.5]" style={{ width: '200%' }}>
        <div className={cx('cp-page', pageClass(design.theme))} style={{ ...(themeVars(design.theme) as React.CSSProperties), minHeight: 600 }}>
          <main className="cp-main">
            {design.blocks.map((b) => (
              <div key={b.id} className="cp-block" dangerouslySetInnerHTML={{ __html: renderBlock(b, ctx, true) }} />
            ))}
          </main>
        </div>
      </div>
    </div>
  );
}

export function PortalEditorPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scope = useTenantScope();
  const [confirmDialog, ask] = useConfirm();
  const query = useQuery({ queryKey: ['portal-design'], queryFn: () => api.get<DesignResponse>('/portal-design') });
  const packages = useQuery({ queryKey: ['payment-packages'], queryFn: () => api.get<{ packages: Package[] }>('/payment-packages') });
  const [design, setDesign] = useState<PortalDesign | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<'block' | 'style'>('block');
  const [device, setDevice] = useState<'mobile' | 'desktop'>('mobile');
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [dragType, setDragType] = useState<BlockType | null>(null);
  const portalLangs = (query.data?.languages ?? ['en', 'nl']) as GuestLocale[];
  const [lang, setLang] = useState<GuestLocale>(() => (i18n.resolvedLanguage as GuestLocale) ?? 'en');

  useEffect(() => {
    if (!query.data) return;
    setDesign(query.data.design);
    setSaved(JSON.stringify(query.data.design));
    if (!query.data.languages.includes(lang)) setLang(query.data.languages[0] as GuestLocale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const dirty = design !== null && JSON.stringify(design) !== saved;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void ask(t('editor.unsaved')).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocker.state]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => api.put<{ design: PortalDesign }>('/portal-design', { design }),
    onSuccess: (d) => {
      setSaved(JSON.stringify(d.design));
      qc.invalidateQueries({ queryKey: ['portal-design'] });
      toast.success(t('editor.saved'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ctx: RenderContext = useMemo(() => {
    const auth = query.data?.auth;
    const pkgs = (packages.data?.packages ?? []).filter((p) => p.active);
    const money = (c: number) => new Intl.NumberFormat(lang === 'nl' ? 'nl-NL' : 'en-GB', { style: 'currency', currency: 'EUR' }).format(c / 100);
    return {
      locale: lang,
      fallbackLocale: portalLangs[0] ?? 'en',
      languages: portalLangs.map((code) => ({ code, href: '#' })),
      login: {
        methods: auth?.methods ?? ['free'],
        requireTerms: query.data?.requireTerms ?? true,
        terms: query.data?.terms[lang] ?? '',
        emailFields: { name: auth?.emailName ?? 'optional', phone: auth?.emailPhone ?? 'off', marketing: auth?.marketingOptIn ?? false },
        paymentEmail: auth?.paymentEmail ?? 'required',
        packages: pkgs.length ? pkgs.map((p) => ({ id: p.id, name: p.name[lang] || p.name.en || Object.values(p.name)[0] || '—', price: money(p.priceCents), minutes: p.durationMinutes })) : [{ id: 'x', name: 'Day pass', price: money(495), minutes: 1440 }],
        action: '#',
      },
    };
  }, [query.data, packages.data, lang, portalLangs]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  if (!scope.tenantId || !design) return <Spinner />;

  const update = (blocks: PortalBlock[]) => setDesign({ ...design, blocks });
  const insert = (type: BlockType, index = design.blocks.findIndex((b) => b.type === 'login')) => {
    const block = createBlock(type);
    const blocks = [...design.blocks];
    blocks.splice(index < 0 ? blocks.length : index, 0, block);
    update(blocks);
    setSelected(block.id);
    setPanel('block');
  };
  const current = design.blocks.find((b) => b.id === selected) ?? null;
  const move = (id: string, delta: number) => {
    const i = design.blocks.findIndex((b) => b.id === id);
    const j = i + delta;
    if (j < 0 || j >= design.blocks.length) return;
    update(arrayMove(design.blocks, i, j));
  };

  const onDragStart = (e: DragStartEvent) => setDragType((e.active.data.current?.type as BlockType) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragType(null);
    const { active, over } = e;
    if (!over) return;
    if (active.data.current?.from === 'palette') {
      const overIndex = design.blocks.findIndex((b) => b.id === over.id);
      insert(active.data.current.type as BlockType, overIndex >= 0 ? overIndex : design.blocks.length);
      return;
    }
    if (active.id !== over.id && over.id !== 'canvas') {
      update(arrayMove(design.blocks, design.blocks.findIndex((b) => b.id === active.id), design.blocks.findIndex((b) => b.id === over.id)));
    }
  };

  const applyTemplate = async (id: string) => {
    const tpl = portalTemplates.find((x) => x.id === id);
    if (!tpl || !(await ask(t('editor.confirmTemplate'), false))) return;
    const logo = design.blocks.find((b) => b.type === 'logo' && b.src);
    const next = structuredClone(tpl.design);
    next.blocks = next.blocks.map((b) => ({ ...b, id: `${b.id}-${Date.now().toString(36)}`, ...(b.type === 'logo' && logo?.type === 'logo' ? { src: logo.src } : {}) }) as PortalBlock);
    setDesign(next);
    setSelected(null);
    setTemplatesOpen(false);
  };

  const toolbar = current && (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="ghost" aria-label={t('editor.moveUp')} title={t('editor.moveUp')} onClick={() => move(current.id, -1)}>
        <ArrowUp className="size-4" />
      </Button>
      <Button size="sm" variant="ghost" aria-label={t('editor.moveDown')} title={t('editor.moveDown')} onClick={() => move(current.id, 1)}>
        <ArrowDown className="size-4" />
      </Button>
      {current.type !== 'login' && (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('editor.duplicate')}
            title={t('editor.duplicate')}
            onClick={() => {
              const i = design.blocks.indexOf(current);
              const copy = { ...structuredClone(current), id: createBlock(current.type).id };
              const blocks = [...design.blocks];
              blocks.splice(i + 1, 0, copy);
              update(blocks);
              setSelected(copy.id);
            }}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('editor.remove')}
            title={t('editor.remove')}
            onClick={() => {
              update(design.blocks.filter((b) => b.id !== current.id));
              setSelected(null);
            }}
          >
            <Trash2 className="size-4 text-offline" />
          </Button>
        </>
      )}
    </div>
  );

  return (
    <>
      <style>{portalCss}</style>
      <PageHeader
        eyebrow={t('nav.portals')}
        title={t('editor.title')}
        description={t('editor.description')}
        actions={
          <>
            <Button variant="secondary" icon={<LayoutTemplate className="size-4" />} onClick={() => setTemplatesOpen(true)}>
              {t('editor.templates')}
            </Button>
            {dirty && (
              <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setDesign(JSON.parse(saved))}>
                {t('editor.discard')}
              </Button>
            )}
            {scope.canManage && (
              <Button variant="accent" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
                {t('common.save')}
              </Button>
            )}
          </>
        }
      />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragType(null)}>
        <div className="grid gap-6 lg:grid-cols-[220px_1fr] xl:grid-cols-[200px_1fr_300px] 2xl:grid-cols-[240px_1fr_340px]">
          <div className="space-y-3 lg:sticky lg:top-6 lg:h-fit">
            <div>
              <p className="text-xs font-semibold tracking-wider text-muted uppercase">{t('editor.blocks')}</p>
              <p className="mt-0.5 text-xs text-muted">{t('editor.blocksHint')}</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
              {palette.map((p) => (
                <PaletteItem key={p.type} type={p.type} icon={p.icon} onAdd={() => insert(p.type)} />
              ))}
            </div>
          </div>

          <div className="min-w-0">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted">{t('editor.textLanguage')}</span>
                <Segmented
                  value={lang}
                  onChange={setLang}
                  options={portalLangs.map((code) => ({ value: code, label: `${languages.find((l) => l.code === code)?.flag ?? ''} ${languages.find((l) => l.code === code)?.label ?? code}` }))}
                />
              </div>
              <div className="flex items-center gap-3">
                {dirty && <span className="text-xs font-medium text-warning">● {t('editor.unsaved')}</span>}
                <Segmented
                  value={device}
                  onChange={setDevice}
                  options={[
                    { value: 'mobile', label: <Smartphone className="size-4" aria-label={t('editor.mobile')} /> },
                    { value: 'desktop', label: <Monitor className="size-4" aria-label={t('editor.desktop')} /> },
                  ]}
                />
              </div>
            </div>
            <Canvas design={design} ctx={ctx} selected={selected} device={device} onSelect={(id) => (setSelected(id), id && setPanel('block'))} />
          </div>

          <div className="lg:col-span-2 xl:sticky xl:top-6 xl:col-span-1 xl:h-fit">
            <Card>
              <div className="flex gap-1 border-b border-line p-2" role="tablist">
                {(['block', 'style'] as const).map((p) => (
                  <button
                    key={p}
                    role="tab"
                    aria-selected={panel === p}
                    onClick={() => setPanel(p)}
                    className={cx('flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition', panel === p ? 'bg-sunken text-ink' : 'text-muted hover:text-ink')}
                  >
                    {p === 'block' ? <Square className="size-4" /> : <Paintbrush className="size-4" />}
                    {t(p === 'block' ? 'editor.block' : 'editor.style')}
                  </button>
                ))}
              </div>
              <div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-5">
                {panel === 'style' ? (
                  <ThemeInspector theme={design.theme} onChange={(theme) => setDesign({ ...design, theme })} />
                ) : current ? (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-2 font-semibold">
                        {(() => {
                          const Icon = iconFor(current.type);
                          return <Icon className="size-4 text-accent" />;
                        })()}
                        {t(`editor.types.${current.type}`)}
                      </p>
                      {toolbar}
                    </div>
                    <BlockInspector block={current} lang={lang} onChange={(b) => update(design.blocks.map((x) => (x.id === b.id ? b : x)))} />
                  </div>
                ) : (
                  <p className="text-sm text-muted">{t('editor.nothingSelected')}</p>
                )}
              </div>
            </Card>
          </div>
        </div>
        <DragOverlay>
          {dragType && (
            <div className="flex items-center gap-3 rounded-xl border border-koraal bg-raised px-3 py-2.5 shadow-2xl">
              {(() => {
                const Icon = iconFor(dragType);
                return <Icon className="size-4 text-accent" />;
              })()}
              <span className="text-sm font-medium">{t(`editor.types.${dragType}`)}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <Modal open={templatesOpen} onClose={() => setTemplatesOpen(false)} title={t('editor.templatesTitle')} description={t('editor.templatesHint')} wide>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {portalTemplates.map((tpl) => (
            <button key={tpl.id} type="button" onClick={() => void applyTemplate(tpl.id)} className="group rounded-2xl border border-line p-2 text-left transition hover:border-koraal hover:shadow-card">
              <TemplatePreview design={tpl.design} ctx={ctx} />
              <p className="mt-2 px-1 text-sm font-semibold group-hover:text-accent">{tpl.name[lang === 'nl' ? 'nl' : 'en']}</p>
            </button>
          ))}
        </div>
      </Modal>
      {confirmDialog}
    </>
  );
}

export type { ReactNode };

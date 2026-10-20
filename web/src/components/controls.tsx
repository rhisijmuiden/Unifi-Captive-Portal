import { Copy, ImagePlus, Trash2 } from 'lucide-react';
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../lib/api';
import { Button, Modal, cx } from './ui';

/** Building blocks for the portal editor and the e-mail designer. */

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="flex gap-1 rounded-xl bg-sunken p-1" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition', value === o.value ? 'bg-raised shadow-card' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} className="size-9 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5" />
      <label htmlFor={id} className="flex-1 text-sm">
        {label}
      </label>
      <input
        aria-label={label}
        value={focused ? text : value}
        onFocus={() => {
          setText(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value.toUpperCase());
        }}
        className="h-8 w-24 rounded-lg border border-line bg-surface px-2 font-mono text-xs uppercase focus:border-koraal focus:outline-none"
      />
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = 'px', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-sm">
        <label htmlFor={id}>{label}</label>
        <span className="font-mono text-xs text-muted">
          {value}
          {unit}
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="range w-full" style={{ '--fill': `${((value - min) / (max - min || 1)) * 100}%` } as CSSProperties} />
    </div>
  );
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/** Uploads an image to the server; the value is its /portal/media/<id> address. */
export function ImageUpload({ value, onChange, label }: { value: string | null; onChange: (url: string | null) => void; label?: string }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast.error(t('editor.uploadHint'));
    setBusy(true);
    try {
      const { url } = await api.post<{ url: string }>('/media', { dataUrl: await readAsDataUrl(file) });
      onChange(url);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div className="space-y-2">
      {label && <p className="text-sm font-medium">{label}</p>}
      {value ? (
        <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2">
          <img src={value} alt="" className="h-14 w-20 rounded-lg bg-[repeating-conic-gradient(#e5e7eb_0_25%,transparent_0_50%)] bg-[length:12px_12px] object-contain" />
          <div className="flex flex-1 flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              {t('editor.replace')}
            </Button>
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onChange(null)}>
              {t('editor.removeImage')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
          className="flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-line px-4 py-5 text-sm text-muted transition hover:border-koraal hover:text-ink"
        >
          <ImagePlus className="size-5" />
          <span className="font-medium">{busy ? '…' : t('editor.upload')}</span>
          <span className="text-xs">{t('editor.uploadHint')}</span>
        </button>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

/** A confirmation dialog: `const [dialog, ask] = useConfirm()`, render {dialog}, then `if (await ask('…'))`. */
export function useConfirm() {
  const { t } = useTranslation();
  const [state, setState] = useState<{ message: string; danger: boolean; resolve: (ok: boolean) => void } | null>(null);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  const dialog = (
    <Modal
      open={Boolean(state)}
      onClose={() => close(false)}
      title={t('common.confirm')}
      footer={
        <>
          <Button variant="secondary" onClick={() => close(false)}>
            {t('common.cancel')}
          </Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {t('common.confirmYes')}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{state?.message}</p>
    </Modal>
  );
  const ask = (message: string, danger = true) => new Promise<boolean>((resolve) => setState({ message, danger, resolve }));
  return [dialog, ask] as const;
}

/** Read-only value with a copy button (webhook and redirect addresses). */
export function Copyable({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <code className="flex-1 truncate font-mono text-xs">{value}</code>
      <button type="button" className="text-muted hover:text-ink" aria-label={t('common.copy')} onClick={() => navigator.clipboard.writeText(value).then(() => toast.success(t('common.copied')))}>
        <Copy className="size-4" />
      </button>
    </div>
  );
}

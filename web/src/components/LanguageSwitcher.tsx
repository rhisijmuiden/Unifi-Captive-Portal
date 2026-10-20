import { useQueryClient } from '@tanstack/react-query';
import { Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { languages, type Locale } from '../i18n';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cx } from './ui';

/** Changes the interface language and, when signed in, stores it on the account so e-mails follow it. */
export function useChangeLanguage() {
  const { i18n } = useTranslation();
  const { data } = useAuth();
  const qc = useQueryClient();
  return async (code: Locale) => {
    await i18n.changeLanguage(code);
    if (data?.user) {
      await api.put('/auth/locale', { locale: code }).catch(() => undefined);
      qc.invalidateQueries({ queryKey: ['auth'] });
    }
  };
}

export function LanguageSwitcher({ tone = 'light', className }: { tone?: 'light' | 'dark'; className?: string }) {
  const { t, i18n } = useTranslation();
  const change = useChangeLanguage();
  return (
    <label
      className={cx(
        'relative inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition',
        tone === 'dark' ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-muted hover:bg-sunken hover:text-ink',
        className,
      )}
      title={t('common.language')}
    >
      <Languages className="size-4" />
      <span>{languages.find((l) => l.code === i18n.resolvedLanguage)?.label ?? i18n.resolvedLanguage}</span>
      <select
        aria-label={t('common.language')}
        value={i18n.resolvedLanguage}
        onChange={(e) => change(e.target.value as Locale)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </select>
    </label>
  );
}

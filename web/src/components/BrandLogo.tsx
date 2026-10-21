import type { Brand } from '../lib/api';
import { cx } from './ui';

/**
 * The RHIS logo, or a reseller's own: its logo for dark backgrounds in the menu (falling back to
 * its regular logo), else its name in text.
 */
export function BrandLogo({ brand, onDark = false, small = false }: { brand: Brand | null; onDark?: boolean; small?: boolean }) {
  const h = small ? 'h-5' : 'h-7';
  if (!brand)
    return onDark ? (
      <img src="/rhis-logo-wit.svg" alt="RHIS" className={`${h} w-auto`} />
    ) : (
      <>
        <img src="/rhis-logo.svg" alt="RHIS" className={`${h} w-auto dark:hidden`} />
        <img src="/rhis-logo-wit.svg" alt="RHIS" className={`${h} hidden w-auto dark:block`} />
      </>
    );
  const light = brand.logoUrl ?? brand.logoDarkUrl;
  const dark = brand.logoDarkUrl ?? brand.logoUrl;
  const text = <span className={cx('block truncate font-bold tracking-tight', small ? 'text-base' : 'text-xl', onDark && 'text-white')}>{brand.name}</span>;
  if (onDark) return dark ? <img src={dark} alt={brand.name} className={`${h} max-w-[200px] object-contain object-left`} /> : text;
  if (!light) return text;
  return (
    <>
      <img src={light} alt={brand.name} className={`${h} max-w-[200px] object-contain object-left dark:hidden`} />
      <img src={dark!} alt={brand.name} className={`${h} hidden max-w-[200px] object-contain object-left dark:block`} />
    </>
  );
}

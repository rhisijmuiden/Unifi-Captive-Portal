import { useEffect } from 'react';
import type { Brand } from './api';
import { useAuth } from './auth';

/** Dark text on light colours, white on dark ones (WCAG relative luminance). */
export function readableOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against #14213d (L≈0.016) versus white
  return (l + 0.05) / 0.066 >= 1.05 / (l + 0.05) ? '#14213d' : '#ffffff';
}

/** The reseller brand of the signed-in user (or of the address before signing in); null = RHIS. */
export function useBrand(): Brand | null {
  return useAuth().data?.brand ?? null;
}

/** Applies the brand to the page: accent colour and tab title. */
export function useApplyBrand() {
  const brand = useBrand();
  useEffect(() => {
    const root = document.documentElement.style;
    if (brand?.accentColor) {
      root.setProperty('--koraal', brand.accentColor);
      root.setProperty('--on-koraal', readableOn(brand.accentColor));
      // Links and highlighted text: the brand colour, toned towards the text colour so it stays readable
      root.setProperty('--accent-text', `color-mix(in oklab, ${brand.accentColor} 70%, var(--ink))`);
    } else for (const p of ['--koraal', '--on-koraal', '--accent-text']) root.removeProperty(p);
    document.title = brand ? brand.name : 'Captive Portal';
  }, [brand?.accentColor, brand?.name]);
  return brand;
}

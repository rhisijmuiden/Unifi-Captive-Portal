import { z } from 'zod';

/** Validation of designs saved from the portal editor. */

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'errors.colorFormat');
const mediaSrc = z
  .string()
  .regex(/^\/portal\/media\/[0-9a-f-]{36}$/)
  .nullable();
const texts = z.record(z.string().regex(/^[a-z]{2}$/), z.string().max(5000));
const id = z.string().min(1).max(40);

export const portalBlockSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('logo'), src: mediaSrc, height: z.number().int().min(24).max(160) }),
  z.object({ id, type: z.literal('icon') }),
  z.object({ id, type: z.literal('heading'), text: texts, size: z.enum(['md', 'lg', 'xl']) }),
  z.object({ id, type: z.literal('text'), text: texts, size: z.enum(['sm', 'md']) }),
  z.object({ id, type: z.literal('image'), src: mediaSrc, alt: texts }),
  z.object({ id, type: z.literal('button'), label: texts, url: z.string().max(2000) }),
  z.object({ id, type: z.literal('divider') }),
  z.object({ id, type: z.literal('spacer'), size: z.number().int().min(4).max(120) }),
  z.object({ id, type: z.literal('login') }),
]);

export const portalDesignSchema = z
  .object({
    version: z.literal(1),
    theme: z.object({
      accent: hex,
      buttonText: hex,
      background: hex,
      background2: hex,
      backgroundStyle: z.enum(['solid', 'gradient', 'image']),
      backgroundImage: mediaSrc,
      card: hex,
      text: hex,
      muted: hex,
      font: z.enum(['system', 'rounded', 'humanist', 'serif']),
      radius: z.number().int().min(0).max(32),
      layout: z.enum(['card', 'plain']),
      align: z.enum(['left', 'center']),
    }),
    blocks: z.array(portalBlockSchema).max(40),
  })
  // Guests can only connect through the sign-in block
  .refine((d) => d.blocks.filter((b) => b.type === 'login').length === 1, 'errors.designLogin');

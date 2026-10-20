import { defaultTheme, type NoId, type PortalBlock, type PortalDesign, type PortalTheme } from './portalDesign.js';

/** Ready-made starting points in the editor. Customers pick one and adjust it to their style. */

export type PortalTemplate = { id: string; name: { en: string; nl: string }; design: PortalDesign };

const b = (blocks: NoId<PortalBlock>[]): PortalBlock[] => blocks.map((block, i) => ({ ...block, id: `t${i}` }) as PortalBlock);

const design = (theme: Partial<PortalTheme>, blocks: NoId<PortalBlock>[]): PortalDesign => ({
  version: 1,
  theme: { ...defaultTheme, ...theme },
  blocks: b(blocks),
});

export const portalTemplates: PortalTemplate[] = [
  {
    id: 'modern',
    name: { en: 'Modern', nl: 'Modern' },
    design: design({}, [
      { type: 'logo', src: null, height: 48 },
      { type: 'icon' },
      { type: 'heading', size: 'lg', text: { en: 'Welcome to our guest network', nl: 'Welkom op ons gastennetwerk' } },
      { type: 'text', size: 'md', text: { en: 'Connect to the internet for free.', nl: 'Maak gratis verbinding met internet.' } },
      { type: 'login' },
    ]),
  },
  {
    id: 'minimal',
    name: { en: 'Minimal', nl: 'Minimaal' },
    design: design(
      { accent: '#111111', background: '#FFFFFF', backgroundStyle: 'solid', card: '#FFFFFF', text: '#111111', muted: '#6B6B6B', radius: 8, layout: 'plain', font: 'humanist' },
      [
        { type: 'logo', src: null, height: 40 },
        { type: 'spacer', size: 24 },
        { type: 'heading', size: 'xl', text: { en: 'Free Wi-Fi', nl: 'Gratis wifi' } },
        { type: 'text', size: 'md', text: { en: 'Get online in one tap.', nl: 'Met één tik online.' } },
        { type: 'login' },
      ],
    ),
  },
  {
    id: 'hotel',
    name: { en: 'Hotel', nl: 'Hotel' },
    design: design(
      { accent: '#C8A45D', buttonText: '#1B1B1F', background: '#14171F', background2: '#3A3247', backgroundStyle: 'gradient', card: '#1E222D', text: '#F4EFE6', muted: '#B9B2A6', font: 'serif', radius: 6, align: 'center' },
      [
        { type: 'logo', src: null, height: 64 },
        { type: 'heading', size: 'lg', text: { en: 'Welcome, dear guest', nl: 'Welkom, beste gast' } },
        { type: 'text', size: 'md', text: { en: 'Enjoy complimentary Wi-Fi throughout the hotel during your stay.', nl: 'Geniet tijdens je verblijf van gratis wifi in het hele hotel.' } },
        { type: 'divider' },
        { type: 'login' },
        { type: 'text', size: 'sm', text: { en: 'Need help? Our reception is available 24/7.', nl: 'Hulp nodig? De receptie is 24/7 bereikbaar.' } },
      ],
    ),
  },
  {
    id: 'cafe',
    name: { en: 'Café', nl: 'Café' },
    design: design(
      { accent: '#9C5B32', background: '#F5EDE3', background2: '#E9C9A6', backgroundStyle: 'gradient', card: '#FFFBF6', text: '#3B2A20', muted: '#7A6352', font: 'rounded', radius: 24, align: 'center' },
      [
        { type: 'logo', src: null, height: 72 },
        { type: 'heading', size: 'lg', text: { en: 'Coffee & Wi-Fi', nl: 'Koffie & wifi' } },
        { type: 'text', size: 'md', text: { en: 'Grab a seat, connect and enjoy.', nl: 'Pak een plekje, maak verbinding en geniet.' } },
        { type: 'login' },
      ],
    ),
  },
  {
    id: 'business',
    name: { en: 'Business', nl: 'Zakelijk' },
    design: design(
      { accent: '#2563EB', background: '#EEF3FB', background2: '#B9CCF2', backgroundStyle: 'gradient', card: '#FFFFFF', text: '#0F1B33', muted: '#56627A', font: 'humanist', radius: 12 },
      [
        { type: 'logo', src: null, height: 44 },
        { type: 'divider' },
        { type: 'heading', size: 'md', text: { en: 'Guest Wi-Fi', nl: 'Gastenwifi' } },
        { type: 'text', size: 'md', text: { en: 'Register with your e-mail address to get access for today.', nl: 'Registreer met je e-mailadres en je hebt vandaag toegang.' } },
        { type: 'login' },
        { type: 'text', size: 'sm', text: { en: 'Your details are only used for access to this network.', nl: 'Je gegevens gebruiken we alleen voor toegang tot dit netwerk.' } },
      ],
    ),
  },
  {
    id: 'event',
    name: { en: 'Event', nl: 'Evenement' },
    design: design(
      { accent: '#E64AFF', buttonText: '#FFFFFF', background: '#120A2A', background2: '#00D1FF', backgroundStyle: 'gradient', card: '#1C1340', text: '#FFFFFF', muted: '#C3B9E8', font: 'system', radius: 18, align: 'center' },
      [
        { type: 'logo', src: null, height: 56 },
        { type: 'icon' },
        { type: 'heading', size: 'xl', text: { en: 'Get connected', nl: 'Maak verbinding' } },
        { type: 'text', size: 'md', text: { en: 'Share your best moments live.', nl: 'Deel je mooiste momenten live.' } },
        { type: 'login' },
      ],
    ),
  },
];

export const defaultDesign = (): PortalDesign => structuredClone(portalTemplates[0].design);

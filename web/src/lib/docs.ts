// Guides live in the repository, in English and Dutch
const REPO = 'https://github.com/rhisijmuiden/Unifi-Captive-Portal/blob/main/docs';

const guides = {
  unifi: { en: 'en/unifi-setup.md', nl: 'nl/unifi-koppelen.md' },
  hostnames: { en: 'en/hostnames-ssl.md', nl: 'nl/hostnamen-ssl.md' },
  smtp: { en: 'en/smtp.md', nl: 'nl/smtp.md' },
} as const;

export const guideUrl = (topic: keyof typeof guides, lang?: string) => `${REPO}/${guides[topic][lang === 'nl' ? 'nl' : 'en']}`;

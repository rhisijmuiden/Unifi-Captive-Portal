/**
 * Texts on the guest portal. Shared by the server (guest pages) and the admin
 * interface (the editor preview), so both always show the same words.
 * To add a language: add an entry here typed as GuestStrings.
 */

const nl = {
  defaultTitle: 'Welkom op ons gastennetwerk',
  defaultWelcome: 'Maak gratis verbinding met internet.',
  acceptTerms: 'Ik ga akkoord met de voorwaarden',
  showTerms: 'Voorwaarden lezen',
  connect: 'Verbinden',
  mustAccept: 'Ga eerst akkoord met de voorwaarden.',
  successTitle: 'Je bent verbonden',
  successBody: 'Veel plezier online. Je wordt zo doorgestuurd.',
  validUntil: 'Toegang geldig tot {{time}}',
  continue: 'Verder',
  failedTitle: 'Verbinden is niet gelukt',
  failedBody: 'Probeer het over een paar seconden opnieuw. Lukt het niet, vraag dan om hulp.',
  retry: 'Opnieuw proberen',
  expiredTitle: 'Deze pagina is verlopen',
  expiredBody: 'Verbreek de wifi-verbinding en maak opnieuw verbinding om verder te gaan.',
  unknownTitle: 'Dit netwerk is nog niet ingericht',
  unknownBody: 'Dit gastennetwerk is nog niet aan een portaal gekoppeld. Neem contact op met de beheerder.',
  suspendedTitle: 'Dit gastennetwerk is tijdelijk niet beschikbaar',
  suspendedBody: 'Neem contact op met de beheerder van dit netwerk.',
  language: 'Taal',
  methodFree: 'Gratis',
  methodEmail: 'E-mail',
  methodVoucher: 'Voucher',
  methodPayment: 'Betalen',
  chooseMethod: 'Kies hoe je verbinding maakt',
  name: 'Naam',
  email: 'E-mailadres',
  phone: 'Telefoonnummer',
  optional: 'optioneel',
  marketing: 'Ik wil af en toe nieuws en aanbiedingen ontvangen',
  register: 'Registreren en verbinden',
  voucherCode: 'Vouchercode',
  voucherPlaceholder: 'ABCD-1234',
  redeem: 'Voucher gebruiken',
  choosePackage: 'Kies een pakket',
  pay: 'Betalen',
  payAmount: '{{amount}} betalen',
  emailForReceipt: 'E-mailadres voor je betaalbewijs',
  nameRequired: 'Vul je naam in.',
  emailInvalid: 'Vul een geldig e-mailadres in.',
  phoneRequired: 'Vul je telefoonnummer in.',
  voucherInvalid: 'Deze vouchercode is niet geldig.',
  voucherUsed: 'Deze voucher is al gebruikt.',
  voucherExpired: 'Deze voucher is verlopen.',
  packageInvalid: 'Kies een pakket.',
  paymentUnavailable: 'Betalen is op dit moment niet mogelijk. Probeer het later opnieuw.',
  paymentPendingTitle: 'We wachten op je betaling',
  paymentPendingBody: 'Dit duurt meestal maar een paar seconden. Deze pagina ververst vanzelf.',
  paymentFailedTitle: 'De betaling is niet gelukt',
  paymentFailedBody: 'Er is niets afgeschreven. Je kunt het opnieuw proberen.',
  paymentPaidTitle: 'Bedankt voor je betaling',
  durationMinutes: '{{n}} minuten',
  durationHours: '{{n}} uur',
  durationDays: '{{n}} dagen',
  durationDay: '1 dag',
  durationWeek: '1 week',
  noMethods: 'Er is nog geen manier ingesteld om verbinding te maken. Neem contact op met de beheerder.',
};

export type GuestStrings = typeof nl;

const en: GuestStrings = {
  defaultTitle: 'Welcome to our guest network',
  defaultWelcome: 'Connect to the internet for free.',
  acceptTerms: 'I accept the terms and conditions',
  showTerms: 'Read the terms',
  connect: 'Connect',
  mustAccept: 'Please accept the terms first.',
  successTitle: 'You are connected',
  successBody: 'Enjoy your time online. You will be redirected shortly.',
  validUntil: 'Access valid until {{time}}',
  continue: 'Continue',
  failedTitle: 'Connecting did not work',
  failedBody: 'Please try again in a few seconds. If it still fails, ask for help.',
  retry: 'Try again',
  expiredTitle: 'This page has expired',
  expiredBody: 'Disconnect from the Wi-Fi and connect again to continue.',
  unknownTitle: 'This network is not set up yet',
  unknownBody: 'This guest network is not linked to a portal yet. Please contact the administrator.',
  suspendedTitle: 'This guest network is temporarily unavailable',
  suspendedBody: 'Please contact the administrator of this network.',
  language: 'Language',
  methodFree: 'Free',
  methodEmail: 'E-mail',
  methodVoucher: 'Voucher',
  methodPayment: 'Pay',
  chooseMethod: 'Choose how to connect',
  name: 'Name',
  email: 'E-mail address',
  phone: 'Phone number',
  optional: 'optional',
  marketing: 'I would like to receive news and offers now and then',
  register: 'Register and connect',
  voucherCode: 'Voucher code',
  voucherPlaceholder: 'ABCD-1234',
  redeem: 'Use voucher',
  choosePackage: 'Choose a package',
  pay: 'Pay',
  payAmount: 'Pay {{amount}}',
  emailForReceipt: 'E-mail address for your receipt',
  nameRequired: 'Please enter your name.',
  emailInvalid: 'Please enter a valid e-mail address.',
  phoneRequired: 'Please enter your phone number.',
  voucherInvalid: 'This voucher code is not valid.',
  voucherUsed: 'This voucher has already been used.',
  voucherExpired: 'This voucher has expired.',
  packageInvalid: 'Please choose a package.',
  paymentUnavailable: 'Paying is not possible right now. Please try again later.',
  paymentPendingTitle: 'Waiting for your payment',
  paymentPendingBody: 'This usually takes only a few seconds. This page refreshes by itself.',
  paymentFailedTitle: 'The payment did not go through',
  paymentFailedBody: 'Nothing has been charged. You can try again.',
  paymentPaidTitle: 'Thank you for your payment',
  durationMinutes: '{{n}} minutes',
  durationHours: '{{n}} hours',
  durationDays: '{{n}} days',
  durationDay: '1 day',
  durationWeek: '1 week',
  noMethods: 'No way to connect has been set up yet. Please contact the administrator.',
};

export const guestStrings = { nl, en } satisfies Record<string, GuestStrings>;
export type GuestLocale = keyof typeof guestStrings;
export const guestLocales = Object.keys(guestStrings) as GuestLocale[];
export const languageNames: Record<string, string> = { nl: 'Nederlands', en: 'English' };

export const fill = (text: string, params?: Record<string, string | number>) =>
  params ? text.replace(/\{\{(\w+)\}\}/g, (_, p: string) => String(params[p] ?? '')) : text;

/** "8 hours", "1 day", "90 minutes" in the guest's language. */
export function durationLabel(s: GuestStrings, minutes: number) {
  if (minutes === 10080) return s.durationWeek;
  if (minutes === 1440) return s.durationDay;
  if (minutes % 1440 === 0) return fill(s.durationDays, { n: minutes / 1440 });
  if (minutes % 60 === 0) return fill(s.durationHours, { n: minutes / 60 });
  return fill(s.durationMinutes, { n: minutes });
}

export function moneyLabel(locale: string, cents: number, currency: string) {
  return new Intl.NumberFormat(locale === 'nl' ? 'nl-NL' : 'en-GB', { style: 'currency', currency }).format(cents / 100);
}

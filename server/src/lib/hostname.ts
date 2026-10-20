const HOSTNAME_RE = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

export const normalizeHostname = (h: string) => h.trim().toLowerCase().replace(/\.$/, '');
export const isValidHostname = (h: string) => HOSTNAME_RE.test(h);

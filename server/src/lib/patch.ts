/**
 * Only the fields the caller sent. Zod 4 fills in defaults even in `.partial()` schemas,
 * so without this a partial update would reset every field it did not mention.
 */
export function sentOnly<T extends object>(parsed: T, body: unknown): Partial<T> {
  const sent = new Set(body && typeof body === 'object' ? Object.keys(body) : []);
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k))) as Partial<T>;
}

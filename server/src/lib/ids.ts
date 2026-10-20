import { notFound } from './errors.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** A route id that must be a UUID; anything else is simply not found (instead of a database error). */
export function uuidParam(v: unknown): string {
  if (!isUuid(v)) throw notFound();
  return v;
}

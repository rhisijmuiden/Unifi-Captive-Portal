import { t, type Locale, type MessageKey, type Params } from '../i18n/index.js';

/** An error whose message is a translation key, rendered in the caller's language by the error handler. */
export class AppError extends Error {
  constructor(
    public key: MessageKey,
    public params?: Params,
    public statusCode = 400,
  ) {
    super(key);
  }
}

export const badRequest = (key: MessageKey, params?: Params) => new AppError(key, params, 400);
export const unauthorized = (key: MessageKey = 'errors.unauthorized') => new AppError(key, undefined, 401);
export const forbidden = () => new AppError('errors.forbidden', undefined, 403);
export const notFound = () => new AppError('errors.notFound', undefined, 404);

export function translateError(err: unknown, locale: Locale): string {
  if (err instanceof AppError) return t(locale, err.key, err.params);
  return err instanceof Error ? err.message : String(err);
}

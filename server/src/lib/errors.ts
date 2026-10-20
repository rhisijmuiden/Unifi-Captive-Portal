export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const unauthorized = (msg = 'Niet ingelogd') => new HttpError(401, msg);
export const forbidden = (msg = 'Geen toegang') => new HttpError(403, msg);
export const notFound = (msg = 'Niet gevonden') => new HttpError(404, msg);

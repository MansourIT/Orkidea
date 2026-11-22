import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError } from 'zod';
import type { ApiError, ApiErrorCode } from '../../../shared/types';

/** Erreur métier : levée par les services, convertie en réponse JSON par onError. */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
    readonly details?: string[],
    readonly code?: ApiErrorCode,
  ) {
    super(message);
  }
}

export const fail = (status: ContentfulStatusCode, message: string, opts: { details?: string[]; code?: ApiErrorCode } = {}) =>
  new AppError(status, message, opts.details, opts.code);

export function errorBody(err: AppError): ApiError {
  return { error: err.message, ...(err.details ? { details: err.details } : {}), ...(err.code ? { code: err.code } : {}) };
}

export function zodDetails(error: ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : 'corps'} : ${i.message}`);
}

/** Validation des requêtes (corps, query, params) : 400 avec la liste des problèmes. */
export function validationHook(result: { success: true } | { success: false; error: ZodError }, c: Context) {
  if (!result.success) return c.json<ApiError>({ error: 'Requête invalide', details: zodDetails(result.error) }, 400);
}

export function onError(err: Error, c: Context) {
  if (err instanceof AppError) return c.json(errorBody(err), err.status);
  if (err instanceof HTTPException) {
    return c.json<ApiError>({ error: err.status === 400 ? 'Corps de requête invalide' : err.message }, err.status);
  }
  console.error(err);
  return c.json<ApiError>({ error: 'Erreur serveur' }, 500);
}

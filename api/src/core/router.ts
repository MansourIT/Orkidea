import { OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '../env';
import { validationHook } from './errors';

// Messages de validation Zod en français.
z.config(z.locales.fr());

/** Routeur d'un module : validation Zod + documentation OpenAPI. */
export const newRouter = () => new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

export { z };

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mois invalide (attendu YYYY-MM)');
export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (attendu YYYY-MM-DD)');
export const EmailSchema = z.string().trim().max(254).regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, 'Email invalide');
export const IdSchema = z.string().min(1).max(64);

/** Réponse JSON générique pour la documentation. */
export const ok = (description: string) => ({ description });
export const jsonBody = <T extends z.ZodType>(schema: T) => ({ required: true, content: { 'application/json': { schema } } });

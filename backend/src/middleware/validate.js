import { ValidationError } from '../utils/errors.js';

/**
 * Express middleware factory for Zod schema validation.
 *
 * @param {import('zod').ZodSchema} schema
 * @param {'body' | 'query' | 'params'} source
 */
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return next(
        new ValidationError('Request validation failed', result.error.errors),
      );
    }

    req[source] = result.data;
    return next();
  };
}

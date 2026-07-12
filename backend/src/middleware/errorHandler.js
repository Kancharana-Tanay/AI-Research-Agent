import { ZodError } from 'zod';
import logger from '../utils/logger.js';
import { AppError } from '../utils/errors.js';
import { isProduction } from '../config/env.js';

/**
 * Centralized error handler — single place for all HTTP error responses.
 */
export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        message: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        message: err.message,
        code: err.name,
        ...(err.details && { details: err.details }),
      },
    });
  }

  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack,
  });

  return res.status(500).json({
    success: false,
    error: {
      message: isProduction ? 'Internal server error' : err.message,
      code: 'INTERNAL_ERROR',
      ...(!isProduction && { stack: err.stack }),
    },
  });
}

/**
 * 404 handler for undefined routes.
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: {
      message: `Route ${req.method} ${req.originalUrl} not found`,
      code: 'NOT_FOUND',
    },
  });
}

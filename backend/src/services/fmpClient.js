import { env } from '../config/env.js';
import { withRetry, isRetryableHttpStatus } from '../utils/retry.js';
import { ExternalServiceError } from '../utils/errors.js';
import logger from '../utils/logger.js';
import { getRedisClient, CACHE_TTL_SECONDS } from '../config/redis.js';


// ---------------------------------------------------------------------------
// FMP HTTP Client
//
// A thin Axios-free HTTP client using the native fetch API (Node 18+).
// We deliberately avoid adding Axios as another dependency for simple REST
// calls — fetch is sufficient and removes one package from the tree.
//
// Responsibilities:
//   - Injects the FMP API key as a query parameter on every request.
//   - Enforces a configurable request timeout via AbortController.
//   - Wraps all errors in ExternalServiceError for consistent handling.
//   - Applies exponential backoff retry for transient failures.
//   - Logs every request and its outcome for observability.
//
// Usage:
//   const data = await fmpGet('/profile/AAPL');
//   const data = await fmpGet('/v3/stock_news', { tickers: 'AAPL', limit: 20 });
// ---------------------------------------------------------------------------

const FMP_BASE_URL = 'https://financialmodelingprep.com';
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Makes an authenticated GET request to the FMP REST API.
 *
 * @param {string} path         - API path, e.g. '/v3/profile/AAPL'
 * @param {Record<string,any>}  params - Additional query parameters (key excluded — injected automatically)
 * @returns {Promise<any>}      - Parsed JSON response body
 * @throws {ExternalServiceError} on non-2xx responses or network failures
 */


/**
 * Makes an authenticated GET request to the FMP REST API.
 * Includes Redis caching for read-through / write-through optimization.
 *
 * @param {string} path         - API path, e.g. '/v3/profile/AAPL'
 * @param {Record<string,any>}  params - Additional query parameters
 * @returns {Promise<any>}      - Parsed JSON response body
 * @throws {ExternalServiceError} on non-2xx responses or network failures
 */
export async function fmpGet(path, params = {}) {
  const apiKey = env.FMP_API_KEY;

  if (!apiKey) {
    throw new ExternalServiceError(
      'FMP_API_KEY is not configured. Set it in your .env file.',
    );
  }

  // Build URL with all query parameters
  const url = new URL(`${FMP_BASE_URL}${path}`);
  url.searchParams.set('apikey', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const maskedUrl = url.toString().replace(apiKey, '[REDACTED]');
  
  // 1. Redis Cache Read-Through lookup
  const cacheKey = `fmp:cache:${path}:${JSON.stringify(params)}`;
  let redis = null;
  try {
    redis = getRedisClient();
    if (redis && redis.status === 'ready') {
      const cached = await redis.get(cacheKey);
      if (cached) {
        logger.debug('FMP cache hit', { key: cacheKey });
        return JSON.parse(cached);
      }
    }
  } catch (redisError) {
    logger.warn('Failed to retrieve from Redis cache', { error: redisError.message });
  }

  logger.debug('FMP request', { url: maskedUrl });

  return withRetry(
    async (attempt) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new ExternalServiceError(
            `FMP API error: HTTP ${response.status} for ${maskedUrl}`,
            { status: response.status, body },
          );
        }

        const data = await response.json();

        // FMP returns { "Error Message": "..." } for invalid tickers/endpoints
        // even with a 200 status — we treat this as an error.
        if (data && typeof data === 'object' && !Array.isArray(data) && data['Error Message']) {
          throw new ExternalServiceError(
            `FMP API error: ${data['Error Message']}`,
            { path, params },
          );
        }

        logger.debug('FMP response received', {
          url: maskedUrl,
          attempt,
          itemCount: Array.isArray(data) ? data.length : 1,
        });

        // 2. Redis Cache Write-Through on success
        if (data && (!Array.isArray(data) || data.length > 0)) {
          try {
            if (redis && redis.status === 'ready') {
              await redis.set(cacheKey, JSON.stringify(data), 'EX', CACHE_TTL_SECONDS || 3600);
              logger.debug('FMP cache set', { key: cacheKey });
            }
          } catch (redisWriteError) {
            logger.warn('Failed to write to Redis cache', { error: redisWriteError.message });
          }
        }

        return data;
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new ExternalServiceError(
            `FMP request timed out after ${REQUEST_TIMEOUT_MS}ms: ${maskedUrl}`,
          );
        }
        throw error;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    {
      maxAttempts: 3,
      baseDelayMs: 800,
      maxDelayMs: 5_000,
      shouldRetry: (error) => {
        // Retry on network errors or retryable HTTP status codes
        if (error instanceof ExternalServiceError && error.details?.status) {
          return isRetryableHttpStatus(error.details.status);
        }
        // Retry on genuine network failures (not abort/timeout)
        return !(error instanceof ExternalServiceError);
      },
    },
  );
}

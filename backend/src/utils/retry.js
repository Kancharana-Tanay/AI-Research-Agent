import logger from './logger.js';

const DEFAULT_OPTIONS = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
  shouldRetry: () => true,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with exponential backoff.
 * Used for external API calls (FMP, LLM, MCP) in later modules.
 */
export async function withRetry(fn, options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };
  let lastError;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt === config.maxAttempts;
      const canRetry = config.shouldRetry(error, attempt);

      if (isLastAttempt || !canRetry) {
        throw error;
      }

      const delay = Math.min(
        config.baseDelayMs * 2 ** (attempt - 1),
        config.maxDelayMs,
      );

      logger.warn('Retrying operation', {
        attempt,
        maxAttempts: config.maxAttempts,
        delayMs: delay,
        error: error.message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Determines if an HTTP status code is retryable.
 */
export function isRetryableHttpStatus(status) {
  return status === 429 || status >= 500;
}

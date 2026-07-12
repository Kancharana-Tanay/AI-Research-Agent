import Redis from 'ioredis';
import { env } from './env.js';
import logger from '../utils/logger.js';

let redisClient = null;
let _mockRedisClient = null;

/**
 * Sets a mock Redis client for testing.
 *
 * @param {any} mock - The mock Redis client to use
 */
export function setMockRedisClient(mock) {
  _mockRedisClient = mock;
}

/**
 * Creates a singleton Redis client configured for LFU eviction
 * (policy is set at the Redis server level via docker-compose).
 */
export function getRedisClient() {
  if (_mockRedisClient) {
    return _mockRedisClient;
  }
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) {
        // Return null to stop retrying and close client connection
        return null;
      }
      const delay = Math.min(times * 200, 1_000);
      return delay;
    },
  });

  // Log successful connection
  redisClient.on('connect', () => {
    logger.info('Redis connected');
  });

  // Suppress all intermediate retry noise — ioredis retries internally.
  // A no-op error handler is required to prevent Node.js 'unhandledRejection' crashes.
  redisClient.on('error', () => {});

  // Log once when Redis gives up entirely (after max retries)
  redisClient.on('end', () => {
    logger.warn('Redis unavailable — caching bypassed for this session');
  });

  return redisClient;
}

export async function connectRedis() {
  const client = getRedisClient();

  if (client.status === 'ready') {
    return client;
  }

  await client.connect();
  return client;
}

export async function disconnectRedis() {
  if (!redisClient) return;

  await redisClient.quit();
  redisClient = null;
}

export function getRedisStatus() {
  if (!redisClient) {
    return { connected: false, status: 'not_initialized' };
  }

  return {
    connected: redisClient.status === 'ready',
    status: redisClient.status,
  };
}

export const CACHE_TTL_SECONDS = env.REDIS_TTL_SECONDS;

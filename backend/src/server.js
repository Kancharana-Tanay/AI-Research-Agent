import 'dotenv/config';

import app from './app.js';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { connectRedis, disconnectRedis } from './config/redis.js';
import logger from './utils/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`Server listening on port ${env.PORT}`, {
    environment: env.NODE_ENV,
  });
});

async function bootstrap() {
  try {
    await connectDatabase();
    logger.info('MongoDB database connection established');
  } catch (error) {
    logger.error('Failed to connect to Database', { error: error.message });
    process.exit(1);
  }

  try {
    await connectRedis();
    logger.info('Redis cache connection established');
  } catch (error) {
    logger.warn('Failed to connect to Redis — caching will be disabled', { error: error.message });
    // Proceed without exiting: fmpClient handles disconnected state gracefully
  }
}

bootstrap();

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down gracefully`);

  server.close(async () => {
    try {
      await disconnectRedis();
      await disconnectDatabase();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

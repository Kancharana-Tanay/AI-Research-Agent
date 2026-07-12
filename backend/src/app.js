import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apiRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { getDatabaseStatus } from './config/database.js';
import { getRedisStatus } from './config/redis.js';
import { asyncHandler } from './utils/asyncHandler.js';
import researchRoutes from './routes/taskRoutes.js';


const app = express();

// Security & parsing
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_URL,
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting on all API routes
app.use('/api', apiRateLimiter);

// Health check — used by Docker/orchestrators
app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    res.json({
      success: true,
      data: {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          mongodb: getDatabaseStatus(),
          redis: getRedisStatus(),
        },
      },
    });
  }),
);

// Route modules mounted here
app.use('/api/research', researchRoutes);


app.use(notFoundHandler);
app.use(errorHandler);

export default app;

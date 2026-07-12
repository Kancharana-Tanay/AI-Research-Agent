import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  CLIENT_URL: z.string().url().default('http://localhost:5173'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  FMP_API_KEY: z.string().optional().default('8PgywB0bmoUfwKB8a9oeWqCwkF5qDpxC'),
  FMP_MCP_SERVER_URL: z.string().url().optional().or(z.literal('')),
  FMP_MCP_API_KEY: z.string().optional(),

  LLM_PROVIDER: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().optional(),

  TAVILY_API_KEY: z.string().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
});

/**
 * Validates and parses environment variables at startup.
 * Fails fast with clear errors instead of failing at runtime.
 */
function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';

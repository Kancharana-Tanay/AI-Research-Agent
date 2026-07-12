import mongoose from 'mongoose';
import { env } from './env.js';
import logger from '../utils/logger.js';

let isConnected = false;

/**
 * Connects to MongoDB with sensible defaults for production workloads.
 */
export async function connectDatabase() {
  if (isConnected) {
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connected');
    isConnected = true;
  });

  mongoose.connection.on('error', (error) => {
    logger.error('MongoDB connection error', { error: error.message });
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
    isConnected = false;
  });

  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5_000,
    socketTimeoutMS: 45_000,
  });

  return mongoose.connection;
}

export async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
}

export function getDatabaseStatus() {
  return {
    connected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
  };
}

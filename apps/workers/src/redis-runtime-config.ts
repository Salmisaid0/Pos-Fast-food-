import Redis from "ioredis";
import type { RedisOptions } from "ioredis";

import { IoredisPrintJobClient } from "./ioredis-print-job-client";
import {
  RedisPrintJobRepository,
  type RedisPrintJobRepositoryOptions,
} from "./redis-print-job-repository";

export interface RedisRuntimeConfig {
  url?: string;
  host?: string;
  port?: number;
  db?: number;
  username?: string;
  password?: string;
  keyPrefix?: string;
}

export interface RedisPrintQueueRuntimeConfig {
  redis: RedisRuntimeConfig;
  repository: RedisPrintJobRepositoryOptions;
}

export function readRedisPrintQueueRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): RedisPrintQueueRuntimeConfig {
  const redis: RedisRuntimeConfig = {};
  if (env.REDIS_URL) redis.url = env.REDIS_URL;
  if (env.REDIS_HOST) redis.host = env.REDIS_HOST;
  const port = readOptionalInteger(env.REDIS_PORT, "REDIS_PORT");
  if (port !== undefined) redis.port = port;
  const db = readOptionalInteger(env.REDIS_DB, "REDIS_DB");
  if (db !== undefined) redis.db = db;
  if (env.REDIS_USERNAME) redis.username = env.REDIS_USERNAME;
  if (env.REDIS_PASSWORD) redis.password = env.REDIS_PASSWORD;
  if (env.REDIS_KEY_PREFIX) redis.keyPrefix = env.REDIS_KEY_PREFIX;

  const repository: RedisPrintJobRepositoryOptions = {};
  if (env.PRINT_JOBS_HASH_KEY) repository.jobsHashKey = env.PRINT_JOBS_HASH_KEY;
  if (env.PRINT_JOBS_RUNNABLE_SET_KEY)
    repository.runnableSortedSetKey = env.PRINT_JOBS_RUNNABLE_SET_KEY;

  return { redis, repository };
}

export function createRedisPrintJobRepositoryFromConfig(
  config: RedisPrintQueueRuntimeConfig = readRedisPrintQueueRuntimeConfig()
): RedisPrintJobRepository {
  const redis = createRedisClient(config.redis);
  return new RedisPrintJobRepository(new IoredisPrintJobClient(redis), config.repository);
}

export function createRedisClient(config: RedisRuntimeConfig = {}): Redis {
  if (config.url) {
    return new Redis(config.url, toRedisOptions(config));
  }

  return new Redis(toRedisOptions(config));
}

function toRedisOptions(config: RedisRuntimeConfig): RedisOptions {
  const options: RedisOptions = {};

  if (config.host) options.host = config.host;
  if (config.port !== undefined) options.port = config.port;
  if (config.db !== undefined) options.db = config.db;
  if (config.username) options.username = config.username;
  if (config.password) options.password = config.password;
  if (config.keyPrefix) options.keyPrefix = config.keyPrefix;

  return options;
}

function readOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

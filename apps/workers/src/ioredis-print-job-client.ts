import type { Redis } from "ioredis";

import type { RedisPrintJobClient } from "./redis-print-job-repository";

export class IoredisPrintJobClient implements RedisPrintJobClient {
  constructor(private readonly redis: Redis) {}

  async hget(key: string, field: string): Promise<string | undefined> {
    return (await this.redis.hget(key, field)) ?? undefined;
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    await this.redis.hset(key, field, value);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.redis.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.zrange(key, start, stop);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.redis.zrem(key, member);
  }
}

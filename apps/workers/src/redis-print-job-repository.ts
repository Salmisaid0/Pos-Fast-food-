import type { IsoDateTimeString, PrinterJob, PrinterJobId } from "@packages/shared-types";

import type { PrintJobQueueRepository } from "./print-job";

export interface RedisPrintJobClient {
  hget(key: string, field: string): Promise<string | undefined>;
  hset(key: string, field: string, value: string): Promise<void>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, member: string): Promise<void>;
}

export interface RedisPrintJobRepositoryOptions {
  jobsHashKey?: string;
  runnableSortedSetKey?: string;
}

export class RedisPrintJobRepository implements PrintJobQueueRepository {
  private readonly jobsHashKey: string;
  private readonly runnableSortedSetKey: string;

  constructor(
    private readonly redis: RedisPrintJobClient,
    options: RedisPrintJobRepositoryOptions = {}
  ) {
    this.jobsHashKey = options.jobsHashKey ?? "pos:print-jobs";
    this.runnableSortedSetKey = options.runnableSortedSetKey ?? "pos:print-jobs:runnable";
  }

  async save(job: PrinterJob): Promise<void> {
    await this.persistJob(job);
    if (isRunnablePrintJob(job)) {
      await this.redis.zadd(this.runnableSortedSetKey, Date.parse(job.createdAt), job.id);
    } else {
      await this.redis.zrem(this.runnableSortedSetKey, job.id);
    }
  }

  async getById(jobId: PrinterJobId): Promise<PrinterJob | undefined> {
    const serializedJob = await this.redis.hget(this.jobsHashKey, jobId);
    return serializedJob ? (JSON.parse(serializedJob) as PrinterJob) : undefined;
  }

  async listRunnable(limit: number): Promise<PrinterJob[]> {
    const jobIds = await this.redis.zrange(this.runnableSortedSetKey, 0, Math.max(limit - 1, 0));
    const jobs: PrinterJob[] = [];

    for (const jobId of jobIds) {
      const job = await this.getById(jobId as PrinterJobId);
      if (job && isRunnablePrintJob(job)) jobs.push(job);
    }

    return jobs;
  }

  async claimNext(now: IsoDateTimeString): Promise<PrinterJob | undefined> {
    const runnableJobs = await this.listRunnable(1);
    const [nextJob] = runnableJobs;
    if (!nextJob) return undefined;

    const claimedJob: PrinterJob = {
      ...nextJob,
      status: "PROCESSING",
      updatedAt: now,
    };
    await this.persistJob(claimedJob);
    await this.redis.zrem(this.runnableSortedSetKey, claimedJob.id);
    return claimedJob;
  }

  private async persistJob(job: PrinterJob): Promise<void> {
    await this.redis.hset(this.jobsHashKey, job.id, JSON.stringify(job));
  }
}

export class InMemoryRedisPrintJobClient implements RedisPrintJobClient {
  private readonly hashes = new Map<string, Map<string, string>>();
  private readonly sortedSets = new Map<string, Map<string, number>>();

  async hget(key: string, field: string): Promise<string | undefined> {
    return this.hashes.get(key)?.get(field);
  }

  async hset(key: string, field: string, value: string): Promise<void> {
    const hash = this.getHash(key);
    hash.set(field, value);
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    const sortedSet = this.getSortedSet(key);
    sortedSet.set(member, score);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const sortedSet = this.sortedSets.get(key);
    if (!sortedSet) return [];

    return [...sortedSet.entries()]
      .sort(([leftMember, leftScore], [rightMember, rightScore]) =>
        leftScore === rightScore ? leftMember.localeCompare(rightMember) : leftScore - rightScore
      )
      .slice(start, stop + 1)
      .map(([member]) => member);
  }

  async zrem(key: string, member: string): Promise<void> {
    this.sortedSets.get(key)?.delete(member);
  }

  private getHash(key: string): Map<string, string> {
    const existingHash = this.hashes.get(key);
    if (existingHash) return existingHash;

    const hash = new Map<string, string>();
    this.hashes.set(key, hash);
    return hash;
  }

  private getSortedSet(key: string): Map<string, number> {
    const existingSortedSet = this.sortedSets.get(key);
    if (existingSortedSet) return existingSortedSet;

    const sortedSet = new Map<string, number>();
    this.sortedSets.set(key, sortedSet);
    return sortedSet;
  }
}

function isRunnablePrintJob(job: PrinterJob): boolean {
  return job.status === "QUEUED" || job.status === "FAILED";
}

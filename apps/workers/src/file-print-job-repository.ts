import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { IsoDateTimeString, PrinterJob, PrinterJobId } from "@packages/shared-types";

import type { PrintJobQueueRepository } from "./print-job";

interface PersistedPrintJobStore {
  jobs: PrinterJob[];
}

export class FilePrintJobRepository implements PrintJobQueueRepository {
  constructor(private readonly filePath: string) {}

  async save(job: PrinterJob): Promise<void> {
    const store = await this.readStore();
    const existingIndex = store.jobs.findIndex((storedJob) => storedJob.id === job.id);

    if (existingIndex >= 0) {
      store.jobs[existingIndex] = job;
    } else {
      store.jobs.push(job);
    }

    await this.writeStore(store);
  }

  async getById(jobId: PrinterJobId): Promise<PrinterJob | undefined> {
    const store = await this.readStore();
    return store.jobs.find((job) => job.id === jobId);
  }

  async listRunnable(limit: number): Promise<PrinterJob[]> {
    const store = await this.readStore();
    return store.jobs
      .filter((job) => job.status === "QUEUED" || job.status === "FAILED")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async claimNext(now: IsoDateTimeString): Promise<PrinterJob | undefined> {
    const store = await this.readStore();
    const nextJob = store.jobs
      .filter((job) => job.status === "QUEUED" || job.status === "FAILED")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];

    if (!nextJob) return undefined;

    const claimedJob: PrinterJob = {
      ...nextJob,
      status: "PROCESSING",
      updatedAt: now,
    };
    const existingIndex = store.jobs.findIndex((job) => job.id === claimedJob.id);
    store.jobs[existingIndex] = claimedJob;
    await this.writeStore(store);
    return claimedJob;
  }

  private async readStore(): Promise<PersistedPrintJobStore> {
    try {
      const contents = await readFile(this.filePath, "utf8");
      return JSON.parse(contents) as PersistedPrintJobStore;
    } catch (error) {
      if (isNodeFileNotFoundError(error)) return { jobs: [] };
      throw error;
    }
  }

  private async writeStore(store: PersistedPrintJobStore): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.filePath);
  }
}

function isNodeFileNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

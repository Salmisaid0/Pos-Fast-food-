import type { IsoDateTimeString, PrinterJob, PrinterJobId } from "@packages/shared-types";

export interface PrintJobRepository {
  save(job: PrinterJob): Promise<void>;
  getById(jobId: PrinterJobId): Promise<PrinterJob | undefined>;
}

export interface PrintJobQueueRepository extends PrintJobRepository {
  listRunnable(limit: number): Promise<PrinterJob[]>;
  claimNext(now: IsoDateTimeString): Promise<PrinterJob | undefined>;
}

export interface PrinterTransport {
  send(job: PrinterJob): Promise<void>;
}

export interface ProcessPrintJobOptions {
  now?: IsoDateTimeString;
  maxAttempts?: number;
}

export type ProcessPrintJobResult =
  | { ok: true; jobId: PrinterJobId; status: "SENT" }
  | { ok: false; jobId: PrinterJobId; status: "FAILED" | "DEAD_LETTERED"; error: string };

export type ProcessNextPrintJobResult = ProcessPrintJobResult | { ok: true; status: "IDLE" };

export interface DrainPrintQueueResult {
  attemptedCount: number;
  sentCount: number;
  failedCount: number;
  deadLetteredCount: number;
}

export class InMemoryPrintJobRepository implements PrintJobQueueRepository {
  private readonly jobs = new Map<string, PrinterJob>();

  constructor(initialJobs: PrinterJob[] = []) {
    for (const job of initialJobs) {
      this.jobs.set(job.id, job);
    }
  }

  async save(job: PrinterJob): Promise<void> {
    this.jobs.set(job.id, job);
  }

  async getById(jobId: PrinterJobId): Promise<PrinterJob | undefined> {
    return this.jobs.get(jobId);
  }

  async listRunnable(limit: number): Promise<PrinterJob[]> {
    return [...this.jobs.values()]
      .filter((job) => isRunnablePrintJob(job))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async claimNext(now: IsoDateTimeString): Promise<PrinterJob | undefined> {
    const [nextJob] = await this.listRunnable(1);
    if (!nextJob) return undefined;

    const claimedJob: PrinterJob = {
      ...nextJob,
      status: "PROCESSING",
      updatedAt: now,
    };
    await this.save(claimedJob);
    return claimedJob;
  }
}

export class RecordingPrinterTransport implements PrinterTransport {
  readonly sentJobs: PrinterJob[] = [];

  async send(job: PrinterJob): Promise<void> {
    this.sentJobs.push(job);
  }
}

export async function processPrintJob(
  job: PrinterJob,
  repository: PrintJobRepository = new InMemoryPrintJobRepository(),
  transport: PrinterTransport = new RecordingPrinterTransport(),
  options: ProcessPrintJobOptions = {}
): Promise<ProcessPrintJobResult> {
  if (job.status === "SENT") {
    await repository.save(job);
    return { ok: true, jobId: job.id, status: "SENT" };
  }

  if (job.status === "DEAD_LETTERED") {
    await repository.save(job);
    return {
      ok: false,
      jobId: job.id,
      status: "DEAD_LETTERED",
      error: job.lastError ?? "print job is dead-lettered",
    };
  }

  const now = options.now ?? (new Date().toISOString() as IsoDateTimeString);
  const maxAttempts = options.maxAttempts ?? 3;
  const processingJob: PrinterJob = {
    ...job,
    status: "PROCESSING",
    updatedAt: now,
  };

  await repository.save(processingJob);

  try {
    await transport.send(processingJob);
    const sentJob: PrinterJob = {
      ...processingJob,
      status: "SENT",
      attemptCount: processingJob.attemptCount + 1,
      updatedAt: now,
    };
    await repository.save(sentJob);
    return { ok: true, jobId: sentJob.id, status: "SENT" };
  } catch (error) {
    const message = normalizeErrorMessage(error);
    const nextAttemptCount = processingJob.attemptCount + 1;
    const failedStatus = nextAttemptCount >= maxAttempts ? "DEAD_LETTERED" : "FAILED";
    const failedJob: PrinterJob = {
      ...processingJob,
      status: failedStatus,
      attemptCount: nextAttemptCount,
      updatedAt: now,
      lastError: message,
    };

    await repository.save(failedJob);
    return { ok: false, jobId: failedJob.id, status: failedStatus, error: message };
  }
}

export async function processNextPrintJob(
  repository: PrintJobQueueRepository,
  transport: PrinterTransport = new RecordingPrinterTransport(),
  options: ProcessPrintJobOptions = {}
): Promise<ProcessNextPrintJobResult> {
  const now = options.now ?? (new Date().toISOString() as IsoDateTimeString);
  const claimedJob = await repository.claimNext(now);
  if (!claimedJob) return { ok: true, status: "IDLE" };

  return processPrintJob(claimedJob, repository, transport, { ...options, now });
}

export async function drainPrintQueue(
  repository: PrintJobQueueRepository,
  transport: PrinterTransport = new RecordingPrinterTransport(),
  options: ProcessPrintJobOptions & { limit?: number } = {}
): Promise<DrainPrintQueueResult> {
  const limit = options.limit ?? 25;
  const result: DrainPrintQueueResult = {
    attemptedCount: 0,
    sentCount: 0,
    failedCount: 0,
    deadLetteredCount: 0,
  };

  for (let index = 0; index < limit; index += 1) {
    const processed = await processNextPrintJob(repository, transport, options);
    if (processed.status === "IDLE") break;

    result.attemptedCount += 1;
    if (processed.status === "SENT") result.sentCount += 1;
    if (processed.status === "FAILED") result.failedCount += 1;
    if (processed.status === "DEAD_LETTERED") result.deadLetteredCount += 1;
  }

  return result;
}

function isRunnablePrintJob(job: PrinterJob): boolean {
  return job.status === "QUEUED" || job.status === "FAILED";
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

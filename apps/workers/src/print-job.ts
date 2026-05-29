import type { IsoDateTimeString, PrinterJob, PrinterJobId } from "@packages/shared-types";

export interface PrintJobRepository {
  save(job: PrinterJob): Promise<void>;
  getById(jobId: PrinterJobId): Promise<PrinterJob | undefined>;
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

export class InMemoryPrintJobRepository implements PrintJobRepository {
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

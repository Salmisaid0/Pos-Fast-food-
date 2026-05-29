import type { IsoDateTimeString } from "@packages/shared-types";

import { drainPrintQueue, type DrainPrintQueueResult, type PrinterTransport } from "./print-job";
import type { PrintJobQueueRepository } from "./print-job";

export type PrintWorkerLogLevel = "INFO" | "ERROR";
export type PrintWorkerMetricName =
  | "print_worker_runs_total"
  | "print_worker_errors_total"
  | "print_jobs_attempted_total"
  | "print_jobs_sent_total"
  | "print_jobs_failed_total"
  | "print_jobs_dead_lettered_total";

export interface PrintWorkerLogEntry {
  level: PrintWorkerLogLevel;
  event: string;
  message: string;
  at: IsoDateTimeString;
  details?: Record<string, string | number | boolean>;
}

export interface PrintWorkerLogger {
  log(entry: PrintWorkerLogEntry): void;
}

export interface PrintWorkerMetrics {
  increment(metric: PrintWorkerMetricName, value?: number): void;
}

export interface PrintWorkerLoopOptions {
  repository: PrintJobQueueRepository;
  transport: PrinterTransport;
  intervalMs?: number;
  batchSize?: number;
  maxAttempts?: number;
  now?: () => IsoDateTimeString;
  logger?: PrintWorkerLogger;
  metrics?: PrintWorkerMetrics;
  shutdownSignals?: string[];
  onError?: (error: unknown) => void;
}

export class RecordingPrintWorkerLogger implements PrintWorkerLogger {
  readonly entries: PrintWorkerLogEntry[] = [];

  log(entry: PrintWorkerLogEntry): void {
    this.entries.push(entry);
  }
}

export class InMemoryPrintWorkerMetrics implements PrintWorkerMetrics {
  private readonly counters = new Map<PrintWorkerMetricName, number>();

  increment(metric: PrintWorkerMetricName, value = 1): void {
    this.counters.set(metric, (this.counters.get(metric) ?? 0) + value);
  }

  get(metric: PrintWorkerMetricName): number {
    return this.counters.get(metric) ?? 0;
  }
}

export class PrintWorkerLoop {
  private timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  private isRunning = false;
  private readonly shutdownHandlers: Array<{ signal: string; handler: () => void }> = [];

  constructor(private readonly options: PrintWorkerLoopOptions) {}

  get running(): boolean {
    return this.isRunning;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.registerShutdownHooks();
    this.log("INFO", "print_worker.started", "Print worker loop started");
    this.scheduleNextRun(0);
  }

  stop(reason = "manual_stop"): void {
    if (!this.isRunning && !this.timer) return;

    this.isRunning = false;
    if (this.timer) globalThis.clearTimeout(this.timer);
    this.timer = undefined;
    this.unregisterShutdownHooks();
    this.log("INFO", "print_worker.stopped", "Print worker loop stopped", { reason });
  }

  requestShutdown(reason = "shutdown_requested"): void {
    this.log("INFO", "print_worker.shutdown_requested", "Print worker shutdown requested", {
      reason,
    });
    this.stop(reason);
  }

  async runOnce(): Promise<DrainPrintQueueResult> {
    this.log("INFO", "print_worker.run_started", "Print worker drain cycle started");
    this.options.metrics?.increment("print_worker_runs_total");

    try {
      const result = await drainPrintQueue(
        this.options.repository,
        this.options.transport,
        this.createDrainOptions()
      );
      this.recordDrainMetrics(result);
      this.log("INFO", "print_worker.run_completed", "Print worker drain cycle completed", {
        attemptedCount: result.attemptedCount,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        deadLetteredCount: result.deadLetteredCount,
      });
      return result;
    } catch (error) {
      this.options.metrics?.increment("print_worker_errors_total");
      this.log("ERROR", "print_worker.run_failed", "Print worker drain cycle failed", {
        error: normalizeErrorMessage(error),
      });
      throw error;
    }
  }

  private createDrainOptions(): Parameters<typeof drainPrintQueue>[2] {
    const drainOptions: Parameters<typeof drainPrintQueue>[2] = {};
    if (this.options.batchSize !== undefined) drainOptions.limit = this.options.batchSize;
    if (this.options.maxAttempts !== undefined) drainOptions.maxAttempts = this.options.maxAttempts;
    if (this.options.now) drainOptions.now = this.options.now();
    return drainOptions;
  }

  private recordDrainMetrics(result: DrainPrintQueueResult): void {
    this.options.metrics?.increment("print_jobs_attempted_total", result.attemptedCount);
    this.options.metrics?.increment("print_jobs_sent_total", result.sentCount);
    this.options.metrics?.increment("print_jobs_failed_total", result.failedCount);
    this.options.metrics?.increment("print_jobs_dead_lettered_total", result.deadLetteredCount);
  }

  private scheduleNextRun(delayMs: number): void {
    if (!this.isRunning) return;

    this.timer = globalThis.setTimeout(() => {
      void this.pollAndReschedule();
    }, delayMs);
  }

  private async pollAndReschedule(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.scheduleNextRun(this.options.intervalMs ?? 1000);
    }
  }

  private registerShutdownHooks(): void {
    if (!this.options.shutdownSignals?.length || this.shutdownHandlers.length > 0) return;

    for (const signal of this.options.shutdownSignals) {
      const handler = () => this.requestShutdown(signal);
      process.once(signal, handler);
      this.shutdownHandlers.push({ signal, handler });
    }
  }

  private unregisterShutdownHooks(): void {
    for (const { signal, handler } of this.shutdownHandlers) {
      process.off(signal, handler);
    }
    this.shutdownHandlers.length = 0;
  }

  private log(
    level: PrintWorkerLogLevel,
    event: string,
    message: string,
    details?: Record<string, string | number | boolean>
  ): void {
    this.options.logger?.log({
      level,
      event,
      message,
      at: this.options.now?.() ?? (new Date().toISOString() as IsoDateTimeString),
      ...(details ? { details } : {}),
    });
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

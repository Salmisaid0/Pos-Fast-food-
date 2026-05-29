import type { RuntimePrinterConfig } from "./escpos-tcp-transport";
import { createTcpEscPosPrinterTransport } from "./escpos-tcp-transport";
import { FilePrintJobRepository } from "./file-print-job-repository";
import type { PrintJobQueueRepository, PrinterTransport } from "./print-job";
import { PrintWorkerLoop } from "./print-worker-loop";
import { createRedisPrintJobRepositoryFromConfig } from "./redis-runtime-config";
import type { RedisPrintQueueRuntimeConfig } from "./redis-runtime-config";
import { readRedisPrintQueueRuntimeConfig } from "./redis-runtime-config";

export type PrintQueueBackend = "redis" | "file";

export interface PrintWorkerRuntimeConfig {
  queueBackend: PrintQueueBackend;
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  printers: RuntimePrinterConfig[];
  fileQueuePath?: string;
  redis?: RedisPrintQueueRuntimeConfig;
}

export interface PrintWorkerRuntime {
  repository: PrintJobQueueRepository;
  transport: PrinterTransport;
  loop: PrintWorkerLoop;
}

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_MAX_ATTEMPTS = 3;

export function readPrintWorkerRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): PrintWorkerRuntimeConfig {
  const queueBackend = readQueueBackend(env.PRINT_QUEUE_BACKEND, env.PRINT_JOBS_FILE_PATH);
  const config: PrintWorkerRuntimeConfig = {
    queueBackend,
    intervalMs:
      readOptionalInteger(env.PRINT_WORKER_INTERVAL_MS, "PRINT_WORKER_INTERVAL_MS") ??
      DEFAULT_INTERVAL_MS,
    batchSize:
      readOptionalInteger(env.PRINT_WORKER_BATCH_SIZE, "PRINT_WORKER_BATCH_SIZE") ??
      DEFAULT_BATCH_SIZE,
    maxAttempts:
      readOptionalInteger(env.PRINT_WORKER_MAX_ATTEMPTS, "PRINT_WORKER_MAX_ATTEMPTS") ??
      DEFAULT_MAX_ATTEMPTS,
    printers: readRuntimePrinters(env.PRINTERS_JSON),
  };

  if (queueBackend === "file") {
    config.fileQueuePath = env.PRINT_JOBS_FILE_PATH ?? "./data/print-jobs.json";
  } else {
    config.redis = readRedisPrintQueueRuntimeConfig(env);
  }

  return config;
}

export function createPrintWorkerRuntime(config: PrintWorkerRuntimeConfig): PrintWorkerRuntime {
  const repository = createPrintJobRepository(config);
  const transport = createTcpEscPosPrinterTransport(config.printers);
  const loop = new PrintWorkerLoop({
    repository,
    transport,
    intervalMs: config.intervalMs,
    batchSize: config.batchSize,
    maxAttempts: config.maxAttempts,
  });

  return { repository, transport, loop };
}

export function readRuntimePrinters(value: string | undefined): RuntimePrinterConfig[] {
  if (!value) return [];

  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("PRINTERS_JSON must be a JSON array");

  return parsed.map((printer, index) => toRuntimePrinterConfig(printer, index));
}

function createPrintJobRepository(config: PrintWorkerRuntimeConfig): PrintJobQueueRepository {
  if (config.queueBackend === "file") {
    return new FilePrintJobRepository(config.fileQueuePath ?? "./data/print-jobs.json");
  }

  return createRedisPrintJobRepositoryFromConfig(config.redis);
}

function toRuntimePrinterConfig(value: unknown, index: number): RuntimePrinterConfig {
  if (typeof value !== "object" || value === null) {
    throw new Error(`Printer config at index ${index} must be an object`);
  }

  const candidate = value as Record<string, unknown>;
  const id = readRequiredString(candidate.id, `PRINTERS_JSON[${index}].id`);
  const host = readRequiredString(candidate.host, `PRINTERS_JSON[${index}].host`);
  const port = readRequiredNumber(candidate.port, `PRINTERS_JSON[${index}].port`);
  const printer: RuntimePrinterConfig = { id, host, port };

  const timeoutMs = readOptionalNumber(candidate.timeoutMs, `PRINTERS_JSON[${index}].timeoutMs`);
  if (timeoutMs !== undefined) printer.timeoutMs = timeoutMs;
  const codePageCommand = readOptionalNumber(
    candidate.codePageCommand,
    `PRINTERS_JSON[${index}].codePageCommand`
  );
  if (codePageCommand !== undefined) printer.codePageCommand = codePageCommand;
  const charactersPerLine = readOptionalNumber(
    candidate.charactersPerLine,
    `PRINTERS_JSON[${index}].charactersPerLine`
  );
  if (charactersPerLine !== undefined) printer.charactersPerLine = charactersPerLine;
  const rtl = readOptionalBoolean(candidate.rtl, `PRINTERS_JSON[${index}].rtl`);
  if (rtl !== undefined) printer.rtl = rtl;

  return printer;
}

function readQueueBackend(
  value: string | undefined,
  fileQueuePath: string | undefined
): PrintQueueBackend {
  if (!value) return fileQueuePath ? "file" : "redis";
  if (value === "redis" || value === "file") return value;
  throw new Error("PRINT_QUEUE_BACKEND must be either 'redis' or 'file'");
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`);
  }

  return value;
}

function readRequiredNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }

  return value;
}

function readOptionalNumber(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  return readRequiredNumber(value, name);
}

function readOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`);
  return value;
}

function readOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

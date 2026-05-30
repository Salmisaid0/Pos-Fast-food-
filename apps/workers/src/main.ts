import { createArabicCodePageTextEncoder } from "./arabic-code-page-encoder";
import { createTcpEscPosPrinterTransport, type RuntimePrinterConfig } from "./escpos-tcp-transport";
import { FilePrintJobRepository } from "./file-print-job-repository";
import {
  InMemoryPrintWorkerMetrics,
  PrintWorkerLoop,
  type PrintWorkerLogger,
  type PrintWorkerLoopOptions,
  type PrintWorkerMetrics,
} from "./print-worker-loop";
import type { PrintJobQueueRepository, PrinterTransport } from "./print-job";
import {
  createRedisPrintJobRepositoryFromConfig,
  readRedisPrintQueueRuntimeConfig,
} from "./redis-runtime-config";

export type PrintWorkerQueueBackend = "redis" | "file";

export interface PrintWorkerRuntimeConfig {
  queueBackend: PrintWorkerQueueBackend;
  fileQueuePath?: string;
  printers: RuntimePrinterConfig[];
  intervalMs: number;
  batchSize: number;
  maxAttempts: number;
  shutdownSignals: string[];
}

export interface PrintWorkerRuntime {
  config: PrintWorkerRuntimeConfig;
  repository: PrintJobQueueRepository;
  transport: PrinterTransport;
  logger: JsonConsolePrintWorkerLogger;
  metrics: PrintWorkerMetrics;
  loop: PrintWorkerLoop;
}

export class JsonConsolePrintWorkerLogger implements PrintWorkerLogger {
  log(entry: Parameters<PrintWorkerLogger["log"]>[0]): void {
    const writer = entry.level === "ERROR" ? console.error : console.log;
    writer(JSON.stringify(entry));
  }
}

export function readPrintWorkerRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): PrintWorkerRuntimeConfig {
  const queueBackend = readQueueBackend(env.PRINT_WORKER_QUEUE_BACKEND);
  const fileQueuePath = env.PRINT_WORKER_FILE_QUEUE_PATH;
  const config: PrintWorkerRuntimeConfig = {
    queueBackend,
    printers: readRuntimePrinters(env),
    intervalMs: readPositiveInteger(env.PRINT_WORKER_INTERVAL_MS, "PRINT_WORKER_INTERVAL_MS", 1000),
    batchSize: readPositiveInteger(env.PRINT_WORKER_BATCH_SIZE, "PRINT_WORKER_BATCH_SIZE", 25),
    maxAttempts: readPositiveInteger(env.PRINT_WORKER_MAX_ATTEMPTS, "PRINT_WORKER_MAX_ATTEMPTS", 3),
    shutdownSignals: readShutdownSignals(env.PRINT_WORKER_SHUTDOWN_SIGNALS),
  };

  if (fileQueuePath) config.fileQueuePath = fileQueuePath;
  return config;
}

export function createPrintWorkerRuntime(
  config: PrintWorkerRuntimeConfig = readPrintWorkerRuntimeConfig()
): PrintWorkerRuntime {
  const repository = createRepository(config);
  const transport = createTcpEscPosPrinterTransport(config.printers);
  const logger = new JsonConsolePrintWorkerLogger();
  const metrics = new InMemoryPrintWorkerMetrics();
  const loopOptions: PrintWorkerLoopOptions = {
    repository,
    transport,
    intervalMs: config.intervalMs,
    batchSize: config.batchSize,
    maxAttempts: config.maxAttempts,
    shutdownSignals: config.shutdownSignals,
    logger,
    metrics,
  };

  return {
    config,
    repository,
    transport,
    logger,
    metrics,
    loop: new PrintWorkerLoop(loopOptions),
  };
}

export function startPrintWorkerRuntime(
  config: PrintWorkerRuntimeConfig = readPrintWorkerRuntimeConfig()
): PrintWorkerRuntime {
  const runtime = createPrintWorkerRuntime(config);
  runtime.loop.start();
  return runtime;
}

function createRepository(config: PrintWorkerRuntimeConfig): PrintJobQueueRepository {
  if (config.queueBackend === "file") {
    if (!config.fileQueuePath) {
      throw new Error(
        "PRINT_WORKER_FILE_QUEUE_PATH is required when PRINT_WORKER_QUEUE_BACKEND=file"
      );
    }

    return new FilePrintJobRepository(config.fileQueuePath);
  }

  return createRedisPrintJobRepositoryFromConfig(readRedisPrintQueueRuntimeConfig());
}

function readRuntimePrinters(env: Record<string, string | undefined>): RuntimePrinterConfig[] {
  if (env.PRINTER_CONFIG_JSON) return parsePrinterConfigJson(env.PRINTER_CONFIG_JSON);

  const singlePrinterId = env.PRINTER_ID;
  const singlePrinterHost = env.PRINTER_HOST;
  const singlePrinterPort = env.PRINTER_PORT;
  if (singlePrinterId || singlePrinterHost || singlePrinterPort) {
    if (!singlePrinterId || !singlePrinterHost || !singlePrinterPort) {
      throw new Error("PRINTER_ID, PRINTER_HOST, and PRINTER_PORT are required together");
    }

    const printer: Partial<RuntimePrinterConfig> = {
      id: singlePrinterId,
      host: singlePrinterHost,
      port: readPositiveInteger(singlePrinterPort, "PRINTER_PORT", 9100),
      rtl: env.PRINTER_RTL === "true",
    };
    const timeoutMs = readOptionalPositiveInteger(env.PRINTER_TIMEOUT_MS, "PRINTER_TIMEOUT_MS");
    const codePageCommand = readOptionalInteger(
      env.PRINTER_CODE_PAGE_COMMAND,
      "PRINTER_CODE_PAGE_COMMAND"
    );
    const charactersPerLine = readOptionalPositiveInteger(
      env.PRINTER_CHARACTERS_PER_LINE,
      "PRINTER_CHARACTERS_PER_LINE"
    );
    if (timeoutMs !== undefined) printer.timeoutMs = timeoutMs;
    if (codePageCommand !== undefined) printer.codePageCommand = codePageCommand;
    if (charactersPerLine !== undefined) printer.charactersPerLine = charactersPerLine;
    if (env.PRINTER_ARABIC_ENCODER === "basic") {
      printer.textEncoder = createArabicCodePageTextEncoder();
    }

    return [normalizeRuntimePrinter(printer)];
  }

  return [];
}

function parsePrinterConfigJson(value: string): RuntimePrinterConfig[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error("PRINTER_CONFIG_JSON must be an array");

  return parsed.map((printer, index) => {
    if (typeof printer !== "object" || printer === null) {
      throw new Error(`Printer config at index ${index} must be an object`);
    }

    return normalizeRuntimePrinter(printer as Partial<RuntimePrinterConfig>);
  });
}

function normalizeRuntimePrinter(printer: Partial<RuntimePrinterConfig>): RuntimePrinterConfig {
  if (!printer.id) throw new Error("Printer config requires id");
  if (!printer.host) throw new Error(`Printer ${printer.id} requires host`);
  if (printer.port === undefined) throw new Error(`Printer ${printer.id} requires port`);

  const normalized: RuntimePrinterConfig = {
    id: printer.id,
    host: printer.host,
    port: Number(printer.port),
  };

  if (!Number.isInteger(normalized.port) || normalized.port <= 0 || normalized.port > 65535) {
    throw new Error(`Printer ${printer.id} has invalid port`);
  }

  if (printer.timeoutMs !== undefined) normalized.timeoutMs = Number(printer.timeoutMs);
  if (printer.codePageCommand !== undefined)
    normalized.codePageCommand = Number(printer.codePageCommand);
  if (printer.charactersPerLine !== undefined)
    normalized.charactersPerLine = Number(printer.charactersPerLine);
  if (printer.rtl !== undefined) normalized.rtl = Boolean(printer.rtl);
  if (printer.textEncoder !== undefined) normalized.textEncoder = printer.textEncoder;

  return normalized;
}

function readQueueBackend(value: string | undefined): PrintWorkerQueueBackend {
  if (value === undefined || value === "") return "redis";
  if (value === "redis" || value === "file") return value;
  throw new Error("PRINT_WORKER_QUEUE_BACKEND must be redis or file");
}

function readShutdownSignals(value: string | undefined): string[] {
  if (!value) return ["SIGINT", "SIGTERM"];
  return value
    .split(",")
    .map((signal) => signal.trim())
    .filter((signal) => signal.length > 0);
}

function readPositiveInteger(value: string | undefined, name: string, fallback: number): number {
  const parsed = readOptionalPositiveInteger(value, name);
  return parsed ?? fallback;
}

function readOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function readOptionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} must be an integer`);
  return parsed;
}

if (require.main === module) {
  startPrintWorkerRuntime();
}

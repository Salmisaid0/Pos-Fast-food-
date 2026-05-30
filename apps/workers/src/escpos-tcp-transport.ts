import { Buffer } from "node:buffer";
import { Socket } from "node:net";

import type { CurrencyDZD, Printer, PrinterJob, ReceiptLine } from "@packages/shared-types";

import type { PrinterTransport } from "./print-job";

export interface TcpPrinterEndpoint {
  host: string;
  port: number;
  timeoutMs?: number;
  codePageCommand?: number;
  charactersPerLine?: number;
  rtl?: boolean;
  textEncoder?: EscPosTextEncoder;
}

export interface RuntimePrinterConfig {
  id: string;
  host: string;
  port: number;
  timeoutMs?: number;
  codePageCommand?: number;
  charactersPerLine?: number;
  rtl?: boolean;
  textEncoder?: EscPosTextEncoder;
}

export type EscPosTextEncoder = (text: string) => Buffer;

export interface EscPosReceiptFormatOptions {
  codePageCommand?: number;
  charactersPerLine?: number;
  rtl?: boolean;
  textEncoder?: EscPosTextEncoder;
}

export type TcpPrinterEndpointRegistry = ReadonlyMap<string, TcpPrinterEndpoint>;

const DEFAULT_CHARACTERS_PER_LINE = 32;

export class TcpEscPosPrinterTransport implements PrinterTransport {
  constructor(private readonly endpoints: TcpPrinterEndpointRegistry) {}

  async send(job: PrinterJob): Promise<void> {
    const endpoint = this.endpoints.get(job.targetPrinterId);
    if (!endpoint) {
      throw new Error(`No TCP printer endpoint configured for printer ${job.targetPrinterId}`);
    }

    await sendTcpPayload(endpoint, buildEscPosReceiptPayload(job, endpoint));
  }
}

export function createTcpEscPosPrinterTransport(
  printers: RuntimePrinterConfig[]
): TcpEscPosPrinterTransport {
  return new TcpEscPosPrinterTransport(
    new Map(printers.map((printer) => [printer.id, toEndpoint(printer)]))
  );
}

function toEndpoint(printer: RuntimePrinterConfig): TcpPrinterEndpoint {
  const endpoint: TcpPrinterEndpoint = {
    host: printer.host,
    port: printer.port,
  };

  if (printer.timeoutMs !== undefined) endpoint.timeoutMs = printer.timeoutMs;
  if (printer.codePageCommand !== undefined) endpoint.codePageCommand = printer.codePageCommand;
  if (printer.charactersPerLine !== undefined)
    endpoint.charactersPerLine = printer.charactersPerLine;
  if (printer.rtl !== undefined) endpoint.rtl = printer.rtl;
  if (printer.textEncoder !== undefined) endpoint.textEncoder = printer.textEncoder;

  return endpoint;
}

export function createTcpEscPosPrinterTransportFromDomainPrinters(
  printers: Printer[],
  options: Omit<RuntimePrinterConfig, "id" | "host" | "port"> = {}
): TcpEscPosPrinterTransport {
  return createTcpEscPosPrinterTransport(
    printers
      .filter((printer) => printer.isActive)
      .map((printer) => ({
        id: printer.id,
        host: printer.ipAddress,
        port: printer.port,
        ...options,
      }))
  );
}

export function buildEscPosReceiptPayload(
  job: PrinterJob,
  options: EscPosReceiptFormatOptions = {}
): Buffer {
  const receipt = job.payload;
  const width = options.charactersPerLine ?? DEFAULT_CHARACTERS_PER_LINE;
  const lines: Buffer[] = [
    initializePrinter(),
    selectCodePage(options.codePageCommand),
    align("CENTER"),
    bold(true),
    encodeLine(formatDirectionalText("FAST FOOD POS", options.rtl), options.textEncoder),
    bold(false),
    align("LEFT"),
    encodeLine(separator(width), options.textEncoder),
    encodeLine(
      formatDirectionalText(`Receipt: ${receipt.receiptNumber}`, options.rtl),
      options.textEncoder
    ),
    encodeLine(
      formatDirectionalText(`Order: ${receipt.orderId}`, options.rtl),
      options.textEncoder
    ),
    encodeLine(
      formatDirectionalText(`Issued: ${receipt.issuedAt}`, options.rtl),
      options.textEncoder
    ),
    encodeLine(separator(width), options.textEncoder),
    ...receipt.lines.flatMap((line) =>
      encodeWrappedLine(formatReceiptLine(line), width, options.rtl, options.textEncoder)
    ),
    encodeLine(separator(width), options.textEncoder),
    encodeLine(
      formatAmountRow("Subtotal", receipt.subtotalDZD, width, options.rtl),
      options.textEncoder
    ),
    encodeLine(
      formatAmountRow("VAT", receipt.vatAmountDZD, width, options.rtl),
      options.textEncoder
    ),
    bold(true),
    encodeLine(formatAmountRow("TOTAL", receipt.totalDZD, width, options.rtl), options.textEncoder),
    bold(false),
    feedLines(2),
    align("CENTER"),
    encodeLine(formatDirectionalText("Thank you", options.rtl), options.textEncoder),
    align("LEFT"),
    feedLines(3),
    cutPaper(),
  ];

  return Buffer.concat(lines);
}

function initializePrinter(): Buffer {
  return Buffer.from([0x1b, 0x40]);
}

function selectCodePage(codePageCommand: number | undefined): Buffer {
  return codePageCommand === undefined
    ? Buffer.alloc(0)
    : Buffer.from([0x1b, 0x74, codePageCommand]);
}

function align(alignment: "LEFT" | "CENTER" | "RIGHT"): Buffer {
  const value = alignment === "LEFT" ? 0 : alignment === "CENTER" ? 1 : 2;
  return Buffer.from([0x1b, 0x61, value]);
}

function bold(enabled: boolean): Buffer {
  return Buffer.from([0x1b, 0x45, enabled ? 1 : 0]);
}

function feedLines(count: number): Buffer {
  return Buffer.from([0x1b, 0x64, count]);
}

function cutPaper(): Buffer {
  return Buffer.from([0x1d, 0x56, 0x00]);
}

function encodeLine(line: string, textEncoder?: EscPosTextEncoder): Buffer {
  const encodedLine = textEncoder ? textEncoder(line) : Buffer.from(line, "utf8");
  return Buffer.concat([encodedLine, Buffer.from("\n", "utf8")]);
}

function encodeWrappedLine(
  line: string,
  width: number,
  rtl: boolean | undefined,
  textEncoder?: EscPosTextEncoder
): Buffer[] {
  return wrapLine(line, width).map((wrappedLine) =>
    encodeLine(formatDirectionalText(wrappedLine, rtl), textEncoder)
  );
}

function formatReceiptLine(line: ReceiptLine): string {
  return `${line.quantity} x ${line.productName} @ ${formatCurrency(line.unitPriceDZD)} = ${formatCurrency(
    line.totalDZD
  )}`;
}

function formatAmountRow(
  label: string,
  amount: CurrencyDZD,
  width: number,
  rtl: boolean | undefined
): string {
  const amountText = formatCurrency(amount);
  const padding = Math.max(width - label.length - amountText.length, 1);
  return formatDirectionalText(`${label}${" ".repeat(padding)}${amountText}`, rtl);
}

function formatCurrency(amount: CurrencyDZD): string {
  return `${amount.toFixed(2)} DZD`;
}

function separator(width: number): string {
  return "-".repeat(width);
}

function wrapLine(line: string, width: number): string[] {
  if (line.length <= width) return [line];

  const words = line.split(" ");
  const wrappedLines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length > width && currentLine) {
      wrappedLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }

  if (currentLine) wrappedLines.push(currentLine);
  return wrappedLines;
}

function formatDirectionalText(text: string, rtl: boolean | undefined): string {
  if (!rtl || !containsArabic(text)) return text;
  return Array.from(text).reverse().join("");
}

function containsArabic(text: string): boolean {
  return /[\u0600-\u06ff]/u.test(text);
}

async function sendTcpPayload(endpoint: TcpPrinterEndpoint, payload: Buffer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket();
    let settled = false;

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      callback();
    };

    socket.once("error", (error: Error) => {
      settle(() => reject(error));
    });

    socket.once("timeout", () => {
      socket.destroy();
      settle(() =>
        reject(new Error(`TCP printer timed out after ${endpoint.timeoutMs ?? 5000}ms`))
      );
    });

    socket.once("close", () => {
      settle(resolve);
    });

    if (endpoint.timeoutMs !== undefined) socket.setTimeout(endpoint.timeoutMs);

    socket.connect(endpoint.port, endpoint.host, () => {
      socket.write(payload, (error: Error | null | undefined) => {
        if (error) {
          settle(() => reject(error));
          return;
        }

        socket.end();
      });
    });
  });
}

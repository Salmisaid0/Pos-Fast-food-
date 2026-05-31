 codex/develop-offline-first-fast-food-pos-system-rdcuxz

 codex/develop-offline-first-fast-food-pos-system-q845bw
 main
import type { FiscalReceiptInput, FiscalVersion, Receipt, VatRate } from "@packages/shared-types";

export const FISCAL_ENGINE_VERSION: FiscalVersion = "v1";
export const VAT_RATE_DISABLED: VatRate = 0;

export class InvalidFiscalInputError extends Error {
  override readonly name = "InvalidFiscalInputError";
}

export class UnsupportedVatRateError extends Error {
  override readonly name = "UnsupportedVatRateError";
}

export class InvalidReceiptLineError extends Error {
  override readonly name = "InvalidReceiptLineError";
}

export function roundCurrencyDZD(value: number): number {
  assertFiniteNumber(value, "currency value");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateReceipt(input: FiscalReceiptInput): Receipt {
  validateReceiptInput(input);

  const lines = input.lines.map((line, index) => {
    const subtotalDZD = roundCurrencyDZD(line.unitPriceDZD * line.quantity);
    const vatAmountDZD = roundCurrencyDZD(subtotalDZD * line.vatRate);
    const totalDZD = roundCurrencyDZD(subtotalDZD + vatAmountDZD);

    return {
      ...line,
      lineNumber: index + 1,
      subtotalDZD,
      vatAmountDZD,
      totalDZD,
    };
  });

  const subtotalDZD = roundCurrencyDZD(lines.reduce((sum, line) => sum + line.subtotalDZD, 0));
  const vatAmountDZD = roundCurrencyDZD(lines.reduce((sum, line) => sum + line.vatAmountDZD, 0));
  const totalDZD = roundCurrencyDZD(subtotalDZD + vatAmountDZD);

  return {
    id: input.receiptId,
    orderId: input.orderId,
    receiptNumber: input.receiptNumber,
    fiscalVersion: FISCAL_ENGINE_VERSION,
    subtotalDZD,
    vatRate: VAT_RATE_DISABLED,
    vatAmountDZD,
    totalDZD,
    issuedAt: input.issuedAt,
    lines,
  };
}

function validateReceiptInput(input: FiscalReceiptInput): void {
  assertNonEmptyString(input.orderId, "orderId");
  assertNonEmptyString(input.receiptId, "receiptId");
  assertNonEmptyString(input.receiptNumber, "receiptNumber");
  assertIsoDateTime(input.issuedAt, "issuedAt");

  if (input.lines.length === 0) {
    throw new InvalidFiscalInputError("Receipt must contain at least one line.");
  }

  input.lines.forEach((line, index) => {
    const fieldPrefix = `lines[${index}]`;
    assertNonEmptyString(line.productId, `${fieldPrefix}.productId`);
    assertNonEmptyString(line.productSku, `${fieldPrefix}.productSku`);
    assertNonEmptyString(line.productName, `${fieldPrefix}.productName`);
    assertFiniteNumber(line.quantity, `${fieldPrefix}.quantity`);
    assertFiniteNumber(line.unitPriceDZD, `${fieldPrefix}.unitPriceDZD`);

    if (line.quantity <= 0) {
      throw new InvalidReceiptLineError(`${fieldPrefix}.quantity must be greater than zero.`);
    }

    if (line.unitPriceDZD < 0) {
      throw new InvalidReceiptLineError(
        `${fieldPrefix}.unitPriceDZD must be greater than or equal to zero.`
      );
    }

    if (line.vatRate !== VAT_RATE_DISABLED) {
      throw new UnsupportedVatRateError(
        `${fieldPrefix}.vatRate must be ${VAT_RATE_DISABLED} for fiscal v1 (VAT disabled).`
      );
    }
  });
}

function assertNonEmptyString(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new InvalidFiscalInputError(`${fieldName} must be a non-empty string.`);
  }
}

function assertIsoDateTime(value: string, fieldName: string): void {
  assertNonEmptyString(value, fieldName);

  if (Number.isNaN(Date.parse(value))) {
    throw new InvalidFiscalInputError(`${fieldName} must be a valid ISO date-time string.`);
  }
}

function assertFiniteNumber(value: number, fieldName: string): void {
  if (!Number.isFinite(value)) {
    throw new InvalidFiscalInputError(`${fieldName} must be a finite number.`);
  }
}
 codex/develop-offline-first-fast-food-pos-system-rdcuxz


import { Receipt } from "../../shared-types/src";

export const FISCAL_ENGINE_VERSION = "v1" as const;
export const VAT_RATE_RESTAURATION = 0.09;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateReceipt(orderId: string, subtotalDZD: number, generatedAt = new Date().toISOString()): Receipt {
  const vatAmountDZD = round2(subtotalDZD * VAT_RATE_RESTAURATION);
  const totalDZD = round2(subtotalDZD + vatAmountDZD);

  return {
    orderId,
    fiscalVersion: FISCAL_ENGINE_VERSION,
    subtotalDZD: round2(subtotalDZD),
    vatRate: VAT_RATE_RESTAURATION,
    vatAmountDZD,
    totalDZD,
    generatedAt,
  };
}
 main
 main

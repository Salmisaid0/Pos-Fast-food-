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

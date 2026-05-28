import { ReceiptTotals } from "../../shared-types/src";

const VAT_RATE_RESTAURATION = 0.09;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function calculateReceiptTotals(subtotalDZD: number): ReceiptTotals {
  const vatAmountDZD = round2(subtotalDZD * VAT_RATE_RESTAURATION);
  const totalDZD = round2(subtotalDZD + vatAmountDZD);

  return {
    subtotalDZD: round2(subtotalDZD),
    vatRate: VAT_RATE_RESTAURATION,
    vatAmountDZD,
    totalDZD,
  };
}

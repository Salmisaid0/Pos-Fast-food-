import { CashPayment } from "../../../packages/shared-types/src";

export function calculateCashPayment(totalDZD: number, receivedDZD: number): CashPayment {
  if (receivedDZD < totalDZD) {
    throw new Error("Received cash is less than order total.");
  }

  return {
    receivedDZD,
    totalDZD,
    changeDZD: Math.round((receivedDZD - totalDZD) * 100) / 100,
  };
}

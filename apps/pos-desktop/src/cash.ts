import { CashPayment } from "../../../packages/shared-types/src";

export function calculateCashPayment(
  orderId: string,
  totalDZD: number,
  receivedDZD: number,
  paidAt = new Date().toISOString()
): CashPayment {
  if (receivedDZD < totalDZD) {
    throw new Error("Received cash is less than order total.");
  }

  return {
    orderId,
    method: "CASH",
    receivedDZD,
    totalDZD,
    changeDZD: Math.round((receivedDZD - totalDZD) * 100) / 100,
    paidAt,
  };
}

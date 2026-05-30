 codex/develop-offline-first-fast-food-pos-system-q845bw
import type { CashPayment, IsoDateTimeString, OrderId, PaymentId } from "@packages/shared-types";

export interface CalculateCashPaymentInput {
  paymentId: PaymentId;
  orderId: OrderId;
  amountDueDZD: number;
  receivedDZD: number;
  paidAt?: IsoDateTimeString;
  createdAt?: IsoDateTimeString;
}

export function calculateCashPayment(input: CalculateCashPaymentInput): CashPayment {
  if (input.receivedDZD < input.amountDueDZD) {
    throw new Error("Received cash is less than order total.");
  }

  const timestamp = new Date().toISOString() as IsoDateTimeString;

  return {
    id: input.paymentId,
    orderId: input.orderId,
    method: "CASH",
    status: "RECORDED",
    amountDueDZD: input.amountDueDZD,
    receivedDZD: input.receivedDZD,
    changeDZD: Math.round((input.receivedDZD - input.amountDueDZD) * 100) / 100,
    paidAt: input.paidAt ?? timestamp,
    createdAt: input.createdAt ?? timestamp,

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
 main
  };
}

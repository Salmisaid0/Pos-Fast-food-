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
  };
}

import type {
  IsoDateTimeString,
  OrderId,
  PaymentId,
  PrinterId,
  PrinterJobId,
  ReceiptId,
  ReceiptNumber,
} from "@packages/shared-types";

import {
  calculateCartSummary,
  toFiscalReceiptInputLines,
  type CartState,
} from "../cart/cart-state";
import {
  finalizeCashSale,
  type FinalizedCashSale,
  type LocalSaleRepositories,
} from "../../local-sale";

export type CashCheckoutStatus = "CART_EMPTY" | "READY" | "UNDERPAID";

export interface CashCheckoutState {
  amountDueDZD: number;
  receivedDZD: number;
  changeDZD: number;
  canFinalize: boolean;
  status: CashCheckoutStatus;
  message: string;
}

export interface FinalizeCartCashSaleInput {
  cart: CartState;
  receivedDZD: number;
  localSequence: number;
  finalizedAt: IsoDateTimeString;
  repositories: LocalSaleRepositories;
  printer?: {
    printerJobId?: PrinterJobId;
    targetPrinterId: PrinterId;
  };
}

export function buildCashCheckoutState(cart: CartState, receivedDZD: number): CashCheckoutState {
  const summary = calculateCartSummary(cart);

  if (summary.itemCount === 0) {
    return {
      amountDueDZD: 0,
      receivedDZD,
      changeDZD: 0,
      canFinalize: false,
      status: "CART_EMPTY",
      message: "Add products before checkout.",
    };
  }

  if (receivedDZD < summary.totalDZD) {
    return {
      amountDueDZD: summary.totalDZD,
      receivedDZD,
      changeDZD: 0,
      canFinalize: false,
      status: "UNDERPAID",
      message: `Remaining ${summary.totalDZD - receivedDZD} DZD`,
    };
  }

  return {
    amountDueDZD: summary.totalDZD,
    receivedDZD,
    changeDZD: receivedDZD - summary.totalDZD,
    canFinalize: true,
    status: "READY",
    message: "Ready to finalize locally.",
  };
}

export async function finalizeCartCashSale(
  input: FinalizeCartCashSaleInput
): Promise<FinalizedCashSale> {
  const checkout = buildCashCheckoutState(input.cart, input.receivedDZD);
  if (!checkout.canFinalize) {
    throw new Error(checkout.message);
  }

  const ids = createLocalSaleIds(input.localSequence);

  const finalizeInput = {
    orderId: ids.orderId,
    paymentId: ids.paymentId,
    receiptId: ids.receiptId,
    receiptNumber: ids.receiptNumber,
    localSequence: input.localSequence,
    items: toFiscalReceiptInputLines(input.cart),
    receivedDZD: input.receivedDZD,
    finalizedAt: input.finalizedAt,
  };

  return finalizeCashSale(
    input.printer
      ? {
          ...finalizeInput,
          printer: {
            printerJobId: input.printer.printerJobId ?? ids.printerJobId,
            targetPrinterId: input.printer.targetPrinterId,
          },
        }
      : finalizeInput,
    input.repositories
  );
}

function createLocalSaleIds(localSequence: number): {
  orderId: OrderId;
  paymentId: PaymentId;
  receiptId: ReceiptId;
  receiptNumber: ReceiptNumber;
  printerJobId: PrinterJobId;
} {
  const paddedSequence = String(localSequence).padStart(6, "0");

  return {
    orderId: `local-order-${paddedSequence}` as OrderId,
    paymentId: `local-payment-${paddedSequence}` as PaymentId,
    receiptId: `local-receipt-${paddedSequence}` as ReceiptId,
    receiptNumber: `R-LOCAL-${paddedSequence}` as ReceiptNumber,
    printerJobId: `local-printer-job-${paddedSequence}` as PrinterJobId,
  };
}

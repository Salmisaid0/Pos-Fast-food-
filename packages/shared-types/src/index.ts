export type CurrencyDZD = number;

export interface Product {
  id: string;
  name: string;
  priceDZD: CurrencyDZD;
  active: boolean;
}

export interface OrderItem {
  productId: string;
  quantity: number;
  unitPriceDZD: CurrencyDZD;
  lineTotalDZD: CurrencyDZD;
}

export interface CashPayment {
  receivedDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
  changeDZD: CurrencyDZD;
}

export interface ReceiptTotals {
  subtotalDZD: CurrencyDZD;
  vatRate: number;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
}

export interface SyncEvent {
  id: string;
  type: "ORDER_CREATED";
  payload: unknown;
  createdAt: string;
  idempotencyKey: string;
}

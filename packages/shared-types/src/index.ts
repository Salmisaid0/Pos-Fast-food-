export type CurrencyDZD = number;

export interface OrderItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceDZD: CurrencyDZD;
  lineTotalDZD: CurrencyDZD;
}

export interface Order {
  id: string;
  localSequence: number;
  status: "PENDING_SYNC" | "SYNCED";
  items: OrderItem[];
  subtotalDZD: CurrencyDZD;
  createdAt: string;
}

export interface CashPayment {
  orderId: string;
  method: "CASH";
  receivedDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
  changeDZD: CurrencyDZD;
  paidAt: string;
}

export interface Receipt {
  orderId: string;
  fiscalVersion: "v1";
  subtotalDZD: CurrencyDZD;
  vatRate: number;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
  generatedAt: string;
}

export interface SyncEvent {
  id: string;
  type: "ORDER_CREATED" | "CASH_PAYMENT_RECORDED";
  payload: unknown;
  createdAt: string;
  idempotencyKey: string;
}

export interface PrinterJob {
  id: string;
  orderId: string;
  printerIp: string;
  content: string;
  status: "QUEUED" | "SENT" | "FAILED";
  createdAt: string;
}

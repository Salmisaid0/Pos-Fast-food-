 codex/develop-offline-first-fast-food-pos-system-q845bw
export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type EntityId = Brand<string, "EntityId">;
export type ProductId = Brand<string, "ProductId">;
export type ProductCategoryId = Brand<string, "ProductCategoryId">;
export type OrderId = Brand<string, "OrderId">;
export type PaymentId = Brand<string, "PaymentId">;
export type ReceiptId = Brand<string, "ReceiptId">;
export type ReceiptNumber = Brand<string, "ReceiptNumber">;
export type PrinterId = Brand<string, "PrinterId">;
export type PrinterJobId = Brand<string, "PrinterJobId">;
export type SyncEventId = Brand<string, "SyncEventId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type IsoDateTimeString = Brand<string, "IsoDateTimeString">;
export type CurrencyDZD = number;

export type FiscalVersion = "v1";
export type VatRate = 0;
export type OrderStatus =
  | "DRAFT"
  | "FINALIZED_LOCAL"
  | "PENDING_SYNC"
  | "SYNCED"
  | "SYNC_FAILED"
  | "VOIDED";
export type PaymentStatus = "RECORDED" | "VOIDED";
export type PrinterRole = "RECEIPT" | "KITCHEN";
export type PrinterJobStatus = "QUEUED" | "PROCESSING" | "SENT" | "FAILED" | "DEAD_LETTERED";
export type SyncEventType =
  | "ORDER_FINALIZED"
  | "CASH_PAYMENT_RECORDED"
  | "RECEIPT_ISSUED"
  | "PRINT_JOB_REQUESTED";
export type SyncAggregateType = "ORDER" | "PAYMENT" | "RECEIPT" | "PRINTER_JOB";
export type LocalOutboxStatus = "PENDING" | "SYNCED" | "FAILED";

export interface ProductCategory {
  id: ProductCategoryId;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface Product {
  id: ProductId;
  sku: string;
  name: string;
  description?: string;
  priceDZD: CurrencyDZD;
  vatRate: VatRate;
  categoryId: ProductCategoryId;
  isActive: boolean;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface OrderItem {
  id: EntityId;
  productId: ProductId;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceDZD: CurrencyDZD;
  vatRate: VatRate;
  subtotalDZD: CurrencyDZD;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
}

export interface Order {
  id: OrderId;
  localSequence: number;
  status: OrderStatus;
  items: OrderItem[];
  subtotalDZD: CurrencyDZD;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
  receiptId?: ReceiptId;
  paymentId?: PaymentId;
  createdAt: IsoDateTimeString;
  finalizedAt?: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface CashPayment {
  id: PaymentId;
  orderId: OrderId;
  method: "CASH";
  status: PaymentStatus;
  amountDueDZD: CurrencyDZD;
  receivedDZD: CurrencyDZD;
  changeDZD: CurrencyDZD;
  paidAt: IsoDateTimeString;
  createdAt: IsoDateTimeString;
}

export interface FiscalReceiptInputLine {
  productId: ProductId;
  productSku: string;
  productName: string;
  quantity: number;
  unitPriceDZD: CurrencyDZD;
  vatRate: VatRate;
}

export interface FiscalReceiptInput {
  receiptId: ReceiptId;
  receiptNumber: ReceiptNumber;
  orderId: OrderId;
  issuedAt: IsoDateTimeString;
  lines: FiscalReceiptInputLine[];
}

export interface ReceiptLine extends FiscalReceiptInputLine {
  lineNumber: number;
  subtotalDZD: CurrencyDZD;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
}

export interface Receipt {
  id: ReceiptId;
  orderId: OrderId;
  receiptNumber: ReceiptNumber;
  fiscalVersion: FiscalVersion;
  subtotalDZD: CurrencyDZD;
  vatRate: VatRate;
  vatAmountDZD: CurrencyDZD;
  totalDZD: CurrencyDZD;
  issuedAt: IsoDateTimeString;
  lines: ReceiptLine[];
}

export interface OrderFinalizedEventPayload {
  order: Order;
}

export interface CashPaymentRecordedEventPayload {
  payment: CashPayment;
}

export interface ReceiptIssuedEventPayload {
  receipt: Receipt;
}

export interface PrintJobRequestedEventPayload {
  printerJob: PrinterJob;
}

export type SyncEventPayloadByType = {
  ORDER_FINALIZED: OrderFinalizedEventPayload;
  CASH_PAYMENT_RECORDED: CashPaymentRecordedEventPayload;
  RECEIPT_ISSUED: ReceiptIssuedEventPayload;
  PRINT_JOB_REQUESTED: PrintJobRequestedEventPayload;
};

export type SyncEvent<TType extends SyncEventType = SyncEventType> = {
  [K in TType]: {
    id: SyncEventId;
    type: K;
    schemaVersion: 1;
    aggregateId: string;
    aggregateType: SyncAggregateType;
    payload: SyncEventPayloadByType[K];
    createdAt: IsoDateTimeString;
    idempotencyKey: IdempotencyKey;
    attemptCount: number;
    lastAttemptAt?: IsoDateTimeString;
  };
}[TType];

export interface Printer {
  id: PrinterId;
  name: string;
  ipAddress: string;
  port: number;
  role: PrinterRole;
  isActive: boolean;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
}

export interface LocalOutboxEntry {
  event: SyncEvent;
  status: LocalOutboxStatus;
  createdAt: IsoDateTimeString;
  syncedAt?: IsoDateTimeString;
  lastError?: string;
}

export interface PrinterJob {
  id: PrinterJobId;
  orderId: OrderId;
  receiptId: ReceiptId;
  type: PrinterRole;
  targetPrinterId: PrinterId;
  payload: Receipt;
  status: PrinterJobStatus;
  attemptCount: number;
  createdAt: IsoDateTimeString;
  updatedAt: IsoDateTimeString;
  lastError?: string;
=======
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
 main
}

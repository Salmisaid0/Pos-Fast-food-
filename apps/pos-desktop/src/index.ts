export { calculateCashPayment } from "./cash";
export { LocalJsonSaleRepositories, type LocalJsonSaleStore } from "./local-json-storage";
export { finalizeCashSale, InMemoryLocalSaleRepositories } from "./local-sale";
export { listActiveProducts, seedCategories, seedProducts } from "./features/catalog/seed-catalog";
export {
  addProductToCart,
  calculateCartSummary,
  clearCart,
  createEmptyCart,
  decrementCartLine,
  removeCartLine,
  toFiscalReceiptInputLines,
  type CartLine,
  type CartState,
  type CartSummary,
} from "./features/cart/cart-state";
export {
  buildCashCheckoutState,
  finalizeCartCashSale,
  type CashCheckoutState,
  type CashCheckoutStatus,
  type FinalizeCartCashSaleInput,
} from "./features/checkout/checkout-state";

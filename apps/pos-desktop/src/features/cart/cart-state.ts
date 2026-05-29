import type { FiscalReceiptInputLine, Product, ProductId } from "@packages/shared-types";

export interface CartLine {
  product: Product;
  quantity: number;
}

export interface CartState {
  lines: CartLine[];
}

export interface CartSummary {
  itemCount: number;
  subtotalDZD: number;
  totalDZD: number;
}

export function createEmptyCart(): CartState {
  return { lines: [] };
}

export function addProductToCart(cart: CartState, product: Product): CartState {
  const existingLine = cart.lines.find((line) => line.product.id === product.id);
  if (existingLine) {
    return {
      lines: cart.lines.map((line) =>
        line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line
      ),
    };
  }

  return { lines: [...cart.lines, { product, quantity: 1 }] };
}

export function decrementCartLine(cart: CartState, productId: ProductId): CartState {
  return {
    lines: cart.lines.flatMap((line) => {
      if (line.product.id !== productId) return [line];
      const quantity = line.quantity - 1;
      return quantity > 0 ? [{ ...line, quantity }] : [];
    }),
  };
}

export function removeCartLine(cart: CartState, productId: ProductId): CartState {
  return { lines: cart.lines.filter((line) => line.product.id !== productId) };
}

export function clearCart(): CartState {
  return createEmptyCart();
}

export function calculateCartSummary(cart: CartState): CartSummary {
  const subtotalDZD = cart.lines.reduce(
    (sum, line) => sum + line.quantity * line.product.priceDZD,
    0
  );

  return {
    itemCount: cart.lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalDZD,
    totalDZD: subtotalDZD,
  };
}

export function toFiscalReceiptInputLines(cart: CartState): FiscalReceiptInputLine[] {
  return cart.lines.map((line) => ({
    productId: line.product.id,
    productSku: line.product.sku,
    productName: line.product.name,
    quantity: line.quantity,
    unitPriceDZD: line.product.priceDZD,
    vatRate: line.product.vatRate,
  }));
}

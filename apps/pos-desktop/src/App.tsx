import { useMemo, useState, type ReactElement } from "react";

import { seedProducts } from "./features/catalog/seed-catalog";
import {
  addProductToCart,
  calculateCartSummary,
  clearCart,
  createEmptyCart,
  decrementCartLine,
  removeCartLine,
  type CartState,
} from "./features/cart/cart-state";
import { buildCashCheckoutState, finalizeCartCashSale } from "./features/checkout/checkout-state";
import { InMemoryLocalSaleRepositories } from "./local-sale";
import type { IsoDateTimeString } from "@packages/shared-types";

const repositories = new InMemoryLocalSaleRepositories();

export function App(): ReactElement {
  const [cart, setCart] = useState<CartState>(() => createEmptyCart());
  const [receivedDZD, setReceivedDZD] = useState(0);
  const [localSequence, setLocalSequence] = useState(1);
  const [saleStatus, setSaleStatus] = useState("No sale finalized yet.");
  const summary = useMemo(() => calculateCartSummary(cart), [cart]);
  const checkout = useMemo(() => buildCashCheckoutState(cart, receivedDZD), [cart, receivedDZD]);

  async function finalizeSale(): Promise<void> {
    const sale = await finalizeCartCashSale({
      cart,
      receivedDZD,
      localSequence,
      finalizedAt: new Date().toISOString() as IsoDateTimeString,
      repositories,
    });

    setSaleStatus(
      `Sale ${sale.order.localSequence} saved locally with ${sale.syncEvents.length} pending sync events.`
    );
    setLocalSequence((sequence) => sequence + 1);
    setReceivedDZD(0);
    setCart(clearCart());
  }

  return (
    <main className="pos-shell">
      <section className="catalog-panel" aria-labelledby="catalog-heading">
        <header>
          <p className="eyebrow">Single branch · Cash only · Offline first</p>
          <h1 id="catalog-heading">Fast Food POS</h1>
        </header>
        <div className="product-grid">
          {seedProducts.map((product) => (
            <button
              className="product-card"
              key={product.id}
              type="button"
              onClick={() => setCart((currentCart) => addProductToCart(currentCart, product))}
            >
              <span>{product.name}</span>
              <strong>{product.priceDZD} DZD</strong>
            </button>
          ))}
        </div>
      </section>

      <aside className="checkout-panel" aria-labelledby="cart-heading">
        <h2 id="cart-heading">Cart</h2>
        {cart.lines.length === 0 ? (
          <p className="empty-state">Add products to start a sale.</p>
        ) : (
          <ul className="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.product.id}>
                <div>
                  <strong>{line.product.name}</strong>
                  <span>
                    {line.quantity} × {line.product.priceDZD} DZD
                  </span>
                </div>
                <div className="line-actions">
                  <button
                    type="button"
                    onClick={() =>
                      setCart((currentCart) => decrementCartLine(currentCart, line.product.id))
                    }
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCart((currentCart) => removeCartLine(currentCart, line.product.id))
                    }
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <section className="totals" aria-label="Sale totals">
          <span>Items</span>
          <strong>{summary.itemCount}</strong>
          <span>Total</span>
          <strong>{summary.totalDZD} DZD</strong>
        </section>

        <label className="cash-input">
          Cash received (DZD)
          <input
            min="0"
            inputMode="numeric"
            type="number"
            value={receivedDZD}
            onChange={(event) => setReceivedDZD(Number(event.target.value))}
          />
        </label>

        <section className="change-box" aria-live="polite">
          <span>{checkout.message}</span>
          <strong>Change: {checkout.changeDZD} DZD</strong>
        </section>

        <button
          className="finalize-button"
          disabled={!checkout.canFinalize}
          type="button"
          onClick={() => void finalizeSale()}
        >
          Finalize local cash sale
        </button>

        <p className="sale-status">{saleStatus}</p>
      </aside>
    </main>
  );
}

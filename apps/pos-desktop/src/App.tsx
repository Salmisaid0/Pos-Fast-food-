import { useEffect, useMemo, useState, type ReactElement } from "react";

import type { ProductCategoryId } from "@packages/shared-types";
import type { IsoDateTimeString } from "@packages/shared-types";

import {
  addProductToCart,
  calculateCartSummary,
  clearCart,
  createEmptyCart,
  decrementCartLine,
  removeCartLine,
  type CartState,
} from "./features/cart/cart-state";
import {
  filterActiveProducts,
  seedCategories,
  seedProducts,
} from "./features/catalog/seed-catalog";
import { buildCashCheckoutState, finalizeCartCashSale } from "./features/checkout/checkout-state";
import {
  createReceiptNumberPreview,
  formatSaleTimestamp,
  loadLocalSalesSnapshot,
  type LocalSalesSnapshot,
} from "./features/sales/recent-sales";
import { createDefaultLocalSaleRepositories } from "./local-repository-factory";
import { resolveLocalStoreTarget } from "./local-store-runtime";
import { HttpRemoteSyncApi, startOutboxSyncLoop, type PosOutboxSyncSnapshot } from "./pos-sync";

const localStoreTarget = resolveLocalStoreTarget();
const repositories = createDefaultLocalSaleRepositories(localStoreTarget);
const remoteSyncApi = new HttpRemoteSyncApi();
const allCategories = "ALL";
const cashDigits = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "0"];

export function App(): ReactElement {
  const [cart, setCart] = useState<CartState>(() => createEmptyCart());
  const [receivedDZD, setReceivedDZD] = useState(0);
  const [localSequence, setLocalSequence] = useState(1);
  const [saleStatus, setSaleStatus] = useState("No sale finalized yet.");
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    ProductCategoryId | typeof allCategories
  >(allCategories);
  const [searchTerm, setSearchTerm] = useState("");
  const [isConfirmingSale, setIsConfirmingSale] = useState(false);
  const [salesSnapshot, setSalesSnapshot] = useState<LocalSalesSnapshot>({
    recentSales: [],
    pendingSyncCount: 0,
    failedSyncCount: 0,
    nextLocalSequence: 1,
  });
  const [syncSnapshot, setSyncSnapshot] = useState<PosOutboxSyncSnapshot>({
    status: "IDLE",
    pendingCount: 0,
    failedEventCount: 0,
    attemptedCount: 0,
    syncedCount: 0,
    failedAttemptCount: 0,
  });
  const summary = useMemo(() => calculateCartSummary(cart), [cart]);
  const checkout = useMemo(() => buildCashCheckoutState(cart, receivedDZD), [cart, receivedDZD]);
  const receiptNumberPreview = createReceiptNumberPreview(localSequence);
  const filteredProducts = useMemo(
    () =>
      filterActiveProducts(seedProducts, {
        categoryId: selectedCategoryId === allCategories ? undefined : selectedCategoryId,
        searchTerm,
      }),
    [searchTerm, selectedCategoryId]
  );

  useEffect(() => {
    void refreshLocalSales();
  }, []);

  useEffect(() => {
    const syncLoop = startOutboxSyncLoop({
      repositories,
      api: remoteSyncApi,
      intervalMs: 10_000,
      async onStateChange(snapshot) {
        setSyncSnapshot(snapshot);
        await refreshLocalSales();
      },
    });

    return () => syncLoop.stop();
  }, []);

  async function refreshLocalSales(): Promise<void> {
    const snapshot = await loadLocalSalesSnapshot(repositories, 5);
    setSalesSnapshot(snapshot);
    setLocalSequence(snapshot.nextLocalSequence);
  }

  async function finalizeSale(): Promise<void> {
    if (!isConfirmingSale) {
      setIsConfirmingSale(true);
      return;
    }

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
    setReceivedDZD(0);
    setCart(clearCart());
    setIsConfirmingSale(false);
    await refreshLocalSales();
  }

  async function syncNow(): Promise<void> {
    const syncLoop = startOutboxSyncLoop({
      repositories,
      api: remoteSyncApi,
      runImmediately: false,
      async onStateChange(snapshot) {
        setSyncSnapshot(snapshot);
        await refreshLocalSales();
      },
    });

    await syncLoop.flushNow();
    syncLoop.stop();
  }

  function appendCashDigit(digit: string): void {
    setReceivedDZD((currentValue) => Number(`${currentValue === 0 ? "" : currentValue}${digit}`));
  }

  function backspaceCashDigit(): void {
    setReceivedDZD((currentValue) => Math.floor(currentValue / 10));
  }

  function addQuickCash(amountDZD: number): void {
    setReceivedDZD((currentValue) => currentValue + amountDZD);
  }

  function resetCart(): void {
    setCart(clearCart());
    setReceivedDZD(0);
    setIsConfirmingSale(false);
  }

  return (
    <main className="pos-shell">
      <section className="catalog-panel" aria-labelledby="catalog-heading">
        <header>
          <p className="eyebrow">Single branch · Cash only · Offline first</p>
          <h1 id="catalog-heading">Fast Food POS</h1>
        </header>

        <div className="catalog-toolbar">
          <label>
            Search products
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Burger, cola, SKU..."
            />
          </label>
          <div className="category-filters" aria-label="Product categories">
            <button
              className={selectedCategoryId === allCategories ? "selected" : ""}
              type="button"
              onClick={() => setSelectedCategoryId(allCategories)}
            >
              All
            </button>
            {seedCategories
              .filter((category) => category.isActive)
              .map((category) => (
                <button
                  className={selectedCategoryId === category.id ? "selected" : ""}
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategoryId(category.id)}
                >
                  {category.name}
                </button>
              ))}
          </div>
        </div>

        {filteredProducts.length === 0 ? (
          <p className="empty-state light">No active products match this filter.</p>
        ) : (
          <div className="product-grid">
            {filteredProducts.map((product) => (
              <button
                className="product-card"
                key={product.id}
                type="button"
                onClick={() => {
                  setCart((currentCart) => addProductToCart(currentCart, product));
                  setIsConfirmingSale(false);
                }}
              >
                <span>{product.name}</span>
                <small>{product.sku}</small>
                <strong>{product.priceDZD} DZD</strong>
              </button>
            ))}
          </div>
        )}

        <section className="recent-sales" aria-labelledby="recent-sales-heading">
          <div className="section-title-row">
            <h2 id="recent-sales-heading">Recent local sales</h2>
            <span>
              {salesSnapshot.pendingSyncCount} pending sync · {localStoreTarget.description}
            </span>
          </div>
          {salesSnapshot.recentSales.length === 0 ? (
            <p className="empty-state light">No local sales yet.</p>
          ) : (
            <ul>
              {salesSnapshot.recentSales.map((sale) => (
                <li key={sale.order.id}>
                  <strong>
                    {sale.receipt?.receiptNumber ?? `Sale ${sale.order.localSequence}`}
                  </strong>
                  <span>{sale.receipt?.totalDZD ?? sale.order.totalDZD} DZD</span>
                  <small>
                    {sale.order.status} · {formatSaleTimestamp(sale.order.createdAt)} ·{" "}
                    {sale.pendingSyncCount} pending
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`sync-panel ${syncSnapshot.status.toLowerCase()}`} aria-live="polite">
          <div>
            <strong>Sync status: {syncSnapshot.status}</strong>
            <span>
              {syncSnapshot.pendingCount} pending · {syncSnapshot.failedEventCount} failed
            </span>
          </div>
          <small>
            Last attempt: {syncSnapshot.lastAttemptAt ?? "not yet"}
            {syncSnapshot.lastError ? ` · ${syncSnapshot.lastError}` : ""}
          </small>
          <button
            disabled={syncSnapshot.status === "SYNCING" || salesSnapshot.pendingSyncCount === 0}
            type="button"
            onClick={() => void syncNow()}
          >
            Sync now
          </button>
        </section>
      </section>

      <aside className="checkout-panel" aria-labelledby="cart-heading">
        <div className="section-title-row inverted">
          <h2 id="cart-heading">Cart</h2>
          <button disabled={cart.lines.length === 0} type="button" onClick={resetCart}>
            Clear
          </button>
        </div>
        {cart.lines.length === 0 ? (
          <p className="empty-state">Add products to start a sale.</p>
        ) : (
          <ul className="cart-lines">
            {cart.lines.map((line) => (
              <li key={line.product.id}>
                <div>
                  <strong>{line.product.name}</strong>
                  <span>
                    {line.quantity} × {line.product.priceDZD} DZD ={" "}
                    {line.quantity * line.product.priceDZD} DZD
                  </span>
                </div>
                <div className="line-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setCart((currentCart) => decrementCartLine(currentCart, line.product.id));
                      setIsConfirmingSale(false);
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCart((currentCart) => addProductToCart(currentCart, line.product));
                      setIsConfirmingSale(false);
                    }}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCart((currentCart) => removeCartLine(currentCart, line.product.id));
                      setIsConfirmingSale(false);
                    }}
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
            onChange={(event) => {
              setReceivedDZD(Number(event.target.value));
              setIsConfirmingSale(false);
            }}
          />
        </label>

        <div className="quick-cash-actions" aria-label="Quick cash buttons">
          <button type="button" onClick={() => setReceivedDZD(summary.totalDZD)}>
            Exact
          </button>
          <button type="button" onClick={() => addQuickCash(100)}>
            +100
          </button>
          <button type="button" onClick={() => addQuickCash(200)}>
            +200
          </button>
          <button type="button" onClick={() => addQuickCash(500)}>
            +500
          </button>
        </div>

        <div className="numeric-keypad" aria-label="Numeric keypad">
          {cashDigits.map((digit) => (
            <button key={digit} type="button" onClick={() => appendCashDigit(digit)}>
              {digit}
            </button>
          ))}
          <button type="button" onClick={backspaceCashDigit}>
            ⌫
          </button>
          <button type="button" onClick={() => setReceivedDZD(0)}>
            C
          </button>
        </div>

        <section className={`change-box ${checkout.status.toLowerCase()}`} aria-live="polite">
          <span>{checkout.message}</span>
          <strong>Change: {checkout.changeDZD} DZD</strong>
        </section>

        <section className="receipt-preview" aria-label="Receipt preview">
          <h3>Receipt preview</h3>
          <p>{receiptNumberPreview}</p>
          {cart.lines.length === 0 ? (
            <span>No items yet.</span>
          ) : (
            <ul>
              {cart.lines.map((line) => (
                <li key={line.product.id}>
                  <span>
                    {line.quantity} × {line.product.name}
                  </span>
                  <strong>{line.quantity * line.product.priceDZD} DZD</strong>
                </li>
              ))}
            </ul>
          )}
          <div>
            <span>Total</span>
            <strong>{summary.totalDZD} DZD</strong>
          </div>
          <div>
            <span>Cash received</span>
            <strong>{receivedDZD} DZD</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{isConfirmingSale ? "Confirm local save" : checkout.status}</strong>
          </div>
        </section>

        <button
          className="finalize-button"
          disabled={!checkout.canFinalize}
          type="button"
          onClick={() => void finalizeSale()}
        >
          {isConfirmingSale ? "Confirm local cash sale" : "Review and finalize"}
        </button>

        <p className="sale-status">{saleStatus}</p>
        {salesSnapshot.failedSyncCount > 0 ? (
          <p className="sale-status warning">
            {salesSnapshot.failedSyncCount} failed sync events need retry.
          </p>
        ) : null}
      </aside>
    </main>
  );
}

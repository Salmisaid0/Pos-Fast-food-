import { createBrowserLocalSaleRepositories } from "./local-browser-storage";
import type { LocalSaleRepositories } from "./local-sale";
import { resolveLocalStoreTarget, type LocalStoreTarget } from "./local-store-runtime";

export function createDefaultLocalSaleRepositories(
  target: LocalStoreTarget = resolveLocalStoreTarget()
): LocalSaleRepositories {
  if (target.driver !== "browser-local-storage") {
    throw new Error(`${target.driver} requires a runtime-specific repository factory`);
  }

  return createBrowserLocalSaleRepositories(globalThis.localStorage, target.key);
}

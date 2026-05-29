import { createBrowserLocalSaleRepositories } from "./local-browser-storage";
import type { LocalSaleRepositories } from "./local-sale";

export function createDefaultLocalSaleRepositories(): LocalSaleRepositories {
  return createBrowserLocalSaleRepositories();
}

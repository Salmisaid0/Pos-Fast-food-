import { DEFAULT_BROWSER_LOCAL_SALE_STORE_KEY } from "./local-browser-storage";

export type LocalStoreDriver = "browser-local-storage" | "node-json" | "tauri-json";

export type LocalStoreTarget =
  | {
      driver: "browser-local-storage";
      key: string;
      description: string;
    }
  | {
      driver: "node-json";
      filePath: string;
      description: string;
    }
  | {
      driver: "tauri-json";
      filePath: string;
      description: string;
    };

export interface LocalStoreRuntimeEnv {
  POS_BROWSER_LOCAL_STORE_KEY?: string | undefined;
  POS_LOCAL_STORE_PATH?: string | undefined;
  POS_TAURI_LOCAL_STORE_PATH?: string | undefined;
}

export function resolveLocalStoreTarget(env: LocalStoreRuntimeEnv = {}): LocalStoreTarget {
  if (env.POS_TAURI_LOCAL_STORE_PATH) {
    return {
      driver: "tauri-json",
      filePath: env.POS_TAURI_LOCAL_STORE_PATH,
      description: "Future Tauri app-data JSON store",
    };
  }

  if (env.POS_LOCAL_STORE_PATH) {
    return {
      driver: "node-json",
      filePath: env.POS_LOCAL_STORE_PATH,
      description: "Node/Vite development JSON store",
    };
  }

  return {
    driver: "browser-local-storage",
    key: env.POS_BROWSER_LOCAL_STORE_KEY ?? DEFAULT_BROWSER_LOCAL_SALE_STORE_KEY,
    description: "Browser localStorage store",
  };
}

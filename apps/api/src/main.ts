import "reflect-metadata";

import { NestFactory } from "@nestjs/core";

import { FileSyncIngestionRepository } from "./file-sync-ingestion-repository";
import { NestSyncModule } from "./sync-nest.controller";

export interface ApiRuntimeConfig {
  port: number;
  host?: string;
  syncStorePath?: string;
}

export function readApiRuntimeConfig(
  env: Record<string, string | undefined> = process.env
): ApiRuntimeConfig {
  const config: ApiRuntimeConfig = {
    port: readPort(env.API_PORT ?? env.PORT, 3000),
  };

  if (env.API_HOST) config.host = env.API_HOST;
  if (env.API_SYNC_STORE_PATH) config.syncStorePath = env.API_SYNC_STORE_PATH;
  return config;
}

export async function bootstrapApi(
  config: ApiRuntimeConfig = readApiRuntimeConfig()
): Promise<void> {
  const syncModule = config.syncStorePath
    ? NestSyncModule.register({ repository: new FileSyncIngestionRepository(config.syncStorePath) })
    : NestSyncModule.register();
  const app = await NestFactory.create(syncModule);
  if (config.host) {
    await app.listen(config.port, config.host);
  } else {
    await app.listen(config.port);
  }
}

if (require.main === module) {
  void bootstrapApi();
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid API port: ${value}`);
  }

  return port;
}

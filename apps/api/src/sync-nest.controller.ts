import "reflect-metadata";

import { Body, Controller, Inject, Module, Optional, Post } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";
import type { SyncEvent } from "@packages/shared-types";

import {
  InMemorySyncIngestionRepository,
  type SyncIngestionRepository,
  type SyncIngestionSideEffects,
} from "./sync";
import {
  SyncController,
  type SyncBatchIngestionResponse,
  type SyncIngestionResponse,
} from "./sync-controller";

export const SYNC_INGESTION_REPOSITORY = "SYNC_INGESTION_REPOSITORY";
export const SYNC_INGESTION_SIDE_EFFECTS = "SYNC_INGESTION_SIDE_EFFECTS";

@Controller("sync")
export class NestSyncController {
  private readonly syncController: SyncController;

  constructor(
    @Inject(SYNC_INGESTION_REPOSITORY)
    repository: SyncIngestionRepository,
    @Optional()
    @Inject(SYNC_INGESTION_SIDE_EFFECTS)
    sideEffects?: SyncIngestionSideEffects
  ) {
    this.syncController = new SyncController(repository, sideEffects);
  }

  @Post("events")
  async ingestOne(@Body() event: SyncEvent): Promise<SyncIngestionResponse> {
    return this.syncController.ingestOne(event);
  }

  @Post("events/batch")
  async ingestBatch(@Body() events: SyncEvent[]): Promise<SyncBatchIngestionResponse> {
    return this.syncController.ingestBatch(events);
  }
}

export interface NestSyncModuleOptions {
  repository?: SyncIngestionRepository;
  sideEffects?: SyncIngestionSideEffects;
}

@Module({})
export class NestSyncModule {
  static register(options: NestSyncModuleOptions = {}): DynamicModule {
    return {
      module: NestSyncModule,
      controllers: [NestSyncController],
      providers: [
        {
          provide: SYNC_INGESTION_REPOSITORY,
          useValue: options.repository ?? new InMemorySyncIngestionRepository(),
        },
        ...(options.sideEffects
          ? [
              {
                provide: SYNC_INGESTION_SIDE_EFFECTS,
                useValue: options.sideEffects,
              },
            ]
          : []),
      ],
      exports: [SYNC_INGESTION_REPOSITORY],
    };
  }
}

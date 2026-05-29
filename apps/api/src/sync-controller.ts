import type { SyncEvent } from "@packages/shared-types";

import {
  ingestSyncEvent,
  ingestSyncEvents,
  InMemorySyncIngestionRepository,
  type SyncEventAcceptance,
  type SyncIngestionRepository,
  type SyncIngestionSideEffects,
} from "./sync";

export interface SyncIngestionResponse {
  accepted: boolean;
  reason?: string;
}

export interface SyncBatchIngestionResponse {
  results: SyncIngestionResponse[];
  acceptedCount: number;
  rejectedCount: number;
}

export class SyncController {
  constructor(
    private readonly repository: SyncIngestionRepository,
    private readonly sideEffects?: SyncIngestionSideEffects
  ) {}

  async ingestOne(event: SyncEvent): Promise<SyncIngestionResponse> {
    return toResponse(await ingestSyncEvent(event, this.repository, this.sideEffects));
  }

  async ingestBatch(events: SyncEvent[]): Promise<SyncBatchIngestionResponse> {
    const results = await ingestSyncEvents(events, this.repository, this.sideEffects);
    const responses = results.map(toResponse);
    return {
      results: responses,
      acceptedCount: responses.filter((response) => response.accepted).length,
      rejectedCount: responses.filter((response) => !response.accepted).length,
    };
  }
}

export interface SyncModuleOptions {
  repository?: SyncIngestionRepository;
  sideEffects?: SyncIngestionSideEffects;
}

export interface SyncModule {
  repository: SyncIngestionRepository;
  controller: SyncController;
}

export function createSyncModule(options: SyncModuleOptions = {}): SyncModule {
  const repository = options.repository ?? new InMemorySyncIngestionRepository();
  return {
    repository,
    controller: new SyncController(repository, options.sideEffects),
  };
}

function toResponse(acceptance: SyncEventAcceptance): SyncIngestionResponse {
  return acceptance.accepted
    ? { accepted: true }
    : { accepted: false, reason: acceptance.reason ?? "unknown_rejection" };
}

import { createPrintWorkerRuntime, readPrintWorkerRuntimeConfig } from "./worker-runtime-config";

export function bootstrapPrintWorker(): void {
  const config = readPrintWorkerRuntimeConfig();
  const runtime = createPrintWorkerRuntime(config);
  runtime.loop.start();
}

if (require.main === module) {
  bootstrapPrintWorker();
}

import { PrinterJob } from "../../../packages/shared-types/src";

export async function processPrintJob(job: PrinterJob): Promise<{ ok: true; jobId: string }> {
  // Server-side queue worker only. Client must never print directly.
  // Future implementation: open TCP socket to printerIp:9100 and send ESC/POS payload.
  void job;
  return { ok: true, jobId: job.id };
}

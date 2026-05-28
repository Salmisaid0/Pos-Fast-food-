export interface PrintJob {
  id: string;
  targetIp: string;
  payload: string;
}

export async function processPrintJob(job: PrintJob): Promise<{ ok: true; jobId: string }> {
  // Placeholder for ESC/POS over TCP:9100 implementation.
  // This initial implementation is intentionally minimal to start the execution phase.
  return { ok: true, jobId: job.id };
}

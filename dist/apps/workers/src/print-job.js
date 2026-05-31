"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processPrintJob = processPrintJob;
async function processPrintJob(job) {
    // Server-side queue worker only. Client must never print directly.
    // Future implementation: open TCP socket to printerIp:9100 and send ESC/POS payload.
    void job;
    return { ok: true, jobId: job.id };
}

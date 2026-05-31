"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VAT_RATE_RESTAURATION = exports.FISCAL_ENGINE_VERSION = void 0;
exports.calculateReceipt = calculateReceipt;
exports.FISCAL_ENGINE_VERSION = "v1";
exports.VAT_RATE_RESTAURATION = 0.09;
function round2(value) {
    return Math.round(value * 100) / 100;
}
function calculateReceipt(orderId, subtotalDZD, generatedAt = new Date().toISOString()) {
    const vatAmountDZD = round2(subtotalDZD * exports.VAT_RATE_RESTAURATION);
    const totalDZD = round2(subtotalDZD + vatAmountDZD);
    return {
        orderId,
        fiscalVersion: exports.FISCAL_ENGINE_VERSION,
        subtotalDZD: round2(subtotalDZD),
        vatRate: exports.VAT_RATE_RESTAURATION,
        vatAmountDZD,
        totalDZD,
        generatedAt,
    };
}

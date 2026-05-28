"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateCashPayment = calculateCashPayment;
function calculateCashPayment(orderId, totalDZD, receivedDZD, paidAt = new Date().toISOString()) {
    if (receivedDZD < totalDZD) {
        throw new Error("Received cash is less than order total.");
    }
    return {
        orderId,
        method: "CASH",
        receivedDZD,
        totalDZD,
        changeDZD: Math.round((receivedDZD - totalDZD) * 100) / 100,
        paidAt,
    };
}

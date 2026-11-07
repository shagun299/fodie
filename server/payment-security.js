"use strict";

const crypto = require("crypto");

/**
 * Verify the checkout callback signature using the server-only Razorpay secret.
 * Never trust payment IDs or a browser callback without this verification.
 */
function verifyRazorpayCheckoutSignature(orderId, paymentId, signature, secret) {
  const order = String(orderId || "").trim();
  const payment = String(paymentId || "").trim();
  const supplied = String(signature || "").trim();
  const key = String(secret || "");
  if (!order || !payment || !key || !/^[a-f0-9]{64}$/i.test(supplied)) return false;

  const expected = crypto.createHmac("sha256", key).update(order + "|" + payment).digest();
  const received = Buffer.from(supplied, "hex");
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

/**
 * Check the provider's payment resource against the exact local order.
 * Amounts are compared in integer paise and the accepted currency is INR.
 */
function matchesRazorpayPayment(payment, order) {
  if (!payment || !order || !order.gateway_order_id) return false;
  const amount = Number(payment.amount);
  const total = Number(order.total);
  if (!Number.isSafeInteger(amount) || !Number.isFinite(total) || total <= 0) return false;
  return String(payment.order_id || "") === String(order.gateway_order_id) &&
    amount === Math.round(total * 100) &&
    String(payment.currency || "").toUpperCase() === "INR";
}

module.exports = {
  verifyRazorpayCheckoutSignature,
  matchesRazorpayPayment
};

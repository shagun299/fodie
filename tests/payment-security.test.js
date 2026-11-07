"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  verifyRazorpayCheckoutSignature,
  matchesRazorpayPayment
} = require("../server/payment-security");

test("Razorpay checkout signature accepts the exact order and payment pair", () => {
  const secret = "test_only_razorpay_secret";
  const orderId = "order_test_123";
  const paymentId = "pay_test_456";
  const signature = crypto.createHmac("sha256", secret)
    .update(orderId + "|" + paymentId)
    .digest("hex");

  assert.equal(verifyRazorpayCheckoutSignature(orderId, paymentId, signature, secret), true);
  assert.equal(verifyRazorpayCheckoutSignature(orderId, paymentId, signature.toUpperCase(), secret), true);
});

test("Razorpay checkout signature rejects changed IDs, malformed input and missing secrets", () => {
  const secret = "test_only_razorpay_secret";
  const signature = crypto.createHmac("sha256", secret)
    .update("order_test_123|pay_test_456")
    .digest("hex");

  assert.equal(verifyRazorpayCheckoutSignature("order_other", "pay_test_456", signature, secret), false);
  assert.equal(verifyRazorpayCheckoutSignature("order_test_123", "pay_other", signature, secret), false);
  assert.equal(verifyRazorpayCheckoutSignature("order_test_123", "pay_test_456", "not-a-signature", secret), false);
  assert.equal(verifyRazorpayCheckoutSignature("order_test_123", "pay_test_456", signature, ""), false);
});

test("provider payment must match exact gateway order, integer paise and INR currency", () => {
  const order = { gateway_order_id: "order_test_123", total: 349.5 };
  const payment = { order_id: "order_test_123", amount: 34950, currency: "INR", status: "captured" };

  assert.equal(matchesRazorpayPayment(payment, order), true);
  assert.equal(matchesRazorpayPayment({ ...payment, order_id: "order_other" }, order), false);
  assert.equal(matchesRazorpayPayment({ ...payment, amount: 34949 }, order), false);
  assert.equal(matchesRazorpayPayment({ ...payment, currency: "USD" }, order), false);
  assert.equal(matchesRazorpayPayment({ ...payment, amount: 34950.5 }, order), false);
  assert.equal(matchesRazorpayPayment(payment, { ...order, gateway_order_id: null }), false);
  assert.equal(matchesRazorpayPayment(payment, { ...order, total: Infinity }), false);
});

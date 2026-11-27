"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Database = require("better-sqlite3");
const createProductionBackend = require("../server/production");

async function fixture(t) {
  const old = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    NODE_ENV: process.env.NODE_ENV
  };
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = "foodiehub-test-secret-with-more-than-32-characters";
  process.env.ADMIN_EMAIL = "admin@example.test";
  process.env.ADMIN_PASSWORD_HASH = await createProductionBackend.hashPassword("FoodieHubTestPass123!");
  const app = express();
  app.use(express.json());
  const db = new Database(":memory:");
  db.exec("CREATE TABLE orders (order_number TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', payment_status TEXT NOT NULL DEFAULT 'pending', items_json TEXT NOT NULL DEFAULT '[]'); CREATE TABLE subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);");
  const menu = [{ id: "test-bowl", name: "Test Bowl", category: "Bowls", price: 200, originalPrice: 250, isVeg: true, description: "Test item", prepTime: 15, tags: [] }];
  const productById = new Map(menu.map(item => [item.id, item]));
  let backend;
  const adminGuard = (req, res, next) => {
    const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (backend && backend.verifyAdminToken(token)) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };
  backend = createProductionBackend({ app, db, menu, productById, requireAdmin: adminGuard, razorpayRequest: async () => ({}) });
  const server = await new Promise(resolve => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const base = "http://127.0.0.1:" + server.address().port;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return { base, db, backend };
}

async function post(base, route, body, token) {
  return fetch(base + route, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body)
  });
}

test("customer registration creates a signed session and protected profile", async t => {
  const { base } = await fixture(t);
  const created = await post(base, "/api/auth/register", {
    name: "Test Customer", email: "customer@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  assert.equal(created.status, 201);
  const account = await created.json();
  assert.ok(account.token);
  assert.equal(account.user.email, "customer@example.test");
  const profile = await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + account.token } });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.name, "Test Customer");
  const rejected = await fetch(base + "/api/auth/me");
  assert.equal(rejected.status, 401);
});

test("customer password change revokes existing sessions and issues a fresh session", async t => {
  const { base } = await fixture(t);
  const created = await post(base, "/api/auth/register", {
    name: "Password Test", email: "password@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  const account = await created.json();
  const changed = await post(base, "/api/auth/password", {
    currentPassword: "CustomerTestPass123!", newPassword: "NewCustomerPass456!"
  }, account.token);
  assert.equal(changed.status, 200);
  const next = await changed.json();
  assert.ok(next.token);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + next.token } })).status, 200);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + account.token } })).status, 401);
  const login = await post(base, "/api/auth/login", { email: "password@example.test", password: "NewCustomerPass456!" });
  assert.equal(login.status, 200);
});

test("admin login issues a session accepted by protected inventory API", async t => {
  const { base } = await fixture(t);
  const login = await post(base, "/api/admin/auth/login", { email: "admin@example.test", password: "FoodieHubTestPass123!" });
  assert.equal(login.status, 200);
  const session = await login.json();
  assert.equal(session.role, "admin");
  const inventory = await fetch(base + "/api/admin/inventory", { headers: { Authorization: "Bearer " + session.token } });
  assert.equal(inventory.status, 200);
  assert.equal((await inventory.json()).inventory[0].productId, "test-bowl");
});

test("coupon validation is database-backed and usage can be released", async t => {
  const { backend, db } = await fixture(t);
  assert.equal(backend.calculateCoupon("FOOD25", 300).discount, 75);
  assert.throws(() => backend.calculateCoupon("FOOD25", 200), /minimum subtotal/i);
  backend.claimCoupon("FOOD25", "FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
  backend.releaseCoupon("FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});

test("inventory is reserved atomically and restored on cancellation", async t => {
  const { backend, db } = await fixture(t);
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  backend.reserveInventory("FH-STOCK-TEST", [{ productId: "test-bowl", quantity: 2 }], null);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  backend.releaseInventory("FH-STOCK-TEST");
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 5);
});

test("JWT tokens reject a modified signature", async () => {
  const secret = "this-is-a-long-test-signing-secret";
  const token = createProductionBackend.signToken({ sub: "user-1", role: "customer", exp: Math.floor(Date.now() / 1000) + 60 }, secret);
  assert.equal(createProductionBackend.verifyToken(token, secret).sub, "user-1");
  const changed = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
  assert.equal(createProductionBackend.verifyToken(changed, secret), null);
});

test("logout-all revokes every active customer session", async t => {
  const { base, db } = await fixture(t);
  const created = await post(base, "/api/auth/register", {
    name: "Sessions Test", email: "sessions@example.test", phone: "9876543210", password: "CustomerTestPass123!"
  });
  const account = await created.json();
  const second = await post(base, "/api/auth/login", { email: "sessions@example.test", password: "CustomerTestPass123!" });
  const secondSession = await second.json();
  const response = await post(base, "/api/auth/logout-all", {}, account.token);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.sessionsRevoked, 2);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + account.token } })).status, 401);
  assert.equal((await fetch(base + "/api/auth/me", { headers: { Authorization: "Bearer " + secondSession.token } })).status, 401);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM auth_sessions WHERE subject_id = ? AND revoked_at IS NULL").get(account.user.id).count, 0);
});

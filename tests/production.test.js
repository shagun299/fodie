"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const Database = require("better-sqlite3");
const createProductionBackend = require("../server/production");

async function fixture(t, options = {}) {
  const old = {
    JWT_SECRET: process.env.JWT_SECRET,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL,
    ADMIN_PASSWORD_HASH: process.env.ADMIN_PASSWORD_HASH,
    NODE_ENV: process.env.NODE_ENV,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID
  };
  process.env.NODE_ENV = "test";
  process.env.FIREBASE_PROJECT_ID = "foodiehub-test";
  process.env.JWT_SECRET = "foodiehub-test-secret-with-more-than-32-characters";
  process.env.ADMIN_EMAIL = "admin@example.test";
  process.env.ADMIN_PASSWORD_HASH = await createProductionBackend.hashPassword("FoodieHubTestPass123!");
  const app = express();
  app.use(express.json());
  const db = new Database(":memory:");
  db.exec("CREATE TABLE orders (order_number TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed', payment_status TEXT NOT NULL DEFAULT 'pending', items_json TEXT NOT NULL DEFAULT '[]'); CREATE TABLE subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL); ALTER TABLE orders ADD COLUMN subtotal REAL; ALTER TABLE orders ADD COLUMN coupon_code TEXT; ALTER TABLE orders ADD COLUMN coupon_discount REAL; ALTER TABLE orders ADD COLUMN delivery_fee REAL; ALTER TABLE orders ADD COLUMN tax REAL; ALTER TABLE orders ADD COLUMN total REAL; ALTER TABLE orders ADD COLUMN payment_method TEXT;");
  const menu = [{ id: "test-bowl", name: "Test Bowl", category: "Bowls", price: 200, originalPrice: 250, isVeg: true, description: "Test item", prepTime: 15, tags: [] }];
  const productById = new Map(menu.map(item => [item.id, item]));
  let backend;
  const adminGuard = async (req, res, next) => {
    const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
    try {
      if (backend && await backend.verifyAdminToken(token)) return next();
      return res.status(401).json({ error: "Unauthorized" });
    } catch (error) { return next(error); }
  };
  backend = await createProductionBackend({ app, db, menu, productById, requireAdmin: adminGuard, razorpayRequest: async () => ({}), fetchFirebaseCertificates: options.fetchFirebaseCertificates });
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
  assert.equal((await backend.calculateCoupon("FOOD25", 300)).discount, 75);
  await assert.rejects(() => backend.calculateCoupon("FOOD25", 200), /minimum subtotal/i);
  await backend.claimCoupon("FOOD25", "FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 1);
  await backend.releaseCoupon("FH-COUPON-TEST");
  assert.equal(db.prepare("SELECT used_count FROM coupons WHERE code = 'FOOD25'").get().used_count, 0);
});

test("inventory is reserved atomically and restored on cancellation", async t => {
  const { backend, db } = await fixture(t);
  db.prepare("UPDATE inventory SET quantity = 5 WHERE product_id = 'test-bowl'").run();
  await backend.reserveInventory("FH-STOCK-TEST", [{ productId: "test-bowl", quantity: 2 }], null);
  assert.equal(db.prepare("SELECT quantity FROM inventory WHERE product_id = 'test-bowl'").get().quantity, 3);
  await backend.releaseInventory("FH-STOCK-TEST");
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

test("live API integration: registered customer can save an address, place COD order, track it and use admin order controls", async t => {
  const { spawn } = require("node:child_process");
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const net = require("node:net");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foodiehub-integration-"));
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const selectedPort = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(selectedPort));
    });
  });
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      DATA_DIR: dataDir,
      ALLOWED_ORIGINS: "",
      JWT_SECRET: "foodiehub-integration-test-secret-with-over-32-characters",
      ADMIN_API_KEY: "foodiehub-integration-admin-key-for-tests"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let startupOutput = "";
  child.stdout.on("data", chunk => { startupOutput = (startupOutput + chunk.toString()).slice(-6000); });
  child.stderr.on("data", chunk => { startupOutput = (startupOutput + chunk.toString()).slice(-6000); });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once("exit", resolve));
      child.kill("SIGTERM");
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const base = "http://127.0.0.1:" + port;
  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch(base + "/api/health");
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(healthy, true, "API did not start successfully. " + startupOutput);

  const send = (route, body, token, headers = {}) => fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...headers
    },
    body: JSON.stringify(body)
  });

  const unique = require("node:crypto").randomUUID().replace(/-/g, "");
  const email = "cod-qa-" + unique + "@example.test";
  const phone = "9876543210";
  const registered = await send("/api/auth/register", {
    name: "COD QA Customer",
    email,
    phone,
    password: "CodQaCustomerPass123!"
  });
  assert.equal(registered.status, 201);
  const account = await registered.json();
  assert.ok(account.token);

  const profile = await fetch(base + "/api/auth/me", {
    headers: { Authorization: "Bearer " + account.token }
  });
  assert.equal(profile.status, 200);
  assert.equal((await profile.json()).user.email, email);

  const address = {
    house: "12A",
    building: "",
    street: "QA Street",
    area: "Test Colony",
    landmark: "",
    city: "Meerut",
    pincode: "250001"
  };
  const savedAddress = await send("/api/auth/addresses", { label: "Home", address }, account.token);
  assert.equal(savedAddress.status, 201);
  const addressList = await fetch(base + "/api/auth/addresses", {
    headers: { Authorization: "Bearer " + account.token }
  });
  assert.equal(addressList.status, 200);
  assert.equal((await addressList.json()).addresses.length, 1);

  const menuResponse = await fetch(base + "/api/menu");
  assert.equal(menuResponse.status, 200);
  const menu = await menuResponse.json();
  assert.ok(menu.items.length > 0);
  const payload = {
    customer: { name: "COD QA Customer", email, phone, addressDetails: address },
    items: [{ productId: menu.items[0].id, quantity: 1, customizations: {} }],
    couponCode: "",
    paymentMethod: "cod"
  };
  const idempotencyKey = unique.slice(0, 32);
  const createdOrder = await send("/api/orders", payload, account.token, { "Idempotency-Key": idempotencyKey });
  assert.equal(createdOrder.status, 201);
  const order = await createdOrder.json();
  assert.ok(order.orderNumber);
  assert.equal(order.status, "confirmed");
  assert.equal(order.paymentMethod, "cod");

  const repeatedOrder = await send("/api/orders", payload, account.token, { "Idempotency-Key": idempotencyKey });
  assert.equal(repeatedOrder.status, 200);
  assert.equal((await repeatedOrder.json()).orderNumber, order.orderNumber);

  const history = await fetch(base + "/api/auth/orders", {
    headers: { Authorization: "Bearer " + account.token }
  });
  assert.equal(history.status, 200);
  const historyData = await history.json();
  assert.equal(historyData.count, 1);
  assert.equal(historyData.orders[0].orderNumber, order.orderNumber);

  const tracking = await fetch(base + "/api/orders/track?order=" + encodeURIComponent(order.orderNumber) + "&phone=" + phone);
  assert.equal(tracking.status, 200);
  assert.equal((await tracking.json()).orderNumber, order.orderNumber);

  const adminHeaders = { Authorization: "Bearer foodiehub-integration-admin-key-for-tests" };
  const adminOrders = await fetch(base + "/api/admin/orders", { headers: adminHeaders });
  assert.equal(adminOrders.status, 200);
  assert.equal((await adminOrders.json()).count, 1);

  const changeStatus = (status) => fetch(base + "/api/admin/orders/" + encodeURIComponent(order.orderNumber), {
    method: "PATCH",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({ status })
  });
  assert.equal((await changeStatus("delivered")).status, 409);
  assert.equal((await changeStatus("preparing")).status, 200);
  assert.equal((await changeStatus("out_for_delivery")).status, 200);
  assert.equal((await changeStatus("delivered")).status, 200);
});

function makeFirebaseTestToken(privateKey, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT", kid: "foodiehub-test-key" };
  const claims = {
    iss: "https://securetoken.google.com/foodiehub-test",
    aud: "foodiehub-test",
    auth_time: now,
    sub: "firebase-customer-123",
    iat: now,
    exp: now + 3600,
    email: "firebase@example.test",
    email_verified: true,
    name: "Firebase Customer",
    phone_number: "+919876543210",
    ...overrides
  };
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = encode(header) + "." + encode(claims);
  return input + "." + crypto.sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url");
}

test("Firebase ID token verifier validates signature, issuer, audience and expiry", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const certificate = publicKey.export({ type: "spki", format: "pem" });
  const certificates = { "foodiehub-test-key": certificate };
  const valid = makeFirebaseTestToken(privateKey);
  const expired = makeFirebaseTestToken(privateKey, { exp: Math.floor(Date.now() / 1000) - 1 });
  const wrongAudience = makeFirebaseTestToken(privateKey, { aud: "another-project" });
  const validClaims = createProductionBackend.verifyFirebaseIdToken(valid, "foodiehub-test", certificates);

  assert.equal(validClaims.sub, "firebase-customer-123");
  assert.equal(createProductionBackend.verifyFirebaseIdToken(valid, "another-project", certificates), null);
  assert.equal(createProductionBackend.verifyFirebaseIdToken(expired, "foodiehub-test", certificates), null);
  assert.equal(createProductionBackend.verifyFirebaseIdToken(wrongAudience, "foodiehub-test", certificates), null);
  const tokenParts = valid.split(".");
  const signature = tokenParts[2];
  tokenParts[2] = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.equal(createProductionBackend.verifyFirebaseIdToken(tokenParts.join("."), "foodiehub-test", certificates), null);
});

test("Firebase customer token unlocks account profile and only that UID's order history", async t => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const certificate = publicKey.export({ type: "spki", format: "pem" });
  const { base, db } = await fixture(t, {
    fetchFirebaseCertificates: async () => ({
      ok: true,
      headers: { get: () => "public, max-age=3600" },
      json: async () => ({ "foodiehub-test-key": certificate })
    })
  });
  const token = makeFirebaseTestToken(privateKey);
  const headers = { Authorization: "Bearer " + token };
  const profile = await fetch(base + "/api/auth/me", { headers });
  assert.equal(profile.status, 200);
  const profileData = await profile.json();
  assert.equal(profileData.user.id, "firebase-customer-123");
  assert.equal(profileData.user.email, "firebase@example.test");

  db.prepare("INSERT INTO orders (order_number, created_at, user_id, total) VALUES (?, ?, ?, ?)")
    .run("FH-FIREBASE-ORDER", new Date().toISOString(), "firebase-customer-123", 249);
  db.prepare("INSERT INTO orders (order_number, created_at, user_id, total) VALUES (?, ?, ?, ?)")
    .run("FH-OTHER-ORDER", new Date().toISOString(), "another-customer", 199);
  const history = await fetch(base + "/api/auth/orders", { headers });
  assert.equal(history.status, 200);
  const result = await history.json();
  assert.equal(result.count, 1);
  assert.equal(result.orders[0].orderNumber, "FH-FIREBASE-ORDER");
});

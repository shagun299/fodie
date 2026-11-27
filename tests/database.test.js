"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compilePostgres } = require("../server/database");

test("PostgreSQL adapter converts positional SQLite placeholders", () => {
  const compiled = compilePostgres(
    "SELECT * FROM orders WHERE order_number = ? AND status = ?",
    ["FH-123", "confirmed"]
  );
  assert.equal(compiled.text, "SELECT * FROM orders WHERE order_number = $1 AND status = $2");
  assert.deepEqual(compiled.params, ["FH-123", "confirmed"]);
});

test("PostgreSQL adapter binds named parameters and reuses repeated names", () => {
  const compiled = compilePostgres(
    "INSERT INTO orders (order_number, customer_name) VALUES (@orderNumber, @customerName) RETURNING order_number",
    { orderNumber: "FH-123", customerName: "Test Customer" }
  );
  assert.equal(
    compiled.text,
    "INSERT INTO orders (order_number, customer_name) VALUES ($1, $2) RETURNING order_number"
  );
  assert.deepEqual(compiled.params, ["FH-123", "Test Customer"]);
});

test("PostgreSQL adapter translates SQLite ignore inserts", () => {
  const compiled = compilePostgres(
    "INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)",
    ["test@example.test", "2026-11-27T00:00:00.000Z"]
  );
  assert.equal(
    compiled.text,
    "INSERT INTO subscribers (email, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING"
  );
  assert.deepEqual(compiled.params, ["test@example.test", "2026-11-27T00:00:00.000Z"]);
});

test("PostgreSQL adapter preserves explicit conflict handling and converts scalar MAX", () => {
  const compiled = compilePostgres(
    "INSERT OR IGNORE INTO menu_catalog (product_id, data_json) VALUES (?, ?) ON CONFLICT(product_id) DO UPDATE SET data_json = excluded.data_json",
    ["item-1", "{}"]
  );
  assert.match(compiled.text, /ON CONFLICT\(product_id\) DO UPDATE/);
  assert.equal((compiled.text.match(/ON CONFLICT/gi) || []).length, 1);

  const update = compilePostgres(
    "UPDATE coupons SET used_count = MAX(0, used_count - ?), updated_at = ? WHERE code = ?",
    [1, "2026-11-27T00:00:00.000Z", "FOOD25"]
  );
  assert.match(update.text, /GREATEST\(0, used_count - \$1\)/);
  assert.deepEqual(update.params, [1, "2026-11-27T00:00:00.000Z", "FOOD25"]);
});

test("SQLite migration helper derives primary keys and source rows without modifying the source", () => {
  const Database = require("better-sqlite3");
  const { inspectSourceTable, buildUpsertSql } = require("../scripts/migrate-sqlite-to-postgres");
  const sqlite = new Database(":memory:");
  try {
    sqlite.exec("CREATE TABLE demo (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO demo (id, value) VALUES ('a', 'kept');");
    const table = inspectSourceTable(sqlite, "demo");
    assert.deepEqual(table.columns, ["id", "value"]);
    assert.deepEqual(table.primaryKeys, ["id"]);
    assert.deepEqual(table.rows, [{ id: "a", value: "kept" }]);
    assert.match(buildUpsertSql("demo", table.columns, table.primaryKeys), /ON CONFLICT \("id"\) DO UPDATE SET "value" = EXCLUDED\."value"/);
    assert.equal(sqlite.prepare("SELECT value FROM demo WHERE id = 'a'").get().value, "kept");
  } finally {
    sqlite.close();
  }
});

test("SQLite adapter serializes concurrent async transactions on its shared connection", async () => {
  const Database = require("better-sqlite3");
  const { adaptDatabase } = require("../server/database");
  const raw = new Database(":memory:");
  const db = adaptDatabase(raw);
  try {
    await db.exec("CREATE TABLE tx_order (id TEXT PRIMARY KEY)");
    const first = db.transaction(async () => {
      await db.prepare("INSERT INTO tx_order (id) VALUES (?)").run("first-start");
      await new Promise(resolve => setTimeout(resolve, 25));
      await db.prepare("INSERT INTO tx_order (id) VALUES (?)").run("first-end");
    });
    const second = db.transaction(async () => {
      await db.prepare("INSERT INTO tx_order (id) VALUES (?)").run("second");
    });
    await Promise.all([first(), second()]);
    const rows = await db.prepare("SELECT id FROM tx_order ORDER BY rowid").all();
    assert.deepEqual(rows.map(row => row.id), ["first-start", "first-end", "second"]);
  } finally {
    raw.close();
  }
});

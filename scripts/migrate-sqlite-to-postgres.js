"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const TABLES = [
  "users",
  "auth_sessions",
  "user_addresses",
  "menu_catalog",
  "inventory",
  "coupons",
  "orders",
  "order_inventory",
  "order_coupons",
  "subscribers",
  "audit_logs",
  "webhook_events"
];

function quoteIdentifier(value) {
  return '"' + String(value).replace(/"/g, '""') + '"';
}

function buildUpsertSql(table, columns, primaryKeys) {
  if (!columns.length || !primaryKeys.length) {
    throw new Error("Cannot migrate " + table + ": columns or primary key metadata is missing.");
  }
  const columnSql = columns.map(quoteIdentifier).join(", ");
  const placeholders = columns.map((_, index) => "$" + (index + 1)).join(", ");
  const conflictSql = primaryKeys.map(quoteIdentifier).join(", ");
  const mutable = columns.filter(column => !primaryKeys.includes(column));
  const action = mutable.length
    ? "DO UPDATE SET " + mutable.map(column => quoteIdentifier(column) + " = EXCLUDED." + quoteIdentifier(column)).join(", ")
    : "DO NOTHING";
  return "INSERT INTO " + quoteIdentifier("public") + "." + quoteIdentifier(table) +
    " (" + columnSql + ") VALUES (" + placeholders + ") ON CONFLICT (" + conflictSql + ") " + action;
}

function inspectSourceTable(sqlite, table) {
  const found = sqlite.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(table);
  if (!found) return null;

  const info = sqlite.pragma("table_info(" + quoteIdentifier(table) + ")");
  const columns = info.map(column => column.name);
  const primaryKeys = info.filter(column => Number(column.pk) > 0)
    .sort((a, b) => Number(a.pk) - Number(b.pk))
    .map(column => column.name);
  if (!primaryKeys.length) {
    throw new Error("Cannot migrate " + table + ": source table has no primary key.");
  }
  const rows = sqlite.prepare("SELECT * FROM " + quoteIdentifier(table)).all();
  return { table, columns, primaryKeys, rows };
}

async function inspectTargetTable(client, table, sourceColumns) {
  const result = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1",
    [table]
  );
  const targetColumns = new Set(result.rows.map(row => row.column_name));
  const missing = sourceColumns.filter(column => !targetColumns.has(column));
  if (missing.length) {
    throw new Error("Neon table " + table + " is missing source columns: " + missing.join(", "));
  }
}

async function migrateSqliteToPostgres(options) {
  const sourcePath = path.resolve(options.sourcePath);
  const connectionString = options.connectionString;
  const apply = Boolean(options.apply);
  if (!connectionString) throw new Error("DATABASE_URL is required. The connection string is never printed.");
  if (!fs.existsSync(sourcePath)) throw new Error("SQLite source file does not exist: " + sourcePath);

  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000
  });

  let client;
  try {
    client = await pool.connect();
    const source = [];
    for (const table of TABLES) {
      const details = inspectSourceTable(sqlite, table);
      if (!details) {
        source.push({ table, skipped: true, rows: [], columns: [], primaryKeys: [] });
        continue;
      }
      await inspectTargetTable(client, table, details.columns);
      source.push(details);
    }

    const report = source.map(item => ({
      table: item.table,
      rows: item.rows.length,
      skipped: Boolean(item.skipped),
      primaryKey: item.primaryKeys || []
    }));

    if (!apply) {
      return {
        dryRun: true,
        sourcePath,
        tables: report,
        message: "No data was written. Re-run with --apply after reviewing this report."
      };
    }

    await client.query("BEGIN");
    const written = [];
    for (const item of source) {
      if (!item || item.skipped || !item.rows.length) {
        written.push({ table: item.table, sourceRows: item.rows.length, processedRows: 0 });
        continue;
      }
      const statement = buildUpsertSql(item.table, item.columns, item.primaryKeys);
      let processedRows = 0;
      for (const row of item.rows) {
        const values = item.columns.map(column => row[column]);
        await client.query(statement, values);
        processedRows += 1;
      }
      written.push({ table: item.table, sourceRows: item.rows.length, processedRows });
    }
    await client.query("COMMIT");
    return {
      dryRun: false,
      sourcePath,
      tables: written,
      message: "SQLite rows were copied with primary-key upserts. The SQLite source was not changed or deleted."
    };
  } catch (error) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch (_) {}
    }
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
    sqlite.close();
  }
}

if (require.main === module) {
  const sourcePath = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!sourcePath) {
    console.error("Usage: DATABASE_URL=... node scripts/migrate-sqlite-to-postgres.js <path-to-foodiehub.sqlite> [--apply]");
    process.exitCode = 2;
  } else {
    migrateSqliteToPostgres({
      sourcePath,
      connectionString: process.env.DATABASE_URL,
      apply
    }).then(report => {
      console.log(JSON.stringify(report, null, 2));
    }).catch(error => {
      console.error("SQLite to PostgreSQL migration failed:", error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = { TABLES, quoteIdentifier, buildUpsertSql, inspectSourceTable, migrateSqliteToPostgres };

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { AsyncLocalStorage } = require("node:async_hooks");

function compilePostgres(sql, values) {
  let text = String(sql).trim();
  let params = [];
  if (values && !Array.isArray(values) && typeof values === "object") {
    const keys = [];
    text = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, key) => {
      let index = keys.indexOf(key);
      if (index === -1) {
        keys.push(key);
        index = keys.length - 1;
      }
      return "$" + (index + 1);
    });
    params = keys.map(key => values[key]);
  } else {
    params = Array.isArray(values) ? values : (values === undefined ? [] : [values]);
    let index = 0;
    text = text.replace(/\?/g, () => "$" + (++index));
  }

  const ignoreInsert = /^INSERT\s+OR\s+IGNORE\s+INTO\b/i.test(text);
  if (ignoreInsert) {
    text = text.replace(/^INSERT\s+OR\s+IGNORE\s+INTO\b/i, "INSERT INTO");
    if (!/\bON\s+CONFLICT\b/i.test(text)) text += " ON CONFLICT DO NOTHING";
  }
  text = text.replace(/\bMAX\(0\s*,/gi, "GREATEST(0,");
  return { text, params };
}

function normalizePgError(error) {
  if (error && ["23505", "23503", "23502"].includes(error.code)) {
    error.constraintCode = error.code;
    error.code = "SQLITE_CONSTRAINT";
  }
  return error;
}

class PostgresDatabase {
  constructor(connectionString) {
    const { Pool } = require("pg");
    this.pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || 8),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true
    });
    this.dialect = "postgres";
    this.transactions = new AsyncLocalStorage();
  }

  async query(sql, values) {
    const compiled = compilePostgres(sql, values);
    const executor = this.transactions.getStore() || this.pool;
    try {
      return await executor.query(compiled.text, compiled.params);
    } catch (error) {
      throw normalizePgError(error);
    }
  }

  prepare(sql) {
    return {
      get: async (...values) => {
        const result = await this.query(sql, values);
        return result.rows[0];
      },
      all: async (...values) => {
        const result = await this.query(sql, values);
        return result.rows;
      },
      run: async (...values) => {
        const result = await this.query(sql, values.length === 1 && values[0] && !Array.isArray(values[0]) && typeof values[0] === "object"
          ? values[0]
          : values);
        return { changes: result.rowCount || 0 };
      }
    };
  }

  async exec(sql) {
    await this.query(sql);
  }

  async transaction(callback) {
    return async (...args) => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const result = await this.transactions.run(client, () => callback(...args));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch (_) {}
        throw normalizePgError(error);
      } finally {
        client.release();
      }
    };
  }

  async close() {
    await this.pool.end();
  }
}

class SqliteDatabase {
  constructor(database) {
    this.database = database;
    this.dialect = "sqlite";
  }

  pragma(statement) {
    return this.database.pragma(statement);
  }

  exec(sql) {
    return this.database.exec(sql);
  }

  prepare(sql) {
    const statement = this.database.prepare(sql);
    return {
      get: (...values) => statement.get(...values),
      all: (...values) => statement.all(...values),
      run: (...values) => statement.run(...values)
    };
  }

  transaction(callback) {
    return async (...args) => {
      this.database.exec("BEGIN");
      try {
        const result = await callback(...args);
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try { this.database.exec("ROLLBACK"); } catch (_) {}
        throw error;
      }
    };
  }

  close() {
    this.database.close();
  }
}

const wrapped = new WeakMap();

function adaptDatabase(database) {
  if (database && (database.dialect === "postgres" || database.dialect === "sqlite")) return database;
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("A supported database connection is required.");
  }
  if (!wrapped.has(database)) wrapped.set(database, new SqliteDatabase(database));
  return wrapped.get(database);
}

function createDatabase(options = {}) {
  if (process.env.DATABASE_URL) {
    return new PostgresDatabase(process.env.DATABASE_URL);
  }
  const Database = require("better-sqlite3");
  const filename = options.filename || path.join(__dirname, "data", "foodiehub.sqlite");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const database = new Database(filename);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return new SqliteDatabase(database);
}

module.exports = {
  createDatabase,
  adaptDatabase,
  PostgresDatabase,
  SqliteDatabase,
  compilePostgres
};

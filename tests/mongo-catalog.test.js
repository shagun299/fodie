"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createMongoCatalog,
  normalizeMenuDocument,
  buildSeedOperation
} = require("../server/mongo-catalog");

class MemoryCollection {
  constructor() {
    this.documents = new Map();
    this.indexes = [];
  }

  async createIndex(fields, options) {
    this.indexes.push({ fields, options });
    return options.name;
  }

  async bulkWrite(operations) {
    for (const operation of operations) {
      const change = operation.updateOne;
      if (change.upsert && !this.documents.has(change.filter._id)) {
        this.documents.set(change.filter._id, structuredClone(change.update.$setOnInsert));
      }
    }
  }

  find() {
    return {
      sort: () => ({
        toArray: async () => [...this.documents.values()].sort((a, b) => a._id.localeCompare(b._id))
      })
    };
  }

  async findOne(filter) {
    return this.documents.get(filter._id) || null;
  }

  async replaceOne(filter, document) {
    this.documents.set(filter._id, structuredClone(document));
    return { matchedCount: 1 };
  }

  async updateOne(filter, update) {
    const current = this.documents.get(filter._id);
    if (!current) return { matchedCount: 0 };
    Object.assign(current, update.$set);
    return { matchedCount: 1 };
  }
}

test("Mongo menu document normalization preserves product fields and active state", () => {
  const result = normalizeMenuDocument({
    _id: "truffle-burger",
    name: "Truffle Burger",
    price: 249,
    isActive: false,
    updatedAt: "2026-11-28T00:00:00.000Z"
  });
  assert.deepEqual(result.item, { name: "Truffle Burger", price: 249, id: "truffle-burger" });
  assert.equal(result.isActive, false);
  assert.equal(result.updatedAt, "2026-11-28T00:00:00.000Z");
});

test("Mongo seed operation inserts defaults without overwriting existing catalog edits", () => {
  const operation = buildSeedOperation({ id: "pizza", name: "Pizza", price: 199 }, "2026-11-28");
  assert.equal(operation.updateOne.filter._id, "pizza");
  assert.equal(operation.updateOne.upsert, true);
  assert.deepEqual(operation.updateOne.update.$setOnInsert, {
    id: "pizza",
    name: "Pizza",
    price: 199,
    _id: "pizza",
    isActive: true,
    updatedAt: "2026-11-28"
  });
});

test("Mongo catalog initializes, reads, updates and archives menu documents", async () => {
  const collection = new MemoryCollection();
  let closed = false;
  class FakeClient {
    constructor(uri) { assert.equal(uri, "mongodb://test"); }
    async connect() {}
    db(name) {
      assert.equal(name, "foodiehub_test");
      return { collection: name => {
        assert.equal(name, "menu_items");
        return collection;
      }};
    }
    async close() { closed = true; }
  }

  const catalog = await createMongoCatalog({
    uri: "mongodb://test",
    databaseName: "foodiehub_test",
    MongoClient: FakeClient
  });

  const seeded = await catalog.initialize([
    { id: "pizza", name: "Pizza", price: 199 },
    { id: "burger", name: "Burger", price: 249 }
  ]);
  assert.equal(seeded.length, 2);
  assert.equal((await catalog.get("pizza")).item.name, "Pizza");

  await catalog.upsert("pizza", { id: "pizza", name: "Updated Pizza", price: 219 }, true);
  assert.equal((await catalog.get("pizza")).item.price, 219);

  assert.equal(await catalog.setActive("pizza", false), true);
  assert.equal((await catalog.get("pizza")).isActive, false);
  assert.equal(await catalog.setActive("missing", false), false);

  assert.equal((await catalog.list()).length, 2);
  await catalog.close();
  assert.equal(closed, true);
});

test("Mongo catalog is optional when no connection URI is configured", async () => {
  assert.equal(await createMongoCatalog({ uri: "" }), null);
});

"use strict";

function normalizeMenuDocument(document) {
  if (!document) return null;
  const { _id, isActive, updatedAt, ...item } = document;
  return {
    item: { ...item, id: item.id || String(_id) },
    isActive: isActive !== false,
    updatedAt: updatedAt || null
  };
}

function buildSeedOperation(item, timestamp) {
  return {
    updateOne: {
      filter: { _id: item.id },
      update: {
        $setOnInsert: {
          ...item,
          _id: item.id,
          isActive: true,
          updatedAt: timestamp
        }
      },
      upsert: true
    }
  };
}

function createMongoCatalogFromCollection(collection, client = null) {
  if (!collection) throw new TypeError("A MongoDB menu collection is required.");

  return {
    async initialize(seedItems = []) {
      if (seedItems.length) {
        const timestamp = new Date().toISOString();
        await collection.bulkWrite(seedItems.map(item => buildSeedOperation(item, timestamp)), { ordered: false });
      }
      const documents = await collection.find({}).sort({ _id: 1 }).toArray();
      return documents.map(normalizeMenuDocument).filter(Boolean);
    },

    async list() {
      const documents = await collection.find({}).sort({ _id: 1 }).toArray();
      return documents.map(normalizeMenuDocument).filter(Boolean);
    },

    async get(productId) {
      const document = await collection.findOne({ _id: String(productId) });
      return normalizeMenuDocument(document);
    },

    async upsert(productId, item, active = true) {
      const document = {
        ...item,
        _id: String(productId),
        id: String(productId),
        isActive: Boolean(active),
        updatedAt: new Date().toISOString()
      };
      await collection.replaceOne({ _id: String(productId) }, document, { upsert: true });
      return normalizeMenuDocument(document);
    },

    async setActive(productId, active) {
      const result = await collection.updateOne(
        { _id: String(productId) },
        { $set: { isActive: Boolean(active), updatedAt: new Date().toISOString() } }
      );
      return Number(result.matchedCount || 0) > 0;
    },

    async close() {
      if (client && typeof client.close === "function") await client.close();
    }
  };
}

async function createMongoCatalog(options = {}) {
  const uri = String(options.uri || "").trim();
  if (!uri) return null;

  const MongoClient = options.MongoClient || require("mongodb").MongoClient;
  const client = new MongoClient(uri, {
    maxPoolSize: Number(process.env.MONGO_POOL_MAX || 5),
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 10000,
    retryWrites: true
  });

  try {
    await client.connect();
    const databaseName = String(options.databaseName || process.env.MONGODB_DATABASE || "foodiehub").trim();
    if (!databaseName) throw new Error("MONGODB_DATABASE must not be empty.");
    const collection = client.db(databaseName).collection("menu_items");
    await collection.createIndex({ id: 1 }, { unique: true, name: "uq_menu_items_id" });
    return createMongoCatalogFromCollection(collection, client);
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
}

module.exports = {
  createMongoCatalog,
  createMongoCatalogFromCollection,
  normalizeMenuDocument,
  buildSeedOperation
};

-- FoodieHub PostgreSQL schema for Neon.
-- Safe, additive migration: creates tables/indexes only; does not delete or rewrite data.
-- Monetary values use DOUBLE PRECISION to preserve the API's JavaScript number behavior.
-- JSON payloads remain TEXT because the existing API stores JSON.stringify() strings.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  order_number TEXT PRIMARY KEY,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  address TEXT NOT NULL,
  items_json TEXT NOT NULL,
  subtotal DOUBLE PRECISION NOT NULL,
  coupon_code TEXT,
  coupon_discount DOUBLE PRECISION NOT NULL,
  delivery_fee DOUBLE PRECISION NOT NULL,
  tax DOUBLE PRECISION NOT NULL,
  total DOUBLE PRECISION NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  gateway_order_id TEXT,
  address_json TEXT,
  idempotency_key TEXT,
  idempotency_fingerprint TEXT,
  user_id TEXT,
  razorpay_payment_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_gateway_order_id
  ON orders(gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency_key
  ON orders(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscribers (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  jti TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_subject
  ON auth_sessions(subject_id, role);

-- Deliberately no FK to users: Firebase-authenticated users are keyed by Firebase UID
-- and are not necessarily stored in the legacy password-auth users table.
CREATE TABLE IF NOT EXISTS user_addresses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Home',
  address_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user
  ON user_addresses(user_id);

CREATE TABLE IF NOT EXISTS menu_catalog (
  product_id TEXT PRIMARY KEY,
  data_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id TEXT PRIMARY KEY,
  quantity INTEGER,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coupons (
  code TEXT PRIMARY KEY,
  discount_type TEXT NOT NULL,
  discount_value DOUBLE PRECISION NOT NULL,
  max_discount DOUBLE PRECISION,
  min_order DOUBLE PRECISION NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  starts_at TEXT,
  expires_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_inventory (
  order_number TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  expires_at TEXT,
  PRIMARY KEY(order_number, product_id)
);
CREATE INDEX IF NOT EXISTS idx_order_inventory_expiry
  ON order_inventory(status, expires_at);

CREATE TABLE IF NOT EXISTS order_coupons (
  order_number TEXT PRIMARY KEY,
  coupon_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed'
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created
  ON audit_logs(created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (1, '001_neon_postgres', NOW()::TEXT)
ON CONFLICT (version) DO NOTHING;

COMMIT;

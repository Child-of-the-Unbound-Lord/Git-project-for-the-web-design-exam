// D1 schema. The inventory trigger makes stock changes and ledger entries atomic.
export const SCHEMA_BASE = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','member')),
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  min_stock INTEGER NOT NULL DEFAULT 0 CHECK(min_stock BETWEEN 0 AND 1000000000),
  current_stock INTEGER NOT NULL DEFAULT 0 CHECK(current_stock BETWEEN 0 AND 1000000000),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  business_no TEXT NOT NULL UNIQUE,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  type TEXT NOT NULL CHECK(type IN ('IN','OUT')),
  quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000000000),
  recipient_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  operator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  CHECK ((type='IN' AND recipient_id IS NULL) OR (type='OUT' AND recipient_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_throttle (
  throttle_key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_started_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_recipient ON movements(recipient_id);
CREATE INDEX IF NOT EXISTS idx_movements_time ON movements(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
`;
export const SCHEMA_CHECK_TRIGGER = `
CREATE TRIGGER IF NOT EXISTS check_movement BEFORE INSERT ON movements BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM items WHERE id=NEW.item_id) THEN RAISE(ABORT,'ITEM_NOT_FOUND') END;
  SELECT CASE WHEN (SELECT active FROM items WHERE id=NEW.item_id)=0 THEN RAISE(ABORT,'ITEM_INACTIVE') END;
  SELECT CASE WHEN NEW.type='OUT' AND NOT EXISTS (
    SELECT 1 FROM users WHERE id=NEW.recipient_id AND active=1 AND role='member'
  ) THEN RAISE(ABORT,'INVALID_RECIPIENT') END;
  SELECT CASE WHEN NEW.type='OUT' AND (SELECT current_stock FROM items WHERE id=NEW.item_id)<NEW.quantity
    THEN RAISE(ABORT,'INSUFFICIENT_STOCK') END;
  SELECT CASE WHEN NEW.type='IN' AND (SELECT current_stock FROM items WHERE id=NEW.item_id)>1000000000-NEW.quantity
    THEN RAISE(ABORT,'STOCK_LIMIT') END;
END;
`;
export const SCHEMA_APPLY_TRIGGER = `
CREATE TRIGGER IF NOT EXISTS apply_movement AFTER INSERT ON movements BEGIN
  UPDATE items SET current_stock=current_stock + CASE WHEN NEW.type='IN' THEN NEW.quantity ELSE -NEW.quantity END
  WHERE id=NEW.item_id;
END;

`;
export const SCHEMA = SCHEMA_BASE + SCHEMA_CHECK_TRIGGER + SCHEMA_APPLY_TRIGGER;

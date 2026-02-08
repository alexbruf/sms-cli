-- Messages table (core SMS inbox)
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  text TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
  timestamp TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  sim_number INTEGER NOT NULL DEFAULT 1,
  gateway_message_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number);
CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Contacts table
CREATE TABLE IF NOT EXISTS contacts (
  phone_number TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Users table (private mode)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Devices table (private mode)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL DEFAULT '',
  push_token TEXT,
  auth_token TEXT NOT NULL UNIQUE,
  last_seen TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_devices_auth_token ON devices(auth_token);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- Gateway messages (outgoing message queue)
CREATE TABLE IF NOT EXISTS gateway_messages (
  id TEXT PRIMARY KEY,
  ext_id TEXT,
  device_id TEXT REFERENCES devices(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  state TEXT NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Processed','Sent','Delivered','Failed')),
  phone_numbers TEXT NOT NULL,
  text TEXT NOT NULL,
  sim_number INTEGER NOT NULL DEFAULT 1,
  is_encrypted INTEGER NOT NULL DEFAULT 0,
  with_delivery_report INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_gw_messages_device_state ON gateway_messages(device_id, state);
CREATE INDEX IF NOT EXISTS idx_gw_messages_user ON gateway_messages(user_id);

-- Message recipients (per-phone delivery tracking)
CREATE TABLE IF NOT EXISTS message_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES gateway_messages(id),
  phone_number TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Processed','Sent','Delivered','Failed')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_recipients_message ON message_recipients(message_id);

-- Gateway webhooks
CREATE TABLE IF NOT EXISTS gateway_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  url TEXT NOT NULL,
  event TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gw_webhooks_user ON gateway_webhooks(user_id);

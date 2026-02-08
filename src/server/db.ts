import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
import type {
  Message,
  Contact,
  Conversation,
  Direction,
  ListMessagesParams,
} from "../shared/types.ts";
import type {
  ProcessingState,
  DbUser,
  DbDevice,
  DbGatewayMessage,
  DbMessageRecipient,
  DbGatewayWebhook,
} from "../shared/gateway-types.ts";

export class DB {
  private db: Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.run("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        phone_number TEXT NOT NULL,
        text TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
        timestamp TEXT NOT NULL,
        read INTEGER NOT NULL DEFAULT 0,
        sim_number INTEGER NOT NULL DEFAULT 1,
        gateway_message_id TEXT
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_read ON messages(read)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction)"
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS contacts (
        phone_number TEXT PRIMARY KEY,
        name TEXT NOT NULL
      )
    `);

    // Private mode tables
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        name TEXT NOT NULL DEFAULT '',
        push_token TEXT,
        auth_token TEXT NOT NULL UNIQUE,
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_devices_auth_token ON devices(auth_token)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id)"
    );
    this.db.run(`
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
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_gw_messages_device_state ON gateway_messages(device_id, state)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_gw_messages_user ON gateway_messages(user_id)"
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS message_recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL REFERENCES gateway_messages(id),
        phone_number TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Processed','Sent','Delivered','Failed')),
        error TEXT
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_recipients_message ON message_recipients(message_id)"
    );
    this.db.run(`
      CREATE TABLE IF NOT EXISTS gateway_webhooks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        device_id TEXT REFERENCES devices(id),
        url TEXT NOT NULL,
        event TEXT NOT NULL
      )
    `);
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_gw_webhooks_user ON gateway_webhooks(user_id)"
    );

    // Add gateway_message_id to messages if missing (migration for existing DBs)
    try {
      this.db.run("ALTER TABLE messages ADD COLUMN gateway_message_id TEXT");
    } catch {
      // Column already exists
    }
  }

  // ── Existing message/contact methods ──

  private toMessage(row: Record<string, unknown>): Message {
    return {
      id: row.id as string,
      phone_number: row.phone_number as string,
      text: row.text as string,
      direction: row.direction as Direction,
      timestamp: row.timestamp as string,
      read: !!(row.read as number),
      sim_number: row.sim_number as number,
    };
  }

  insertMessage(msg: Message): boolean {
    const stmt = this.db.prepare(
      "INSERT OR IGNORE INTO messages (id, phone_number, text, direction, timestamp, read, sim_number) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const result = stmt.run(
      msg.id,
      msg.phone_number,
      msg.text,
      msg.direction,
      msg.timestamp,
      msg.read ? 1 : 0,
      msg.sim_number
    );
    return result.changes > 0;
  }

  getMessage(id: string): Message | null {
    const row = this.db
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? this.toMessage(row) : null;
  }

  getMessageByPrefix(prefix: string): Message {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE id LIKE ? || '%'")
      .all(prefix) as Record<string, unknown>[];
    if (rows.length === 0) throw new Error("Message not found");
    if (rows.length > 1)
      throw new Error("Ambiguous ID prefix, be more specific");
    return this.toMessage(rows[0]!);
  }

  listMessages(params: ListMessagesParams = {}): Message[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (params.direction) {
      conditions.push("direction = ?");
      values.push(params.direction);
    }
    if (params.unread !== undefined) {
      conditions.push("read = ?");
      values.push(params.unread ? 0 : 1);
    }
    if (params.phone) {
      conditions.push("phone_number = ?");
      values.push(params.phone);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = this.db
      .prepare(
        `SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.toMessage(r));
  }

  markRead(id: string): void {
    this.db.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(id);
  }

  markUnread(id: string): void {
    this.db.prepare("UPDATE messages SET read = 0 WHERE id = ?").run(id);
  }

  deleteMessage(id: string): void {
    this.db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  }

  setGatewayMessageId(messageId: string, gatewayMessageId: string): void {
    this.db
      .prepare("UPDATE messages SET gateway_message_id = ? WHERE id = ?")
      .run(gatewayMessageId, messageId);
  }

  getConversations(): Conversation[] {
    const rows = this.db
      .prepare(
        `
      SELECT
        m.phone_number,
        c.name,
        COUNT(*) as message_count,
        SUM(CASE WHEN m.read = 0 AND m.direction = 'in' THEN 1 ELSE 0 END) as unread_count,
        MAX(m.timestamp) as last_message_at,
        (SELECT text FROM messages m2 WHERE m2.phone_number = m.phone_number ORDER BY m2.timestamp DESC LIMIT 1) as last_message
      FROM messages m
      LEFT JOIN contacts c ON m.phone_number = c.phone_number
      GROUP BY m.phone_number
      ORDER BY last_message_at DESC
    `
      )
      .all() as Record<string, unknown>[];

    return rows.map((r) => ({
      phone_number: r.phone_number as string,
      name: (r.name as string) || null,
      message_count: r.message_count as number,
      unread_count: r.unread_count as number,
      last_message_at: r.last_message_at as string,
      last_message: r.last_message as string,
    }));
  }

  getConversation(phone: string): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE phone_number = ? ORDER BY timestamp ASC"
      )
      .all(phone) as Record<string, unknown>[];
    return rows.map((r) => this.toMessage(r));
  }

  markConversationRead(phone: string): void {
    this.db
      .prepare(
        "UPDATE messages SET read = 1 WHERE phone_number = ? AND direction = 'in'"
      )
      .run(phone);
  }

  search(query: string): Message[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE text LIKE ? ORDER BY timestamp DESC"
      )
      .all(`%${query}%`) as Record<string, unknown>[];
    return rows.map((r) => this.toMessage(r));
  }

  getUnreadCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages WHERE read = 0")
      .get() as Record<string, unknown>;
    return row.count as number;
  }

  getTotalCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM messages")
      .get() as Record<string, unknown>;
    return row.count as number;
  }

  getContact(phone: string): Contact | null {
    const row = this.db
      .prepare("SELECT * FROM contacts WHERE phone_number = ?")
      .get(phone) as Record<string, unknown> | null;
    return row
      ? { phone_number: row.phone_number as string, name: row.name as string }
      : null;
  }

  listContacts(): Contact[] {
    const rows = this.db
      .prepare("SELECT * FROM contacts ORDER BY name")
      .all() as Record<string, unknown>[];
    return rows.map((r) => ({
      phone_number: r.phone_number as string,
      name: r.name as string,
    }));
  }

  upsertContact(phone: string, name: string): void {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO contacts (phone_number, name) VALUES (?, ?)"
      )
      .run(phone, name);
  }

  deleteContact(phone: string): void {
    this.db
      .prepare("DELETE FROM contacts WHERE phone_number = ?")
      .run(phone);
  }

  // ── User methods (private mode) ──

  createUser(id: string, login: string, passwordHash: string): void {
    this.db
      .prepare("INSERT INTO users (id, login, password_hash) VALUES (?, ?, ?)")
      .run(id, login, passwordHash);
  }

  getUserByLogin(login: string): DbUser | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE login = ?")
      .get(login) as Record<string, unknown> | null;
    return row ? (row as unknown as DbUser) : null;
  }

  getUserById(id: string): DbUser | null {
    const row = this.db
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? (row as unknown as DbUser) : null;
  }

  getFirstUser(): DbUser | null {
    const row = this.db
      .prepare("SELECT * FROM users ORDER BY created_at ASC LIMIT 1")
      .get() as Record<string, unknown> | null;
    return row ? (row as unknown as DbUser) : null;
  }

  // ── Device methods (private mode) ──

  createDevice(
    id: string,
    userId: string,
    authToken: string,
    name: string = "",
    pushToken: string | null = null
  ): void {
    this.db
      .prepare(
        "INSERT INTO devices (id, user_id, auth_token, name, push_token) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, userId, authToken, name, pushToken);
  }

  getDeviceByToken(token: string): DbDevice | null {
    const row = this.db
      .prepare("SELECT * FROM devices WHERE auth_token = ?")
      .get(token) as Record<string, unknown> | null;
    return row ? (row as unknown as DbDevice) : null;
  }

  getDeviceById(id: string): DbDevice | null {
    const row = this.db
      .prepare("SELECT * FROM devices WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? (row as unknown as DbDevice) : null;
  }

  listDevices(userId: string): DbDevice[] {
    return this.db
      .prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC")
      .all(userId) as unknown as DbDevice[];
  }

  updateDevicePushToken(deviceId: string, pushToken: string): void {
    this.db
      .prepare(
        "UPDATE devices SET push_token = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(pushToken, deviceId);
  }

  updateDeviceName(deviceId: string, name: string): void {
    this.db
      .prepare(
        "UPDATE devices SET name = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(name, deviceId);
  }

  updateDeviceLastSeen(deviceId: string): void {
    this.db
      .prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?")
      .run(deviceId);
  }

  deleteDevice(deviceId: string): void {
    this.db.prepare("DELETE FROM devices WHERE id = ?").run(deviceId);
  }

  getActiveDevice(userId: string): DbDevice | null {
    const row = this.db
      .prepare(
        "SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen DESC LIMIT 1"
      )
      .get(userId) as Record<string, unknown> | null;
    return row ? (row as unknown as DbDevice) : null;
  }

  // ── Gateway message methods (private mode) ──

  insertGatewayMessage(msg: {
    id: string;
    userId: string;
    deviceId?: string;
    phoneNumbers: string[];
    text: string;
    simNumber?: number;
    isEncrypted?: boolean;
    withDeliveryReport?: boolean;
    validUntil?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO gateway_messages
         (id, device_id, user_id, phone_numbers, text, sim_number, is_encrypted, with_delivery_report, valid_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        msg.id,
        msg.deviceId ?? null,
        msg.userId,
        JSON.stringify(msg.phoneNumbers),
        msg.text,
        msg.simNumber ?? 1,
        msg.isEncrypted ? 1 : 0,
        msg.withDeliveryReport ? 1 : 0,
        msg.validUntil ?? null
      );

    // Create recipient rows
    const stmt = this.db.prepare(
      "INSERT INTO message_recipients (message_id, phone_number) VALUES (?, ?)"
    );
    for (const phone of msg.phoneNumbers) {
      stmt.run(msg.id, phone);
    }
  }

  getGatewayMessage(id: string): DbGatewayMessage | null {
    const row = this.db
      .prepare("SELECT * FROM gateway_messages WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? (row as unknown as DbGatewayMessage) : null;
  }

  getGatewayMessageByPrefix(prefix: string): DbGatewayMessage {
    const rows = this.db
      .prepare("SELECT * FROM gateway_messages WHERE id LIKE ? || '%'")
      .all(prefix) as Record<string, unknown>[];
    if (rows.length === 0) throw new Error("Gateway message not found");
    if (rows.length > 1)
      throw new Error("Ambiguous ID prefix, be more specific");
    return rows[0] as unknown as DbGatewayMessage;
  }

  getPendingMessages(
    deviceId: string,
    order: "FIFO" | "LIFO" = "FIFO"
  ): DbGatewayMessage[] {
    const dir = order === "FIFO" ? "ASC" : "DESC";
    return this.db
      .prepare(
        `SELECT * FROM gateway_messages
         WHERE (device_id = ? OR device_id IS NULL) AND state = 'Pending'
         ORDER BY created_at ${dir}`
      )
      .all(deviceId) as unknown as DbGatewayMessage[];
  }

  updateGatewayMessageState(
    id: string,
    state: ProcessingState,
    deviceId?: string
  ): void {
    if (deviceId) {
      this.db
        .prepare(
          "UPDATE gateway_messages SET state = ?, device_id = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(state, deviceId, id);
    } else {
      this.db
        .prepare(
          "UPDATE gateway_messages SET state = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .run(state, id);
    }
  }

  listGatewayMessages(
    userId: string,
    opts: { state?: ProcessingState; limit?: number; offset?: number } = {}
  ): DbGatewayMessage[] {
    const conditions = ["user_id = ?"];
    const values: (string | number)[] = [userId];
    if (opts.state) {
      conditions.push("state = ?");
      values.push(opts.state);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    return this.db
      .prepare(
        `SELECT * FROM gateway_messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(...values, limit, offset) as unknown as DbGatewayMessage[];
  }

  // ── Message recipients ──

  getMessageRecipients(messageId: string): DbMessageRecipient[] {
    return this.db
      .prepare(
        "SELECT * FROM message_recipients WHERE message_id = ? ORDER BY id"
      )
      .all(messageId) as unknown as DbMessageRecipient[];
  }

  updateRecipientState(
    messageId: string,
    phoneNumber: string,
    state: ProcessingState,
    error?: string
  ): void {
    this.db
      .prepare(
        "UPDATE message_recipients SET state = ?, error = ? WHERE message_id = ? AND phone_number = ?"
      )
      .run(state, error ?? null, messageId, phoneNumber);
  }

  // ── Gateway webhooks ──

  createGatewayWebhook(
    id: string,
    userId: string,
    url: string,
    event: string,
    deviceId?: string
  ): void {
    this.db
      .prepare(
        "INSERT INTO gateway_webhooks (id, user_id, url, event, device_id) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, userId, url, event, deviceId ?? null);
  }

  listGatewayWebhooks(userId: string): DbGatewayWebhook[] {
    return this.db
      .prepare(
        "SELECT * FROM gateway_webhooks WHERE user_id = ? ORDER BY event"
      )
      .all(userId) as unknown as DbGatewayWebhook[];
  }

  getGatewayWebhook(id: string): DbGatewayWebhook | null {
    const row = this.db
      .prepare("SELECT * FROM gateway_webhooks WHERE id = ?")
      .get(id) as Record<string, unknown> | null;
    return row ? (row as unknown as DbGatewayWebhook) : null;
  }

  deleteGatewayWebhook(id: string): void {
    this.db
      .prepare("DELETE FROM gateway_webhooks WHERE id = ?")
      .run(id);
  }

  getWebhooksByEvent(event: string): DbGatewayWebhook[] {
    return this.db
      .prepare("SELECT * FROM gateway_webhooks WHERE event = ?")
      .all(event) as unknown as DbGatewayWebhook[];
  }

  close(): void {
    this.db.close();
  }
}

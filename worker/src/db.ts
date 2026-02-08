import type {
  Message,
  Contact,
  Conversation,
  Direction,
  ListMessagesParams,
} from "./types.ts";
import type {
  ProcessingState,
  DbUser,
  DbDevice,
  DbGatewayMessage,
  DbMessageRecipient,
  DbGatewayWebhook,
} from "./gateway-types.ts";

export class DB {
  constructor(private d1: D1Database) {}

  // -- Helpers --

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

  // -- Message methods --

  async insertMessage(msg: Message): Promise<boolean> {
    const result = await this.d1
      .prepare(
        "INSERT OR IGNORE INTO messages (id, phone_number, text, direction, timestamp, read, sim_number) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(msg.id, msg.phone_number, msg.text, msg.direction, msg.timestamp, msg.read ? 1 : 0, msg.sim_number)
      .run();
    return result.meta.changes > 0;
  }

  async getMessage(id: string): Promise<Message | null> {
    const row = await this.d1
      .prepare("SELECT * FROM messages WHERE id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    return row ? this.toMessage(row) : null;
  }

  async getMessageByPrefix(prefix: string): Promise<Message> {
    const { results } = await this.d1
      .prepare("SELECT * FROM messages WHERE id LIKE ? || '%'")
      .bind(prefix)
      .all<Record<string, unknown>>();
    if (results.length === 0) throw new Error("Message not found");
    if (results.length > 1) throw new Error("Ambiguous ID prefix, be more specific");
    return this.toMessage(results[0]!);
  }

  async listMessages(params: ListMessagesParams = {}): Promise<Message[]> {
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

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const { results } = await this.d1
      .prepare(`SELECT * FROM messages ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .bind(...values, limit, offset)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toMessage(r));
  }

  async markRead(id: string): Promise<void> {
    await this.d1.prepare("UPDATE messages SET read = 1 WHERE id = ?").bind(id).run();
  }

  async markUnread(id: string): Promise<void> {
    await this.d1.prepare("UPDATE messages SET read = 0 WHERE id = ?").bind(id).run();
  }

  async deleteMessage(id: string): Promise<void> {
    await this.d1.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
  }

  async setGatewayMessageId(messageId: string, gatewayMessageId: string): Promise<void> {
    await this.d1
      .prepare("UPDATE messages SET gateway_message_id = ? WHERE id = ?")
      .bind(gatewayMessageId, messageId)
      .run();
  }

  async getConversations(): Promise<Conversation[]> {
    const { results } = await this.d1
      .prepare(`
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
      `)
      .all<Record<string, unknown>>();

    return results.map((r) => ({
      phone_number: r.phone_number as string,
      name: (r.name as string) || null,
      message_count: r.message_count as number,
      unread_count: r.unread_count as number,
      last_message_at: r.last_message_at as string,
      last_message: r.last_message as string,
    }));
  }

  async getConversation(phone: string): Promise<Message[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM messages WHERE phone_number = ? ORDER BY timestamp ASC")
      .bind(phone)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toMessage(r));
  }

  async markConversationRead(phone: string): Promise<void> {
    await this.d1
      .prepare("UPDATE messages SET read = 1 WHERE phone_number = ? AND direction = 'in'")
      .bind(phone)
      .run();
  }

  async search(query: string): Promise<Message[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM messages WHERE text LIKE ? ORDER BY timestamp DESC")
      .bind(`%${query}%`)
      .all<Record<string, unknown>>();
    return results.map((r) => this.toMessage(r));
  }

  async getUnreadCount(): Promise<number> {
    const row = await this.d1
      .prepare("SELECT COUNT(*) as count FROM messages WHERE read = 0")
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async getTotalCount(): Promise<number> {
    const row = await this.d1
      .prepare("SELECT COUNT(*) as count FROM messages")
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  // -- Contact methods --

  async getContact(phone: string): Promise<Contact | null> {
    const row = await this.d1
      .prepare("SELECT * FROM contacts WHERE phone_number = ?")
      .bind(phone)
      .first<Record<string, unknown>>();
    return row
      ? { phone_number: row.phone_number as string, name: row.name as string }
      : null;
  }

  async listContacts(): Promise<Contact[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM contacts ORDER BY name")
      .all<Record<string, unknown>>();
    return results.map((r) => ({
      phone_number: r.phone_number as string,
      name: r.name as string,
    }));
  }

  async upsertContact(phone: string, name: string): Promise<void> {
    await this.d1
      .prepare("INSERT OR REPLACE INTO contacts (phone_number, name) VALUES (?, ?)")
      .bind(phone, name)
      .run();
  }

  async deleteContact(phone: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM contacts WHERE phone_number = ?")
      .bind(phone)
      .run();
  }

  // -- User methods (private mode) --

  async createUser(id: string, login: string, passwordHash: string): Promise<void> {
    await this.d1
      .prepare("INSERT INTO users (id, login, password_hash) VALUES (?, ?, ?)")
      .bind(id, login, passwordHash)
      .run();
  }

  async getUserByLogin(login: string): Promise<DbUser | null> {
    return await this.d1
      .prepare("SELECT * FROM users WHERE login = ?")
      .bind(login)
      .first<DbUser>();
  }

  async getUserById(id: string): Promise<DbUser | null> {
    return await this.d1
      .prepare("SELECT * FROM users WHERE id = ?")
      .bind(id)
      .first<DbUser>();
  }

  async getFirstUser(): Promise<DbUser | null> {
    return await this.d1
      .prepare("SELECT * FROM users ORDER BY created_at ASC LIMIT 1")
      .first<DbUser>();
  }

  // -- Device methods (private mode) --

  async createDevice(
    id: string,
    userId: string,
    authToken: string,
    name: string = "",
    pushToken: string | null = null
  ): Promise<void> {
    await this.d1
      .prepare(
        "INSERT INTO devices (id, user_id, auth_token, name, push_token) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(id, userId, authToken, name, pushToken)
      .run();
  }

  async getDeviceByToken(token: string): Promise<DbDevice | null> {
    return await this.d1
      .prepare("SELECT * FROM devices WHERE auth_token = ?")
      .bind(token)
      .first<DbDevice>();
  }

  async getDeviceById(id: string): Promise<DbDevice | null> {
    return await this.d1
      .prepare("SELECT * FROM devices WHERE id = ?")
      .bind(id)
      .first<DbDevice>();
  }

  async listDevices(userId: string): Promise<DbDevice[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY created_at DESC")
      .bind(userId)
      .all<DbDevice>();
    return results;
  }

  async updateDevicePushToken(deviceId: string, pushToken: string): Promise<void> {
    await this.d1
      .prepare("UPDATE devices SET push_token = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(pushToken, deviceId)
      .run();
  }

  async updateDeviceName(deviceId: string, name: string): Promise<void> {
    await this.d1
      .prepare("UPDATE devices SET name = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(name, deviceId)
      .run();
  }

  async updateDeviceLastSeen(deviceId: string): Promise<void> {
    await this.d1
      .prepare("UPDATE devices SET last_seen = datetime('now') WHERE id = ?")
      .bind(deviceId)
      .run();
  }

  async deleteDevice(deviceId: string): Promise<void> {
    await this.d1.prepare("DELETE FROM devices WHERE id = ?").bind(deviceId).run();
  }

  async getActiveDevice(userId: string): Promise<DbDevice | null> {
    return await this.d1
      .prepare("SELECT * FROM devices WHERE user_id = ? ORDER BY last_seen DESC LIMIT 1")
      .bind(userId)
      .first<DbDevice>();
  }

  // -- Gateway message methods (private mode) --

  async insertGatewayMessage(msg: {
    id: string;
    userId: string;
    deviceId?: string;
    phoneNumbers: string[];
    text: string;
    simNumber?: number;
    isEncrypted?: boolean;
    withDeliveryReport?: boolean;
    validUntil?: string;
  }): Promise<void> {
    const stmts: D1PreparedStatement[] = [];

    stmts.push(
      this.d1
        .prepare(
          `INSERT INTO gateway_messages
           (id, device_id, user_id, phone_numbers, text, sim_number, is_encrypted, with_delivery_report, valid_until)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          msg.id,
          msg.deviceId ?? null,
          msg.userId,
          JSON.stringify(msg.phoneNumbers),
          msg.text,
          msg.simNumber ?? 1,
          msg.isEncrypted ? 1 : 0,
          msg.withDeliveryReport ? 1 : 0,
          msg.validUntil ?? null
        )
    );

    for (const phone of msg.phoneNumbers) {
      stmts.push(
        this.d1
          .prepare("INSERT INTO message_recipients (message_id, phone_number) VALUES (?, ?)")
          .bind(msg.id, phone)
      );
    }

    await this.d1.batch(stmts);
  }

  async getGatewayMessage(id: string): Promise<DbGatewayMessage | null> {
    return await this.d1
      .prepare("SELECT * FROM gateway_messages WHERE id = ?")
      .bind(id)
      .first<DbGatewayMessage>();
  }

  async getGatewayMessageByPrefix(prefix: string): Promise<DbGatewayMessage> {
    const { results } = await this.d1
      .prepare("SELECT * FROM gateway_messages WHERE id LIKE ? || '%'")
      .bind(prefix)
      .all<DbGatewayMessage>();
    if (results.length === 0) throw new Error("Gateway message not found");
    if (results.length > 1) throw new Error("Ambiguous ID prefix, be more specific");
    return results[0]!;
  }

  async getPendingMessages(
    deviceId: string,
    order: "FIFO" | "LIFO" = "FIFO"
  ): Promise<DbGatewayMessage[]> {
    const dir = order === "FIFO" ? "ASC" : "DESC";
    const { results } = await this.d1
      .prepare(
        `SELECT * FROM gateway_messages
         WHERE (device_id = ? OR device_id IS NULL) AND state = 'Pending'
         ORDER BY created_at ${dir}`
      )
      .bind(deviceId)
      .all<DbGatewayMessage>();
    return results;
  }

  async updateGatewayMessageState(
    id: string,
    state: ProcessingState,
    deviceId?: string
  ): Promise<void> {
    if (deviceId) {
      await this.d1
        .prepare(
          "UPDATE gateway_messages SET state = ?, device_id = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .bind(state, deviceId, id)
        .run();
    } else {
      await this.d1
        .prepare(
          "UPDATE gateway_messages SET state = ?, updated_at = datetime('now') WHERE id = ?"
        )
        .bind(state, id)
        .run();
    }
  }

  async listGatewayMessages(
    userId: string,
    opts: { state?: ProcessingState; limit?: number; offset?: number } = {}
  ): Promise<DbGatewayMessage[]> {
    const conditions = ["user_id = ?"];
    const values: (string | number)[] = [userId];
    if (opts.state) {
      conditions.push("state = ?");
      values.push(opts.state);
    }
    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = opts.limit ?? 50;
    const offset = opts.offset ?? 0;
    const { results } = await this.d1
      .prepare(
        `SELECT * FROM gateway_messages ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .bind(...values, limit, offset)
      .all<DbGatewayMessage>();
    return results;
  }

  // -- Message recipients --

  async getMessageRecipients(messageId: string): Promise<DbMessageRecipient[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM message_recipients WHERE message_id = ? ORDER BY id")
      .bind(messageId)
      .all<DbMessageRecipient>();
    return results;
  }

  async updateRecipientState(
    messageId: string,
    phoneNumber: string,
    state: ProcessingState,
    error?: string
  ): Promise<void> {
    await this.d1
      .prepare(
        "UPDATE message_recipients SET state = ?, error = ? WHERE message_id = ? AND phone_number = ?"
      )
      .bind(state, error ?? null, messageId, phoneNumber)
      .run();
  }

  // -- Gateway webhooks --

  async createGatewayWebhook(
    id: string,
    userId: string,
    url: string,
    event: string,
    deviceId?: string
  ): Promise<void> {
    await this.d1
      .prepare(
        "INSERT INTO gateway_webhooks (id, user_id, url, event, device_id) VALUES (?, ?, ?, ?, ?)"
      )
      .bind(id, userId, url, event, deviceId ?? null)
      .run();
  }

  async listGatewayWebhooks(userId: string): Promise<DbGatewayWebhook[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM gateway_webhooks WHERE user_id = ? ORDER BY event")
      .bind(userId)
      .all<DbGatewayWebhook>();
    return results;
  }

  async getGatewayWebhook(id: string): Promise<DbGatewayWebhook | null> {
    return await this.d1
      .prepare("SELECT * FROM gateway_webhooks WHERE id = ?")
      .bind(id)
      .first<DbGatewayWebhook>();
  }

  async deleteGatewayWebhook(id: string): Promise<void> {
    await this.d1
      .prepare("DELETE FROM gateway_webhooks WHERE id = ?")
      .bind(id)
      .run();
  }

  async getWebhooksByEvent(event: string): Promise<DbGatewayWebhook[]> {
    const { results } = await this.d1
      .prepare("SELECT * FROM gateway_webhooks WHERE event = ?")
      .bind(event)
      .all<DbGatewayWebhook>();
    return results;
  }
}

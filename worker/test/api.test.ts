import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { describe, it, expect, beforeAll } from "vitest";
import worker from "../src/index.ts";
import type { Bindings } from "../src/index.ts";

const testEnv = env as unknown as Bindings;

const MIGRATION = `
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
CREATE TABLE IF NOT EXISTS contacts (
  phone_number TEXT PRIMARY KEY,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
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
CREATE TABLE IF NOT EXISTS message_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES gateway_messages(id),
  phone_number TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'Pending' CHECK(state IN ('Pending','Processed','Sent','Delivered','Failed')),
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_recipients_message ON message_recipients(message_id);
CREATE TABLE IF NOT EXISTS gateway_webhooks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT REFERENCES devices(id),
  url TEXT NOT NULL,
  event TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gw_webhooks_user ON gateway_webhooks(user_id);
`;

beforeAll(async () => {
  // Apply migration to D1
  const stmts = MIGRATION.split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sql of stmts) {
    await testEnv.DB.prepare(sql).run();
  }
});

// Helper to make requests to the worker
async function request(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const req = new Request(`http://localhost${path}`, init);
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

// Register a device and return { token, login, password, deviceId }
async function registerDevice() {
  const res = await request("/api/mobile/v1/device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ServerKey: testEnv.PRIVATE_TOKEN,
    },
    body: JSON.stringify({ name: "test-device", pushToken: "push123" }),
  });
  const body = (await res.json()) as { id: string; token: string; login: string; password: string };
  return { deviceId: body.id, token: body.token, login: body.login, password: body.password };
}

function authHeader(login: string, password: string) {
  return "Basic " + btoa(`${login}:${password}`);
}

describe("SMS Worker API", () => {
  // Health
  describe("GET /health", () => {
    it("returns status ok", async () => {
      const res = await request("/health");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
    });
  });

  // Webhook (incoming SMS)
  describe("POST /webhook", () => {
    it("stores an incoming SMS", async () => {
      const res = await request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "sms:received",
          payload: {
            phoneNumber: "+15551234567",
            message: "Hello from test",
            receivedAt: "2024-01-01T00:00:00Z",
            simNumber: 1,
          },
          deviceId: "dev1",
          id: "evt1",
          webhookId: "wh1",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { duplicate: boolean; id: string };
      expect(body.duplicate).toBe(false);
      expect(body.id).toBeTruthy();
    });

    it("deduplicates identical webhooks", async () => {
      const payload = {
        event: "sms:received",
        payload: {
          phoneNumber: "+15559999999",
          message: "Dedup test",
          receivedAt: "2024-02-01T00:00:00Z",
          simNumber: 1,
        },
        deviceId: "dev1",
        id: "evt2",
        webhookId: "wh2",
      };

      const res1 = await request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body1 = (await res1.json()) as { duplicate: boolean };
      expect(body1.duplicate).toBe(false);

      const res2 = await request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body2 = (await res2.json()) as { duplicate: boolean };
      expect(body2.duplicate).toBe(true);
    });

    it("ignores non-sms:received events", async () => {
      const res = await request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "system:ping",
          payload: { phoneNumber: "", message: "", receivedAt: "", simNumber: 1 },
          deviceId: "dev1",
          id: "evt3",
          webhookId: "wh3",
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ignored: boolean };
      expect(body.ignored).toBe(true);
    });
  });

  // Messages
  describe("GET /messages", () => {
    it("returns messages list", async () => {
      const res = await request("/messages");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // Contacts
  describe("Contacts API", () => {
    it("creates and lists contacts", async () => {
      const create = await request("/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+15551111111", name: "Alice" }),
      });
      expect(create.status).toBe(201);

      const list = await request("/contacts");
      const contacts = (await list.json()) as Array<{ phone_number: string; name: string }>;
      const alice = contacts.find((c) => c.phone_number === "+15551111111");
      expect(alice).toBeDefined();
      expect(alice!.name).toBe("Alice");
    });
  });

  // Search
  describe("GET /search", () => {
    it("requires q parameter", async () => {
      const res = await request("/search");
      expect(res.status).toBe(400);
    });

    it("finds messages by text", async () => {
      // Insert a message via webhook
      await request("/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "sms:received",
          payload: {
            phoneNumber: "+15553333333",
            message: "unique-search-term-xyz",
            receivedAt: "2024-03-01T00:00:00Z",
            simNumber: 1,
          },
          deviceId: "dev1",
          id: "evt-search",
          webhookId: "wh-search",
        }),
      });

      const res = await request("/search?q=unique-search-term-xyz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { total: number; messages: Array<{ text: string }> };
      expect(body.total).toBeGreaterThan(0);
      expect(body.messages[0]!.text).toBe("unique-search-term-xyz");
    });
  });

  // Device registration (mobile API)
  describe("Mobile API - Device", () => {
    it("rejects registration without private token", async () => {
      const res = await request("/api/mobile/v1/device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(401);
    });

    it("registers a device with ServerKey", async () => {
      const creds = await registerDevice();
      expect(creds.deviceId).toBeTruthy();
      expect(creds.token).toBeTruthy();
      expect(creds.login).toBeTruthy();
      expect(creds.password).toBeTruthy();
    });

    it("GET /device returns device info with valid token", async () => {
      const creds = await registerDevice();
      const res = await request("/api/mobile/v1/device", {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { device: { id: string } | null };
      expect(body.device).not.toBeNull();
      expect(body.device!.id).toBe(creds.deviceId);
    });

    it("GET /device returns null device for invalid token", async () => {
      const res = await request("/api/mobile/v1/device", {
        headers: { Authorization: "Bearer invalid-token" },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { device: null };
      expect(body.device).toBeNull();
    });
  });

  // Mobile message polling
  describe("Mobile API - Messages", () => {
    it("returns empty pending messages for new device", async () => {
      const creds = await registerDevice();
      const res = await request("/api/mobile/v1/message", {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });
  });

  // Mobile webhooks
  describe("Mobile API - Webhooks", () => {
    it("returns self webhook", async () => {
      const creds = await registerDevice();
      const res = await request("/api/mobile/v1/webhooks", {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ id: string; url: string; event: string }>;
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body[0]!.id).toBe("self");
      expect(body[0]!.event).toBe("sms:received");
    });
  });

  // Mobile settings
  describe("Mobile API - Settings", () => {
    it("returns device settings", async () => {
      const creds = await registerDevice();
      const res = await request("/api/mobile/v1/settings", {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { messages: { processingOrder: string }; ping: { intervalSeconds: number } };
      expect(body.messages.processingOrder).toBe("FIFO");
      expect(body.ping.intervalSeconds).toBe(30);
    });
  });

  // 3rd-party API
  describe("3rd-party API", () => {
    it("lists devices with Basic auth", async () => {
      const creds = await registerDevice();
      const res = await request("/3rdparty/v1/devices", {
        headers: { Authorization: authHeader(creds.login, creds.password) },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it("creates and lists webhooks", async () => {
      const creds = await registerDevice();
      const auth = authHeader(creds.login, creds.password);

      const create = await request("/3rdparty/v1/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ url: "https://example.com/hook", event: "sms:received" }),
      });
      expect(create.status).toBe(201);

      const list = await request("/3rdparty/v1/webhooks", {
        headers: { Authorization: auth },
      });
      expect(list.status).toBe(200);
      const webhooks = (await list.json()) as Array<{ id: string }>;
      expect(webhooks.length).toBeGreaterThan(0);
    });

    it("sends a message via 3rdparty API", async () => {
      const creds = await registerDevice();
      const auth = authHeader(creds.login, creds.password);

      const res = await request("/3rdparty/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          textMessage: { text: "Hello from API" },
          phoneNumbers: ["+15554444444"],
          simNumber: 1,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string; state: string; recipients: unknown[] };
      expect(body.id).toBeTruthy();
      expect(body.state).toBe("Pending");
      expect(body.recipients).toHaveLength(1);
    });
  });

  // Conversations
  describe("Conversations API", () => {
    it("lists conversations", async () => {
      const res = await request("/conversations");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });
  });

  // Send (core endpoint)
  describe("POST /send", () => {
    it("requires phone and text", async () => {
      const res = await request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+15555555555" }),
      });
      expect(res.status).toBe(400);
    });

    it("sends a message", async () => {
      // Register a device so the gateway has a user
      await registerDevice();

      const res = await request("/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+15556666666", text: "Test send" }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { phone_number: string; text: string; direction: string };
      expect(body.phone_number).toBe("+15556666666");
      expect(body.text).toBe("Test send");
      expect(body.direction).toBe("out");
    });
  });
});

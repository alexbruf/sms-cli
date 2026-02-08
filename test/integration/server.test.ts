import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer } from "./helpers.ts";
import { join } from "path";

const PORT = 15555;
const BASE = `http://localhost:${PORT}`;
const DB_PATH = join(import.meta.dir, ".test-server.db");

beforeAll(async () => {
  await startServer(PORT, DB_PATH);
});

afterAll(() => {
  stopServer();
});

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.unread_count).toBe("number");
    expect(typeof body.total_messages).toBe("number");
  });
});

describe("webhook + messages", () => {
  let messageId: string;

  test("POST /webhook creates a message", async () => {
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+15551234567",
          message: "Hello from tests!",
          receivedAt: "2024-01-15T10:30:00Z",
          simNumber: 1,
        },
        deviceId: "test-device",
        id: "test-webhook-1",
        webhookId: "wh-1",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.duplicate).toBe(false);
    expect(typeof body.id).toBe("string");
    messageId = body.id as string;
  });

  test("POST /webhook is idempotent", async () => {
    const res = await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+15551234567",
          message: "Hello from tests!",
          receivedAt: "2024-01-15T10:30:00Z",
          simNumber: 1,
        },
        deviceId: "test-device",
        id: "test-webhook-1",
        webhookId: "wh-1",
      }),
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.duplicate).toBe(true);
  });

  test("GET /messages lists the message", async () => {
    const res = await fetch(`${BASE}/messages`);
    expect(res.status).toBe(200);
    const msgs = (await res.json()) as Record<string, unknown>[];
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const found = msgs.find((m) => m.id === messageId);
    expect(found).toBeDefined();
    expect(found!.read).toBe(false);
  });

  test("GET /messages/:prefix resolves by prefix", async () => {
    const prefix = messageId.slice(0, 8);
    const res = await fetch(`${BASE}/messages/${prefix}`);
    expect(res.status).toBe(200);
    const msg = (await res.json()) as Record<string, unknown>;
    expect(msg.id).toBe(messageId);
  });

  test("POST /messages/:id/read marks as read", async () => {
    const res = await fetch(`${BASE}/messages/${messageId}/read`, {
      method: "POST",
    });
    expect(res.status).toBe(204);

    const check = await fetch(`${BASE}/messages/${messageId}`);
    const msg = (await check.json()) as Record<string, unknown>;
    expect(msg.read).toBe(true);
  });

  test("POST /messages/:id/unread marks as unread", async () => {
    const res = await fetch(`${BASE}/messages/${messageId}/unread`, {
      method: "POST",
    });
    expect(res.status).toBe(204);

    const check = await fetch(`${BASE}/messages/${messageId}`);
    const msg = (await check.json()) as Record<string, unknown>;
    expect(msg.read).toBe(false);
  });

  test("GET /messages?unread=true filters", async () => {
    const res = await fetch(`${BASE}/messages?unread=true`);
    const msgs = (await res.json()) as Record<string, unknown>[];
    expect(msgs.every((m) => m.read === false)).toBe(true);
  });

  test("DELETE /messages/:id removes the message", async () => {
    // Add a second message to delete
    await fetch(`${BASE}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+15559999999",
          message: "Delete me",
          receivedAt: "2024-06-01T00:00:00Z",
          simNumber: 1,
        },
        deviceId: "d",
        id: "w2",
        webhookId: "wh-2",
      }),
    });
    const listRes = await fetch(`${BASE}/messages?phone=%2B15559999999`);
    const msgs = (await listRes.json()) as Record<string, unknown>[];
    const delId = msgs[0]!.id as string;

    const res = await fetch(`${BASE}/messages/${delId}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    const check = await fetch(`${BASE}/messages/${delId}`);
    expect(check.status).toBe(404);
  });
});

describe("conversations", () => {
  test("GET /conversations lists grouped threads", async () => {
    const res = await fetch(`${BASE}/conversations`);
    expect(res.status).toBe(200);
    const convos = (await res.json()) as Record<string, unknown>[];
    expect(convos.length).toBeGreaterThanOrEqual(1);
    const c = convos.find((c) => c.phone_number === "+15551234567");
    expect(c).toBeDefined();
    expect(typeof c!.unread_count).toBe("number");
    expect(typeof c!.message_count).toBe("number");
  });

  test("GET /conversations/:phone returns thread", async () => {
    const res = await fetch(
      `${BASE}/conversations/${encodeURIComponent("+15551234567")}`,
    );
    expect(res.status).toBe(200);
    const msgs = (await res.json()) as Record<string, unknown>[];
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  test("POST /conversations/:phone/read marks all read", async () => {
    const res = await fetch(
      `${BASE}/conversations/${encodeURIComponent("+15551234567")}/read`,
      { method: "POST" },
    );
    expect(res.status).toBe(204);

    const check = await fetch(
      `${BASE}/conversations/${encodeURIComponent("+15551234567")}`,
    );
    const msgs = (await check.json()) as Record<string, unknown>[];
    expect(msgs.every((m) => m.read === true)).toBe(true);
  });
});

describe("contacts", () => {
  test("POST /contacts adds a contact", async () => {
    const res = await fetch(`${BASE}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15551234567", name: "Test User" }),
    });
    expect(res.status).toBe(201);
  });

  test("GET /contacts lists contacts", async () => {
    const res = await fetch(`${BASE}/contacts`);
    const contacts = (await res.json()) as Record<string, unknown>[];
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    const found = contacts.find((c) => c.phone_number === "+15551234567");
    expect(found).toBeDefined();
    expect(found!.name).toBe("Test User");
  });

  test("DELETE /contacts/:phone removes contact", async () => {
    const res = await fetch(
      `${BASE}/contacts/${encodeURIComponent("+15551234567")}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(204);
  });
});

describe("search", () => {
  test("GET /search?q= finds messages", async () => {
    const res = await fetch(`${BASE}/search?q=Hello`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.messages as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  test("GET /search without q returns 400", async () => {
    const res = await fetch(`${BASE}/search`);
    expect(res.status).toBe(400);
  });
});

describe("send", () => {
  test("POST /send returns 502 when gateway unreachable", async () => {
    const res = await fetch(`${BASE}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15551234567", text: "test" }),
    });
    // Gateway at localhost:19999 isn't running, so expect 502
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.error).toBe("string");
  });

  test("POST /send validates required fields", async () => {
    const res = await fetch(`${BASE}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+15551234567" }),
    });
    expect(res.status).toBe(400);
  });
});

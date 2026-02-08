import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { DB } from "../../src/server/db.ts";
import { ProxyGateway } from "../../src/server/gateway.ts";
import { messageId } from "../../src/shared/hash.ts";
import type { Hono } from "hono";
import type { Env } from "../../src/server/app.ts";

let db: DB;
let app: Hono<Env>;

beforeEach(() => {
  db = new DB(":memory:");
  const gateway = new ProxyGateway("http://fake:9999", "", "");
  app = createApp({ db, gateway });
});

afterEach(() => {
  db.close();
});

describe("health", () => {
  test("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.unread_count).toBe("number");
    expect(typeof body.total_messages).toBe("number");
  });
});

describe("messages", () => {
  test("GET /messages returns empty list", async () => {
    const res = await app.request("/messages");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  test("GET /messages/:id returns 404 for missing", async () => {
    const res = await app.request("/messages/nonexistent");
    expect(res.status).toBe(404);
  });

  test("message CRUD flow", async () => {
    // Insert via webhook
    const webhookRes = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+15551234567",
          message: "Hello!",
          receivedAt: "2024-01-15T10:30:00Z",
          simNumber: 1,
        },
        deviceId: "d",
        id: "w1",
        webhookId: "wh1",
      }),
    });
    expect(webhookRes.status).toBe(200);
    const { id } = await webhookRes.json() as { id: string };

    // Get by full ID
    const getRes = await app.request(`/messages/${id}`);
    expect(getRes.status).toBe(200);
    const msg = await getRes.json() as { read: boolean };
    expect(msg.read).toBe(false);

    // Mark read
    const markRes = await app.request(`/messages/${id}/read`, { method: "POST" });
    expect(markRes.status).toBe(204);

    // Verify read
    const check = await app.request(`/messages/${id}`);
    expect((await check.json() as { read: boolean }).read).toBe(true);

    // Mark unread
    const unreadRes = await app.request(`/messages/${id}/unread`, { method: "POST" });
    expect(unreadRes.status).toBe(204);

    // Delete
    const delRes = await app.request(`/messages/${id}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    // Verify deleted
    const gone = await app.request(`/messages/${id}`);
    expect(gone.status).toBe(404);
  });

  test("GET /messages filters by unread", async () => {
    const id1 = messageId("+1111", "a", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "a", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    const id2 = messageId("+2222", "b", "2024-01-02T00:00:00Z", "in");
    db.insertMessage({ id: id2, phone_number: "+2222", text: "b", direction: "in", timestamp: "2024-01-02T00:00:00Z", read: true, sim_number: 1 });

    const res = await app.request("/messages?unread=true");
    const msgs = await res.json() as { id: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.id).toBe(id1);
  });

  test("GET /messages/:prefix resolves by prefix", async () => {
    const id = messageId("+1111", "test", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id, phone_number: "+1111", text: "test", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request(`/messages/${id.slice(0, 8)}`);
    expect(res.status).toBe(200);
    const msg = await res.json() as { id: string };
    expect(msg.id).toBe(id);
  });
});

describe("webhook", () => {
  test("deduplicates messages", async () => {
    const payload = {
      event: "sms:received",
      payload: {
        phoneNumber: "+15551234567",
        message: "Dedup test",
        receivedAt: "2024-01-15T10:30:00Z",
        simNumber: 1,
      },
      deviceId: "d",
      id: "w1",
      webhookId: "wh1",
    };

    const res1 = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect((await res1.json() as { duplicate: boolean }).duplicate).toBe(false);

    const res2 = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    expect((await res2.json() as { duplicate: boolean }).duplicate).toBe(true);
  });

  test("ignores non sms:received events", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:sent",
        payload: {},
        deviceId: "d",
        id: "w1",
        webhookId: "wh1",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ignored: boolean };
    expect(body.ignored).toBe(true);
  });
});

describe("conversations", () => {
  test("GET /conversations returns grouped threads", async () => {
    const id1 = messageId("+1111", "a", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "a", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request("/conversations");
    expect(res.status).toBe(200);
    const convos = await res.json() as { phone_number: string }[];
    expect(convos).toHaveLength(1);
    expect(convos[0]!.phone_number).toBe("+1111");
  });

  test("GET /conversations/:phone returns thread", async () => {
    const id1 = messageId("+1111", "a", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "a", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request(`/conversations/${encodeURIComponent("+1111")}`);
    expect(res.status).toBe(200);
    const msgs = await res.json() as unknown[];
    expect(msgs).toHaveLength(1);
  });

  test("GET /conversations/:phone returns 404 for empty", async () => {
    const res = await app.request(`/conversations/${encodeURIComponent("+9999")}`);
    expect(res.status).toBe(404);
  });

  test("POST /conversations/:phone/read marks all read", async () => {
    const id1 = messageId("+1111", "a", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "a", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request(`/conversations/${encodeURIComponent("+1111")}/read`, { method: "POST" });
    expect(res.status).toBe(204);

    const msg = db.getMessage(id1);
    expect(msg!.read).toBe(true);
  });
});

describe("contacts", () => {
  test("CRUD flow", async () => {
    // Add
    const addRes = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111", name: "Alice" }),
    });
    expect(addRes.status).toBe(201);

    // List
    const listRes = await app.request("/contacts");
    const contacts = await listRes.json() as { phone_number: string; name: string }[];
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("Alice");

    // Delete
    const delRes = await app.request(`/contacts/${encodeURIComponent("+1111")}`, { method: "DELETE" });
    expect(delRes.status).toBe(204);

    const listRes2 = await app.request("/contacts");
    expect(await listRes2.json()).toEqual([]);
  });

  test("validates required fields", async () => {
    const res = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("search", () => {
  test("GET /search?q= finds messages", async () => {
    const id = messageId("+1111", "hello world", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id, phone_number: "+1111", text: "hello world", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request("/search?q=hello");
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: unknown[]; total: number };
    expect(body.messages).toHaveLength(1);
    expect(body.total).toBe(1);
  });

  test("GET /search without q returns 400", async () => {
    const res = await app.request("/search");
    expect(res.status).toBe(400);
  });
});

describe("send", () => {
  test("POST /send returns 502 when gateway unreachable", async () => {
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111", text: "test" }),
    });
    expect(res.status).toBe(502);
  });

  test("POST /send validates required fields", async () => {
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("messages - edge cases", () => {
  test("GET /messages filters by direction=out", async () => {
    const id1 = messageId("+1111", "incoming", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "incoming", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    const id2 = messageId("+1111", "outgoing", "2024-01-02T00:00:00Z", "out");
    db.insertMessage({ id: id2, phone_number: "+1111", text: "outgoing", direction: "out", timestamp: "2024-01-02T00:00:00Z", read: true, sim_number: 1 });

    const res = await app.request("/messages?direction=out");
    const msgs = await res.json() as { text: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("outgoing");
  });

  test("GET /messages filters by phone number", async () => {
    const id1 = messageId("+1111", "a", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "a", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    const id2 = messageId("+2222", "b", "2024-01-02T00:00:00Z", "in");
    db.insertMessage({ id: id2, phone_number: "+2222", text: "b", direction: "in", timestamp: "2024-01-02T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request("/messages?phone=%2B1111");
    const msgs = await res.json() as { phone_number: string }[];
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.phone_number).toBe("+1111");
  });

  test("GET /messages respects limit and offset", async () => {
    for (let i = 0; i < 5; i++) {
      const id = messageId("+1111", `msg${i}`, `2024-01-0${i + 1}T00:00:00Z`, "in");
      db.insertMessage({ id, phone_number: "+1111", text: `msg${i}`, direction: "in", timestamp: `2024-01-0${i + 1}T00:00:00Z`, read: false, sim_number: 1 });
    }

    const res = await app.request("/messages?limit=2&offset=1");
    const msgs = await res.json() as unknown[];
    expect(msgs).toHaveLength(2);
  });

  test("POST /messages/:id/read returns 404 for missing message", async () => {
    const res = await app.request("/messages/nonexistent/read", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("POST /messages/:id/unread returns 404 for missing message", async () => {
    const res = await app.request("/messages/nonexistent/unread", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("DELETE /messages/:id returns 404 for missing message", async () => {
    const res = await app.request("/messages/nonexistent", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("webhook - edge cases", () => {
  test("POST /webhook with invalid JSON returns 400", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("POST /webhook stores message with correct fields", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+19998887777",
          message: "Check fields",
          receivedAt: "2024-06-15T12:00:00Z",
          simNumber: 2,
        },
        deviceId: "device1",
        id: "w-fields",
        webhookId: "wh-fields",
      }),
    });
    const { id } = await res.json() as { id: string };

    const msg = db.getMessage(id);
    expect(msg).not.toBeNull();
    expect(msg!.phone_number).toBe("+19998887777");
    expect(msg!.text).toBe("Check fields");
    expect(msg!.direction).toBe("in");
    expect(msg!.read).toBe(false);
    expect(msg!.sim_number).toBe(2);
    expect(msg!.timestamp).toBe("2024-06-15T12:00:00Z");
  });
});

describe("send - edge cases", () => {
  test("POST /send with invalid JSON returns 400", async () => {
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("POST /send with missing phone returns 400", async () => {
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /send with empty body returns 400", async () => {
    const res = await app.request("/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("contacts - edge cases", () => {
  test("POST /contacts with invalid JSON returns 400", async () => {
    const res = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  test("POST /contacts with missing name returns 400", async () => {
    const res = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111" }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /contacts with missing phone returns 400", async () => {
    const res = await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(400);
  });

  test("GET /contacts returns empty list initially", async () => {
    const res = await app.request("/contacts");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("contact upsert updates existing contact", async () => {
    await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111", name: "Alice" }),
    });
    await app.request("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: "+1111", name: "Alice Updated" }),
    });

    const res = await app.request("/contacts");
    const contacts = await res.json() as { name: string }[];
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toBe("Alice Updated");
  });
});

describe("search - edge cases", () => {
  test("GET /search returns empty when no matches", async () => {
    const res = await app.request("/search?q=nonexistent");
    expect(res.status).toBe(200);
    const body = await res.json() as { messages: unknown[]; total: number };
    expect(body.messages).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  test("GET /search is case-insensitive", async () => {
    const id = messageId("+1111", "Hello World", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id, phone_number: "+1111", text: "Hello World", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request("/search?q=hello");
    const body = await res.json() as { messages: unknown[]; total: number };
    expect(body.messages).toHaveLength(1);
  });
});

describe("conversations - edge cases", () => {
  test("GET /conversations returns empty list initially", async () => {
    const res = await app.request("/conversations");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("GET /conversations includes contact names", async () => {
    const id = messageId("+1111", "hi", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id, phone_number: "+1111", text: "hi", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    db.upsertContact("+1111", "Alice");

    const res = await app.request("/conversations");
    const convos = await res.json() as { name: string | null }[];
    expect(convos[0]!.name).toBe("Alice");
  });

  test("GET /conversations sorts by last message time", async () => {
    const id1 = messageId("+1111", "old", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "old", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    const id2 = messageId("+2222", "new", "2024-01-02T00:00:00Z", "in");
    db.insertMessage({ id: id2, phone_number: "+2222", text: "new", direction: "in", timestamp: "2024-01-02T00:00:00Z", read: false, sim_number: 1 });

    const res = await app.request("/conversations");
    const convos = await res.json() as { phone_number: string }[];
    expect(convos[0]!.phone_number).toBe("+2222");
    expect(convos[1]!.phone_number).toBe("+1111");
  });

  test("POST /conversations/:phone/read only marks incoming as read", async () => {
    const id1 = messageId("+1111", "incoming", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id: id1, phone_number: "+1111", text: "incoming", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });
    const id2 = messageId("+1111", "outgoing", "2024-01-02T00:00:00Z", "out");
    db.insertMessage({ id: id2, phone_number: "+1111", text: "outgoing", direction: "out", timestamp: "2024-01-02T00:00:00Z", read: true, sim_number: 1 });

    await app.request(`/conversations/${encodeURIComponent("+1111")}/read`, { method: "POST" });

    const incoming = db.getMessage(id1);
    expect(incoming!.read).toBe(true);
    // Outgoing was already read=true, should still be true
    const outgoing = db.getMessage(id2);
    expect(outgoing!.read).toBe(true);
  });
});

describe("health - reflects state", () => {
  test("unread count updates after messages", async () => {
    const res1 = await app.request("/health");
    const h1 = await res1.json() as { unread_count: number; total_messages: number };
    expect(h1.unread_count).toBe(0);
    expect(h1.total_messages).toBe(0);

    const id = messageId("+1111", "test", "2024-01-01T00:00:00Z", "in");
    db.insertMessage({ id, phone_number: "+1111", text: "test", direction: "in", timestamp: "2024-01-01T00:00:00Z", read: false, sim_number: 1 });

    const res2 = await app.request("/health");
    const h2 = await res2.json() as { unread_count: number; total_messages: number };
    expect(h2.unread_count).toBe(1);
    expect(h2.total_messages).toBe(1);

    db.markRead(id);

    const res3 = await app.request("/health");
    const h3 = await res3.json() as { unread_count: number; total_messages: number };
    expect(h3.unread_count).toBe(0);
    expect(h3.total_messages).toBe(1);
  });
});

describe("404", () => {
  test("returns 404 for unknown routes", async () => {
    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);
  });

  test("returns 404 for wrong HTTP method", async () => {
    const res = await app.request("/health", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

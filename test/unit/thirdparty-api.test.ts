import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { createApp } from "../../src/server/app.ts";
import { DB } from "../../src/server/db.ts";
import { PrivateGateway } from "../../src/server/gateway.ts";
import { EventBus } from "../../src/server/event-bus.ts";
import { UpstreamPushClient } from "../../src/server/push.ts";
import type { Hono } from "hono";
import type { Env } from "../../src/server/app.ts";

const PRIVATE_TOKEN = "test-private-token";
const PUBLIC_URL = "http://localhost:5555";

let db: DB;
let app: Hono<Env>;
let login: string;
let password: string;

beforeEach(async () => {
  db = new DB(":memory:");
  const eventBus = new EventBus();
  const pushClient = new UpstreamPushClient();
  const gateway = new PrivateGateway(db, eventBus, pushClient);
  app = createApp({
    db,
    gateway,
    gatewayMode: "private",
    eventBus,
    privateToken: PRIVATE_TOKEN,
    publicUrl: PUBLIC_URL,
    webhookSigningKey: "key",
  });

  // Register a device to get credentials
  const res = await app.request("/api/mobile/v1/device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PRIVATE_TOKEN}`,
    },
    body: JSON.stringify({ name: "Test" }),
  });
  const body = await res.json() as { login: string; password: string };
  login = body.login;
  password = body.password;
});

afterEach(() => {
  db.close();
});

function basicAuth(): string {
  return `Basic ${btoa(`${login}:${password}`)}`;
}

describe("3rdparty auth", () => {
  test("rejects missing auth", async () => {
    const res = await app.request("/3rdparty/v1/devices");
    expect(res.status).toBe(401);
  });

  test("rejects wrong password", async () => {
    const res = await app.request("/3rdparty/v1/devices", {
      headers: { Authorization: `Basic ${btoa(`${login}:wrong`)}` },
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /3rdparty/v1/devices", () => {
  test("lists devices", async () => {
    const res = await app.request("/3rdparty/v1/devices", {
      headers: { Authorization: basicAuth() },
    });
    expect(res.status).toBe(200);
    const devices = await res.json() as { id: string; name: string }[];
    expect(devices).toHaveLength(1);
    expect(devices[0]!.name).toBe("Test");
  });
});

describe("POST /3rdparty/v1/messages", () => {
  test("enqueues a message", async () => {
    const res = await app.request("/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({
        textMessage: { text: "Hello from 3rd party" },
        phoneNumbers: ["+1234567890"],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; state: string };
    expect(body.id).toBeTruthy();
    expect(body.state).toBe("Pending");
  });

  test("validates required fields", async () => {
    const res = await app.request("/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /3rdparty/v1/messages", () => {
  test("lists enqueued messages", async () => {
    // Enqueue one
    await app.request("/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({
        textMessage: { text: "test" },
        phoneNumbers: ["+1111"],
      }),
    });

    const res = await app.request("/3rdparty/v1/messages", {
      headers: { Authorization: basicAuth() },
    });
    expect(res.status).toBe(200);
    const messages = await res.json() as { id: string; state: string }[];
    expect(messages).toHaveLength(1);
  });
});

describe("GET /3rdparty/v1/messages/:id", () => {
  test("returns message by ID", async () => {
    const sendRes = await app.request("/3rdparty/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({
        textMessage: { text: "test" },
        phoneNumbers: ["+1111"],
      }),
    });
    const { id } = await sendRes.json() as { id: string };

    const res = await app.request(`/3rdparty/v1/messages/${id}`, {
      headers: { Authorization: basicAuth() },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; state: string };
    expect(body.id).toBe(id);
  });

  test("returns 404 for missing message", async () => {
    const res = await app.request("/3rdparty/v1/messages/nonexistent", {
      headers: { Authorization: basicAuth() },
    });
    expect(res.status).toBe(404);
  });
});

describe("3rdparty webhooks CRUD", () => {
  test("create, list, delete", async () => {
    // Create
    const createRes = await app.request("/3rdparty/v1/webhooks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: basicAuth(),
      },
      body: JSON.stringify({ url: "https://example.com/hook", event: "sms:received" }),
    });
    expect(createRes.status).toBe(201);
    const { id } = await createRes.json() as { id: string };

    // List
    const listRes = await app.request("/3rdparty/v1/webhooks", {
      headers: { Authorization: basicAuth() },
    });
    const webhooks = await listRes.json() as { id: string }[];
    expect(webhooks).toHaveLength(1);

    // Delete
    const delRes = await app.request(`/3rdparty/v1/webhooks/${id}`, {
      method: "DELETE",
      headers: { Authorization: basicAuth() },
    });
    expect(delRes.status).toBe(204);

    // Verify deleted
    const listRes2 = await app.request("/3rdparty/v1/webhooks", {
      headers: { Authorization: basicAuth() },
    });
    expect(await listRes2.json()).toEqual([]);
  });
});

describe("3rdparty health", () => {
  test("GET /3rdparty/v1/health", async () => {
    const res = await app.request("/3rdparty/v1/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });
});

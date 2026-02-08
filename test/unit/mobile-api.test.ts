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
const SIGNING_KEY = "test-signing-key";

let db: DB;
let app: Hono<Env>;
let eventBus: EventBus;

beforeEach(() => {
  db = new DB(":memory:");
  eventBus = new EventBus();
  const pushClient = new UpstreamPushClient();
  const gateway = new PrivateGateway(db, eventBus, pushClient);
  app = createApp({
    db,
    gateway,
    gatewayMode: "private",
    eventBus,
    privateToken: PRIVATE_TOKEN,
    publicUrl: PUBLIC_URL,
    webhookSigningKey: SIGNING_KEY,
  });
});

afterEach(() => {
  db.close();
});

async function registerDevice(name = "Test Phone"): Promise<{ id: string; token: string; login: string; password: string }> {
  const res = await app.request("/api/mobile/v1/device", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PRIVATE_TOKEN}`,
    },
    body: JSON.stringify({ name }),
  });
  return res.json() as Promise<{ id: string; token: string; login: string; password: string }>;
}

describe("POST /api/mobile/v1/device (registration)", () => {
  test("registers a device with valid token", async () => {
    const res = await app.request("/api/mobile/v1/device", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PRIVATE_TOKEN}`,
      },
      body: JSON.stringify({ name: "My Phone" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; token: string; login: string; password: string };
    expect(body.id).toBeTruthy();
    expect(body.token).toBeTruthy();
    expect(body.login).toBeTruthy();
    expect(body.password).toBeTruthy();
  });

  test("rejects invalid registration token", async () => {
    const res = await app.request("/api/mobile/v1/device", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer wrong-token",
      },
      body: JSON.stringify({ name: "My Phone" }),
    });
    expect(res.status).toBe(401);
  });

  test("rejects missing Authorization", async () => {
    const res = await app.request("/api/mobile/v1/device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "My Phone" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mobile/v1/device", () => {
  test("returns device info with valid token", async () => {
    const reg = await registerDevice("My Phone");
    const res = await app.request("/api/mobile/v1/device", {
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { externalIP: string; device: { id: string; name: string } };
    expect(body.device.id).toBe(reg.id);
    expect(body.device.name).toBe("My Phone");
  });

  test("returns device: null for invalid token (triggers app re-registration)", async () => {
    const res = await app.request("/api/mobile/v1/device", {
      headers: { Authorization: "Bearer bad-token" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { externalIP: string; device: null };
    expect(body.device).toBeNull();
  });

  test("returns device: null for missing auth", async () => {
    const res = await app.request("/api/mobile/v1/device");
    expect(res.status).toBe(200);
    const body = await res.json() as { externalIP: string; device: null };
    expect(body.device).toBeNull();
  });
});

describe("PATCH /api/mobile/v1/device", () => {
  test("updates push token", async () => {
    const reg = await registerDevice();
    const res = await app.request("/api/mobile/v1/device", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${reg.token}`,
      },
      body: JSON.stringify({ pushToken: "fcm-token-xyz" }),
    });
    expect(res.status).toBe(200);
    const device = db.getDeviceById(reg.id);
    expect(device!.push_token).toBe("fcm-token-xyz");
  });

  test("updates name", async () => {
    const reg = await registerDevice("Old");
    const res = await app.request("/api/mobile/v1/device", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${reg.token}`,
      },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string };
    expect(body.name).toBe("New Name");
  });
});

describe("GET /api/mobile/v1/message", () => {
  test("returns pending messages for device", async () => {
    const reg = await registerDevice();
    // Enqueue a message
    const user = db.getFirstUser()!;
    db.insertGatewayMessage({
      id: "gm1",
      userId: user.id,
      deviceId: reg.id,
      phoneNumbers: ["+1111"],
      text: "Hello",
      simNumber: 1,
    });

    const res = await app.request("/api/mobile/v1/message", {
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    expect(res.status).toBe(200);
    const messages = await res.json() as { id: string; message: string; phoneNumbers: string[] }[];
    expect(messages).toHaveLength(1);
    expect(messages[0]!.id).toBe("gm1");
    expect(messages[0]!.message).toBe("Hello");
    expect(messages[0]!.phoneNumbers).toEqual(["+1111"]);
  });

  test("returns empty when no pending", async () => {
    const reg = await registerDevice();
    const res = await app.request("/api/mobile/v1/message", {
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    expect(res.status).toBe(200);
    const messages = await res.json() as unknown[];
    expect(messages).toHaveLength(0);
  });
});

describe("PATCH /api/mobile/v1/message", () => {
  test("updates message state", async () => {
    const reg = await registerDevice();
    const user = db.getFirstUser()!;
    db.insertGatewayMessage({
      id: "gm1",
      userId: user.id,
      deviceId: reg.id,
      phoneNumbers: ["+1111"],
      text: "Hello",
    });

    const res = await app.request("/api/mobile/v1/message", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${reg.token}`,
      },
      body: JSON.stringify([
        {
          id: "gm1",
          state: "Sent",
          recipients: [{ phoneNumber: "+1111", state: "Sent" }],
        },
      ]),
    });
    expect(res.status).toBe(200);

    const msg = db.getGatewayMessage("gm1");
    expect(msg!.state).toBe("Sent");

    const recipients = db.getMessageRecipients("gm1");
    expect(recipients[0]!.state).toBe("Sent");
  });
});

describe("GET /api/mobile/v1/webhooks", () => {
  test("always includes self-referencing webhook", async () => {
    const reg = await registerDevice();
    const res = await app.request("/api/mobile/v1/webhooks", {
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    expect(res.status).toBe(200);
    const webhooks = await res.json() as { id: string; url: string; event: string }[];
    expect(webhooks.length).toBeGreaterThanOrEqual(1);
    const self = webhooks.find((w) => w.id === "self");
    expect(self).toBeDefined();
    expect(self!.url).toBe(`${PUBLIC_URL}/webhook`);
    expect(self!.event).toBe("sms:received");
  });
});

describe("GET /api/mobile/v1/settings", () => {
  test("returns settings with signing key", async () => {
    const reg = await registerDevice();
    const res = await app.request("/api/mobile/v1/settings", {
      headers: { Authorization: `Bearer ${reg.token}` },
    });
    expect(res.status).toBe(200);
    const settings = await res.json() as {
      messages: { processingOrder: string };
      webhooks: { signingKey: string };
    };
    expect(settings.messages.processingOrder).toBe("FIFO");
    expect(settings.webhooks.signingKey).toBe(SIGNING_KEY);
  });
});

describe("core routes still work in private mode", () => {
  test("GET /health", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe("ok");
  });

  test("POST /webhook processes incoming SMS", async () => {
    const res = await app.request("/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+15551234567",
          message: "Private mode test",
          receivedAt: "2024-01-15T10:30:00Z",
          simNumber: 1,
        },
        deviceId: "d",
        id: "w1",
        webhookId: "wh1",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; duplicate: boolean };
    expect(body.duplicate).toBe(false);
  });
});

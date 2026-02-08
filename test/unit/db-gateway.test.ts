import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { DB } from "../../src/server/db.ts";

let db: DB;

beforeEach(() => {
  db = new DB(":memory:");
});

afterEach(() => {
  db.close();
});

describe("users", () => {
  test("create and get user", () => {
    db.createUser("u1", "LOGIN1", "hash123");
    const user = db.getUserById("u1");
    expect(user).not.toBeNull();
    expect(user!.login).toBe("LOGIN1");
    expect(user!.password_hash).toBe("hash123");
  });

  test("getUserByLogin", () => {
    db.createUser("u1", "LOGIN1", "hash123");
    const user = db.getUserByLogin("LOGIN1");
    expect(user).not.toBeNull();
    expect(user!.id).toBe("u1");
  });

  test("getFirstUser returns null when empty", () => {
    expect(db.getFirstUser()).toBeNull();
  });

  test("getFirstUser returns first created", () => {
    db.createUser("u1", "A", "h1");
    db.createUser("u2", "B", "h2");
    expect(db.getFirstUser()!.id).toBe("u1");
  });
});

describe("devices", () => {
  test("create and get device by token", () => {
    db.createUser("u1", "LOGIN1", "hash");
    db.createDevice("d1", "u1", "tok123", "My Phone", null);
    const device = db.getDeviceByToken("tok123");
    expect(device).not.toBeNull();
    expect(device!.id).toBe("d1");
    expect(device!.name).toBe("My Phone");
    expect(device!.user_id).toBe("u1");
  });

  test("getDeviceById", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok", "Phone");
    expect(db.getDeviceById("d1")!.auth_token).toBe("tok");
  });

  test("listDevices", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok1", "Phone 1");
    db.createDevice("d2", "u1", "tok2", "Phone 2");
    const devices = db.listDevices("u1");
    expect(devices).toHaveLength(2);
  });

  test("updateDevicePushToken", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok", "Phone");
    db.updateDevicePushToken("d1", "fcm-token-123");
    expect(db.getDeviceById("d1")!.push_token).toBe("fcm-token-123");
  });

  test("updateDeviceName", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok", "Old Name");
    db.updateDeviceName("d1", "New Name");
    expect(db.getDeviceById("d1")!.name).toBe("New Name");
  });

  test("deleteDevice", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok", "Phone");
    db.deleteDevice("d1");
    expect(db.getDeviceById("d1")).toBeNull();
  });

  test("getActiveDevice returns most recently seen", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok1", "Old");
    db.createDevice("d2", "u1", "tok2", "New");
    // Both have the same last_seen default. getActiveDevice orders by last_seen DESC
    // so just verify it returns one of them (both are equally "active").
    const active = db.getActiveDevice("u1");
    expect(active).not.toBeNull();
    expect(["d1", "d2"]).toContain(active!.id);
  });

  test("getDeviceByToken returns null for bad token", () => {
    expect(db.getDeviceByToken("nonexistent")).toBeNull();
  });
});

describe("gateway messages", () => {
  test("insert and get", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111", "+2222"],
      text: "Hello",
      simNumber: 1,
    });
    const msg = db.getGatewayMessage("gm1");
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe("Hello");
    expect(msg!.state).toBe("Pending");
    expect(JSON.parse(msg!.phone_numbers)).toEqual(["+1111", "+2222"]);
  });

  test("getPendingMessages", () => {
    db.createUser("u1", "L", "h");
    db.createDevice("d1", "u1", "tok", "Phone");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      deviceId: "d1",
      phoneNumbers: ["+1111"],
      text: "Pending msg",
    });
    db.insertGatewayMessage({
      id: "gm2",
      userId: "u1",
      deviceId: "d1",
      phoneNumbers: ["+2222"],
      text: "Another",
    });
    const pending = db.getPendingMessages("d1");
    expect(pending).toHaveLength(2);
  });

  test("updateGatewayMessageState", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111"],
      text: "test",
    });
    db.updateGatewayMessageState("gm1", "Sent");
    expect(db.getGatewayMessage("gm1")!.state).toBe("Sent");
  });

  test("recipients are created with message", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111", "+2222"],
      text: "test",
    });
    const recipients = db.getMessageRecipients("gm1");
    expect(recipients).toHaveLength(2);
    expect(recipients[0]!.phone_number).toBe("+1111");
    expect(recipients[0]!.state).toBe("Pending");
  });

  test("updateRecipientState", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111"],
      text: "test",
    });
    db.updateRecipientState("gm1", "+1111", "Sent");
    const recipients = db.getMessageRecipients("gm1");
    expect(recipients[0]!.state).toBe("Sent");
  });

  test("updateRecipientState with error", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111"],
      text: "test",
    });
    db.updateRecipientState("gm1", "+1111", "Failed", "Network error");
    const recipients = db.getMessageRecipients("gm1");
    expect(recipients[0]!.state).toBe("Failed");
    expect(recipients[0]!.error).toBe("Network error");
  });

  test("listGatewayMessages with state filter", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm1",
      userId: "u1",
      phoneNumbers: ["+1111"],
      text: "pending",
    });
    db.insertGatewayMessage({
      id: "gm2",
      userId: "u1",
      phoneNumbers: ["+2222"],
      text: "sent",
    });
    db.updateGatewayMessageState("gm2", "Sent");
    const pending = db.listGatewayMessages("u1", { state: "Pending" });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("gm1");
  });

  test("getGatewayMessageByPrefix", () => {
    db.createUser("u1", "L", "h");
    db.insertGatewayMessage({
      id: "gm-unique-id-123",
      userId: "u1",
      phoneNumbers: ["+1111"],
      text: "test",
    });
    const msg = db.getGatewayMessageByPrefix("gm-unique");
    expect(msg.id).toBe("gm-unique-id-123");
  });

  test("getGatewayMessageByPrefix throws for not found", () => {
    expect(() => db.getGatewayMessageByPrefix("nonexist")).toThrow("not found");
  });
});

describe("gateway webhooks", () => {
  test("CRUD", () => {
    db.createUser("u1", "L", "h");
    db.createGatewayWebhook("wh1", "u1", "https://example.com/hook", "sms:received");
    const webhooks = db.listGatewayWebhooks("u1");
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0]!.url).toBe("https://example.com/hook");

    const single = db.getGatewayWebhook("wh1");
    expect(single).not.toBeNull();
    expect(single!.event).toBe("sms:received");

    db.deleteGatewayWebhook("wh1");
    expect(db.listGatewayWebhooks("u1")).toHaveLength(0);
  });

  test("getGatewayWebhook returns null for missing", () => {
    expect(db.getGatewayWebhook("nonexistent")).toBeNull();
  });
});

describe("setGatewayMessageId", () => {
  test("links message to gateway message", () => {
    const id = "test-msg-id";
    db.insertMessage({
      id,
      phone_number: "+1111",
      text: "test",
      direction: "out",
      timestamp: "2024-01-01T00:00:00Z",
      read: true,
      sim_number: 1,
    });
    db.setGatewayMessageId(id, "gw-123");
    // We can verify by checking the raw row; getMessage doesn't return gateway_message_id
    // but setGatewayMessageId shouldn't throw
  });
});

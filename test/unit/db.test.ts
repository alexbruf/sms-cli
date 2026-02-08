import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { DB } from "../../src/server/db.ts";
import { messageId } from "../../src/shared/hash.ts";
import type { Message } from "../../src/shared/types.ts";

let db: DB;

function makeMsg(overrides: Partial<Message> = {}): Message {
  const phone = overrides.phone_number ?? "+15551234567";
  const text = overrides.text ?? "hello";
  const timestamp = overrides.timestamp ?? "2024-01-15T10:30:00Z";
  const direction = overrides.direction ?? "in";
  return {
    id: messageId(phone, text, timestamp, direction),
    phone_number: phone,
    text,
    direction,
    timestamp,
    read: overrides.read ?? false,
    sim_number: overrides.sim_number ?? 1,
  };
}

beforeEach(() => {
  db = new DB(":memory:");
});

afterEach(() => {
  db.close();
});

describe("insertMessage / getMessage", () => {
  test("inserts and retrieves a message", () => {
    const msg = makeMsg();
    expect(db.insertMessage(msg)).toBe(true);
    const got = db.getMessage(msg.id);
    expect(got).not.toBeNull();
    expect(got!.phone_number).toBe("+15551234567");
    expect(got!.text).toBe("hello");
    expect(got!.direction).toBe("in");
    expect(got!.read).toBe(false);
  });

  test("dedup: inserting same message twice returns false", () => {
    const msg = makeMsg();
    expect(db.insertMessage(msg)).toBe(true);
    expect(db.insertMessage(msg)).toBe(false);
  });

  test("getMessage returns null for missing ID", () => {
    expect(db.getMessage("nonexistent")).toBeNull();
  });
});

describe("getMessageByPrefix", () => {
  test("resolves unique prefix", () => {
    const msg = makeMsg();
    db.insertMessage(msg);
    const got = db.getMessageByPrefix(msg.id.slice(0, 8));
    expect(got.id).toBe(msg.id);
  });

  test("throws for not found", () => {
    expect(() => db.getMessageByPrefix("xxxxxxxx")).toThrow("Message not found");
  });

  test("throws for ambiguous prefix", () => {
    // Insert two messages with different content to get different IDs
    const msg1 = makeMsg({ text: "aaa" });
    const msg2 = makeMsg({ text: "bbb" });
    db.insertMessage(msg1);
    db.insertMessage(msg2);
    // A single char prefix is likely ambiguous
    // We test with empty prefix which matches everything
    expect(() => db.getMessageByPrefix("")).toThrow("Ambiguous");
  });
});

describe("listMessages", () => {
  test("returns messages ordered by timestamp desc", () => {
    db.insertMessage(makeMsg({ text: "first", timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "second", timestamp: "2024-01-02T00:00:00Z" }));
    const msgs = db.listMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.text).toBe("second");
    expect(msgs[1]!.text).toBe("first");
  });

  test("filters by direction", () => {
    db.insertMessage(makeMsg({ text: "incoming", direction: "in" }));
    db.insertMessage(makeMsg({ text: "outgoing", direction: "out" }));
    const msgs = db.listMessages({ direction: "out" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("outgoing");
  });

  test("filters by unread", () => {
    db.insertMessage(makeMsg({ text: "unread", read: false, timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "read", read: true, timestamp: "2024-01-02T00:00:00Z" }));
    const msgs = db.listMessages({ unread: true });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("unread");
  });

  test("filters by phone", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "a" }));
    db.insertMessage(makeMsg({ phone_number: "+2222", text: "b" }));
    const msgs = db.listMessages({ phone: "+1111" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.phone_number).toBe("+1111");
  });

  test("respects limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      db.insertMessage(makeMsg({ text: `msg${i}`, timestamp: `2024-01-0${i + 1}T00:00:00Z` }));
    }
    const msgs = db.listMessages({ limit: 2, offset: 1 });
    expect(msgs).toHaveLength(2);
  });
});

describe("markRead / markUnread", () => {
  test("toggles read status", () => {
    const msg = makeMsg({ read: false });
    db.insertMessage(msg);
    expect(db.getMessage(msg.id)!.read).toBe(false);
    db.markRead(msg.id);
    expect(db.getMessage(msg.id)!.read).toBe(true);
    db.markUnread(msg.id);
    expect(db.getMessage(msg.id)!.read).toBe(false);
  });
});

describe("deleteMessage", () => {
  test("removes a message", () => {
    const msg = makeMsg();
    db.insertMessage(msg);
    db.deleteMessage(msg.id);
    expect(db.getMessage(msg.id)).toBeNull();
  });
});

describe("conversations", () => {
  test("getConversations groups by phone with counts", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "a", direction: "in", read: false, timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "b", direction: "in", read: false, timestamp: "2024-01-02T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+2222", text: "c", direction: "in", read: true, timestamp: "2024-01-03T00:00:00Z" }));

    const convos = db.getConversations();
    expect(convos).toHaveLength(2);
    // Sorted by last_message_at DESC
    expect(convos[0]!.phone_number).toBe("+2222");
    expect(convos[0]!.unread_count).toBe(0);
    expect(convos[1]!.phone_number).toBe("+1111");
    expect(convos[1]!.unread_count).toBe(2);
    expect(convos[1]!.message_count).toBe(2);
  });

  test("getConversations includes contact name", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "hi" }));
    db.upsertContact("+1111", "Alice");
    const convos = db.getConversations();
    expect(convos[0]!.name).toBe("Alice");
  });

  test("getConversation returns thread in order", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "first", timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "second", timestamp: "2024-01-02T00:00:00Z" }));
    const thread = db.getConversation("+1111");
    expect(thread).toHaveLength(2);
    expect(thread[0]!.text).toBe("first");
    expect(thread[1]!.text).toBe("second");
  });

  test("markConversationRead marks all incoming as read", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "a", direction: "in", read: false, timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "b", direction: "out", read: true, timestamp: "2024-01-02T00:00:00Z" }));
    db.markConversationRead("+1111");
    const thread = db.getConversation("+1111");
    expect(thread.every((m) => m.read)).toBe(true);
  });
});

describe("search", () => {
  test("finds messages by text", () => {
    db.insertMessage(makeMsg({ text: "hello world", timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "goodbye", timestamp: "2024-01-02T00:00:00Z" }));
    const results = db.search("hello");
    expect(results).toHaveLength(1);
    expect(results[0]!.text).toBe("hello world");
  });

  test("search is case-insensitive (SQLite LIKE)", () => {
    db.insertMessage(makeMsg({ text: "Hello World" }));
    const results = db.search("hello");
    expect(results).toHaveLength(1);
  });
});

describe("contacts", () => {
  test("CRUD operations", () => {
    db.upsertContact("+1111", "Alice");
    expect(db.getContact("+1111")!.name).toBe("Alice");

    const all = db.listContacts();
    expect(all).toHaveLength(1);

    db.upsertContact("+1111", "Alice Updated");
    expect(db.getContact("+1111")!.name).toBe("Alice Updated");

    db.deleteContact("+1111");
    expect(db.getContact("+1111")).toBeNull();
  });
});

describe("counts", () => {
  test("getUnreadCount and getTotalCount", () => {
    db.insertMessage(makeMsg({ text: "a", read: false, timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "b", read: true, timestamp: "2024-01-02T00:00:00Z" }));
    expect(db.getUnreadCount()).toBe(1);
    expect(db.getTotalCount()).toBe(2);
  });

  test("counts are zero on empty db", () => {
    expect(db.getUnreadCount()).toBe(0);
    expect(db.getTotalCount()).toBe(0);
  });

  test("outgoing read messages don't count as unread", () => {
    db.insertMessage(makeMsg({ text: "sent", direction: "out", read: true }));
    expect(db.getUnreadCount()).toBe(0);
    expect(db.getTotalCount()).toBe(1);
  });
});

describe("listMessages - combined filters", () => {
  test("filters by direction + unread together", () => {
    db.insertMessage(makeMsg({ text: "in-unread", direction: "in", read: false, timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "in-read", direction: "in", read: true, timestamp: "2024-01-02T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "out-read", direction: "out", read: true, timestamp: "2024-01-03T00:00:00Z" }));

    const msgs = db.listMessages({ direction: "in", unread: true });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("in-unread");
  });

  test("filters by phone + direction together", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "in", direction: "in", timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "out", direction: "out", timestamp: "2024-01-02T00:00:00Z" }));
    db.insertMessage(makeMsg({ phone_number: "+2222", text: "in-other", direction: "in", timestamp: "2024-01-03T00:00:00Z" }));

    const msgs = db.listMessages({ phone: "+1111", direction: "in" });
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toBe("in");
  });

  test("returns empty list when no matches", () => {
    db.insertMessage(makeMsg({ direction: "in" }));
    const msgs = db.listMessages({ direction: "out" });
    expect(msgs).toHaveLength(0);
  });
});

describe("search - edge cases", () => {
  test("returns empty array for no matches", () => {
    db.insertMessage(makeMsg({ text: "hello" }));
    const results = db.search("goodbye");
    expect(results).toHaveLength(0);
  });

  test("matches partial text", () => {
    db.insertMessage(makeMsg({ text: "hello world foo bar" }));
    const results = db.search("world foo");
    expect(results).toHaveLength(1);
  });

  test("searches across multiple messages", () => {
    db.insertMessage(makeMsg({ text: "hello alice", timestamp: "2024-01-01T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "hello bob", timestamp: "2024-01-02T00:00:00Z" }));
    db.insertMessage(makeMsg({ text: "goodbye", timestamp: "2024-01-03T00:00:00Z" }));
    const results = db.search("hello");
    expect(results).toHaveLength(2);
  });
});

describe("conversations - edge cases", () => {
  test("getConversation returns empty for unknown phone", () => {
    const thread = db.getConversation("+9999");
    expect(thread).toHaveLength(0);
  });

  test("getConversations with no contacts returns null name", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "hi" }));
    const convos = db.getConversations();
    expect(convos[0]!.name).toBeNull();
  });

  test("markConversationRead is idempotent", () => {
    db.insertMessage(makeMsg({ phone_number: "+1111", text: "a", direction: "in", read: true }));
    db.markConversationRead("+1111");
    const msg = db.getConversation("+1111")[0];
    expect(msg!.read).toBe(true);
  });
});

describe("contacts - edge cases", () => {
  test("listContacts returns sorted by name", () => {
    db.upsertContact("+2222", "Zoe");
    db.upsertContact("+1111", "Alice");
    db.upsertContact("+3333", "Mike");
    const contacts = db.listContacts();
    expect(contacts[0]!.name).toBe("Alice");
    expect(contacts[1]!.name).toBe("Mike");
    expect(contacts[2]!.name).toBe("Zoe");
  });

  test("getContact returns null for missing", () => {
    expect(db.getContact("+9999")).toBeNull();
  });

  test("deleteContact on missing phone is no-op", () => {
    db.deleteContact("+9999");
    expect(db.listContacts()).toHaveLength(0);
  });
});

describe("deleteMessage - edge cases", () => {
  test("deleteMessage on missing ID is no-op", () => {
    db.deleteMessage("nonexistent");
    expect(db.getTotalCount()).toBe(0);
  });
});

describe("markRead / markUnread - edge cases", () => {
  test("markRead on already-read message is idempotent", () => {
    const msg = makeMsg({ read: true });
    db.insertMessage(msg);
    db.markRead(msg.id);
    expect(db.getMessage(msg.id)!.read).toBe(true);
  });

  test("markUnread on already-unread message is idempotent", () => {
    const msg = makeMsg({ read: false });
    db.insertMessage(msg);
    db.markUnread(msg.id);
    expect(db.getMessage(msg.id)!.read).toBe(false);
  });
});

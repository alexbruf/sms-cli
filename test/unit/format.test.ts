import { test, expect, describe } from "bun:test";
import {
  shortId,
  truncate,
  formatTime,
  formatMessageRow,
  formatMessageList,
  formatConversationList,
  formatThread,
  formatContactList,
} from "../../src/cli/format.ts";
import type { Message, Conversation, Contact } from "../../src/shared/types.ts";

describe("shortId", () => {
  test("returns first 8 chars", () => {
    expect(shortId("abcdef0123456789abcdef0123456789")).toBe("abcdef01");
  });
});

describe("truncate", () => {
  test("shortens long strings", () => {
    expect(truncate("hello world", 5)).toBe("hell…");
  });
  test("returns short strings unchanged", () => {
    expect(truncate("hi", 10)).toBe("hi");
  });
  test("handles exact length", () => {
    expect(truncate("exact", 5)).toBe("exact");
  });
});

describe("formatTime", () => {
  test("returns time for today", () => {
    const now = new Date();
    now.setHours(now.getHours() - 1);
    const result = formatTime(now.toISOString());
    // Should contain a colon (time format like 10:30)
    expect(result).toContain(":");
  });

  test("returns 'Yesterday' for yesterday", () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(12);
    expect(formatTime(d.toISOString())).toBe("Yesterday");
  });

  test("returns short date for old messages", () => {
    const result = formatTime("2023-06-15T10:00:00Z");
    expect(result.length).toBeGreaterThan(0);
  });
});

const sampleMsg: Message = {
  id: "abcdef0123456789abcdef0123456789",
  phone_number: "+15551234567",
  text: "Hello there!",
  direction: "in",
  timestamp: "2024-01-15T10:30:00Z",
  read: false,
  sim_number: 1,
};

describe("formatMessageRow", () => {
  test("includes short ID, arrow, phone, and text", () => {
    const row = formatMessageRow(sampleMsg);
    expect(row).toContain("abcdef01");
    expect(row).toContain("+15551234567");
    expect(row).toContain("Hello there!");
  });

  test("shows ● for unread", () => {
    const row = formatMessageRow(sampleMsg);
    expect(row).toContain("●");
  });

  test("no ● for read messages", () => {
    const row = formatMessageRow({ ...sampleMsg, read: true });
    expect(row).not.toContain("●");
  });
});

describe("formatMessageList", () => {
  test("formats multiple messages", () => {
    const output = formatMessageList([sampleMsg]);
    expect(output).toContain("abcdef01");
  });

  test("returns dim text for empty list", () => {
    const output = formatMessageList([]);
    expect(output).toContain("No messages");
  });
});

describe("formatConversationList", () => {
  test("formats conversations", () => {
    const convos: Conversation[] = [
      {
        phone_number: "+15551234567",
        name: "Alice",
        message_count: 5,
        unread_count: 2,
        last_message_at: "2024-01-15T10:30:00Z",
        last_message: "Hey!",
      },
    ];
    const output = formatConversationList(convos);
    expect(output).toContain("Alice");
    expect(output).toContain("(2)");
  });

  test("returns dim text for empty list", () => {
    expect(formatConversationList([])).toContain("No conversations");
  });
});

describe("formatThread", () => {
  test("shows conversation header and messages", () => {
    const msgs: Message[] = [
      { ...sampleMsg, direction: "in", text: "Hi" },
      { ...sampleMsg, id: "xyz", direction: "out", text: "Hey" },
    ];
    const output = formatThread(msgs, "+15551234567", "Alice");
    expect(output).toContain("Conversation with +15551234567 (Alice)");
    expect(output).toContain("Hi");
    expect(output).toContain("Hey");
    expect(output).toContain("─");
  });
});

describe("formatContactList", () => {
  test("formats contacts", () => {
    const contacts: Contact[] = [
      { phone_number: "+15551234567", name: "Alice" },
    ];
    const output = formatContactList(contacts);
    expect(output).toContain("Alice");
    expect(output).toContain("+15551234567");
  });

  test("returns dim text for empty list", () => {
    expect(formatContactList([])).toContain("No contacts");
  });

  test("formats multiple contacts", () => {
    const contacts: Contact[] = [
      { phone_number: "+1111", name: "Alice" },
      { phone_number: "+2222", name: "Bob" },
    ];
    const output = formatContactList(contacts);
    expect(output).toContain("Alice");
    expect(output).toContain("Bob");
  });
});

describe("formatMessageRow - edge cases", () => {
  test("uses contact name when provided", () => {
    const row = formatMessageRow(sampleMsg, "John Doe");
    expect(row).toContain("John Doe");
    expect(row).not.toContain("+15551234567");
  });

  test("falls back to phone when no contact name", () => {
    const row = formatMessageRow(sampleMsg, null);
    expect(row).toContain("+15551234567");
  });

  test("truncates long messages", () => {
    const longMsg = { ...sampleMsg, text: "A".repeat(100) };
    const row = formatMessageRow(longMsg);
    expect(row).toContain("…");
  });

  test("shows → for outgoing messages", () => {
    const outMsg = { ...sampleMsg, direction: "out" as const };
    const row = formatMessageRow(outMsg);
    expect(row).toContain("→");
  });

  test("replaces newlines in message text", () => {
    const multiline = { ...sampleMsg, text: "line1\nline2\nline3" };
    const row = formatMessageRow(multiline);
    expect(row).not.toContain("\n");
  });
});

describe("formatThread - edge cases", () => {
  test("shows header without contact name", () => {
    const msgs: Message[] = [
      { ...sampleMsg, direction: "in", text: "Hi" },
    ];
    const output = formatThread(msgs, "+15551234567");
    expect(output).toContain("Conversation with +15551234567");
    expect(output).not.toContain("(");
  });

  test("shows empty thread with just header", () => {
    const output = formatThread([], "+15551234567");
    expect(output).toContain("Conversation with +15551234567");
  });
});

describe("formatConversationList - edge cases", () => {
  test("shows phone number when no contact name", () => {
    const convos: Conversation[] = [
      {
        phone_number: "+15551234567",
        name: null,
        message_count: 1,
        unread_count: 0,
        last_message_at: "2024-01-15T10:30:00Z",
        last_message: "Hi",
      },
    ];
    const output = formatConversationList(convos);
    expect(output).toContain("+15551234567");
  });

  test("shows no unread indicator when count is 0", () => {
    const convos: Conversation[] = [
      {
        phone_number: "+1111",
        name: "Alice",
        message_count: 5,
        unread_count: 0,
        last_message_at: "2024-01-15T10:30:00Z",
        last_message: "Hi",
      },
    ];
    const output = formatConversationList(convos);
    expect(output).not.toContain("(0)");
  });
});

describe("truncate - edge cases", () => {
  test("handles empty string", () => {
    expect(truncate("", 10)).toBe("");
  });

  test("handles max=1", () => {
    expect(truncate("hello", 1)).toBe("…");
  });
});

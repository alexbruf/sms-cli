import { test, expect } from "bun:test";
import { messageId } from "../../src/shared/hash.ts";

test("produces a 32-char hex string", () => {
  const id = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  expect(id).toHaveLength(32);
  expect(id).toMatch(/^[0-9a-f]{32}$/);
});

test("is deterministic", () => {
  const a = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  const b = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  expect(a).toBe(b);
});

test("different inputs produce different hashes", () => {
  const a = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  const b = messageId("+15559876543", "hello", "2024-01-15T10:30:00Z", "in");
  expect(a).not.toBe(b);
});

test("different directions produce different hashes", () => {
  const a = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  const b = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "out");
  expect(a).not.toBe(b);
});

test("different timestamps produce different hashes", () => {
  const a = messageId("+15551234567", "hello", "2024-01-15T10:30:00Z", "in");
  const b = messageId("+15551234567", "hello", "2024-01-15T10:31:00Z", "in");
  expect(a).not.toBe(b);
});

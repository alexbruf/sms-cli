import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { startServer, stopServer, runCli } from "./helpers.ts";
import { join } from "path";

const PORT = 15556;
const DB_PATH = join(import.meta.dir, ".test-cli.db");

beforeAll(async () => {
  await startServer(PORT, DB_PATH);
  // Seed some data via webhook
  await fetch(`http://localhost:${PORT}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      event: "sms:received",
      payload: {
        phoneNumber: "+15551234567",
        message: "CLI test message",
        receivedAt: "2024-01-15T10:30:00Z",
        simNumber: 1,
      },
      deviceId: "d",
      id: "w1",
      webhookId: "wh1",
    }),
  });
  // Add a contact
  await fetch(`http://localhost:${PORT}/contacts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "+15551234567", name: "Test User" }),
  });
});

afterAll(() => {
  stopServer();
});

const env = { SMS_SERVER_URL: `http://localhost:${PORT}` };

describe("sms CLI", () => {
  test("sms (no args) shows unread count", async () => {
    const { stdout, code } = await runCli([], env);
    expect(code).toBe(0);
    expect(stdout).toContain("unread");
  });

  test("sms --help shows all commands", async () => {
    const { stdout, code } = await runCli(["--help"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("conversations");
    expect(stdout).toContain("read");
    expect(stdout).toContain("send");
    expect(stdout).toContain("reply");
    expect(stdout).toContain("mark-read");
    expect(stdout).toContain("mark-unread");
    expect(stdout).toContain("delete");
    expect(stdout).toContain("search");
    expect(stdout).toContain("contact");
  });

  test("sms --version", async () => {
    const { stdout, code } = await runCli(["--version"], env);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("1.0.0");
  });

  test("sms list shows messages", async () => {
    const { stdout, code } = await runCli(["list"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("CLI test message");
  });

  test("sms list --unread shows only unread", async () => {
    const { stdout, code } = await runCli(["list", "--unread"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("CLI test message");
  });

  test("sms conversations lists threads", async () => {
    const { stdout, code } = await runCli(["conversations"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("Test User");
  });

  test("sms conv alias works", async () => {
    const { stdout, code } = await runCli(["conv"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("Test User");
  });

  test("sms read +phone shows conversation", async () => {
    const { stdout, code } = await runCli(
      ["read", "+15551234567", "--no-mark"],
      env,
    );
    expect(code).toBe(0);
    expect(stdout).toContain("Conversation with +15551234567");
    expect(stdout).toContain("CLI test message");
  });

  test("sms search finds messages", async () => {
    const { stdout, code } = await runCli(["search", "CLI test"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("CLI test message");
    expect(stdout).toContain("result");
  });

  test("sms contact --list shows contacts", async () => {
    const { stdout, code } = await runCli(["contact", "--list"], env);
    expect(code).toBe(0);
    expect(stdout).toContain("Test User");
    expect(stdout).toContain("+15551234567");
  });

  test("sms contact --add and --delete", async () => {
    const { code: addCode } = await runCli(
      ["contact", "--add", "+19998887777", "New Contact"],
      env,
    );
    expect(addCode).toBe(0);

    const { stdout: listOut } = await runCli(["contact", "--list"], env);
    expect(listOut).toContain("New Contact");

    const { code: delCode } = await runCli(
      ["contact", "--delete", "+19998887777"],
      env,
    );
    expect(delCode).toBe(0);
  });

  test("sms mark-read marks a message", async () => {
    // Get the message ID first
    const res = await fetch(
      `http://localhost:${PORT}/messages?phone=%2B15551234567`,
    );
    const msgs = (await res.json()) as { id: string }[];
    const id = msgs[0]!.id.slice(0, 8);

    const { code } = await runCli(["mark-read", id], env);
    expect(code).toBe(0);

    // Verify
    const check = await fetch(`http://localhost:${PORT}/messages/${id}`);
    const msg = (await check.json()) as { read: boolean };
    expect(msg.read).toBe(true);
  });

  test("sms mark-unread marks a message", async () => {
    const res = await fetch(
      `http://localhost:${PORT}/messages?phone=%2B15551234567`,
    );
    const msgs = (await res.json()) as { id: string }[];
    const id = msgs[0]!.id.slice(0, 8);

    const { code } = await runCli(["mark-unread", id], env);
    expect(code).toBe(0);
  });

  test("sms delete --force deletes a message", async () => {
    // Seed a disposable message
    await fetch(`http://localhost:${PORT}/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "sms:received",
        payload: {
          phoneNumber: "+10000000000",
          message: "delete me",
          receivedAt: "2024-06-01T00:00:00Z",
          simNumber: 1,
        },
        deviceId: "d",
        id: "w-del",
        webhookId: "wh-del",
      }),
    });
    const listRes = await fetch(
      `http://localhost:${PORT}/messages?phone=%2B10000000000`,
    );
    const msgs = (await listRes.json()) as { id: string }[];
    const id = msgs[0]!.id.slice(0, 8);

    const { code } = await runCli(["delete", "--force", id], env);
    expect(code).toBe(0);

    const check = await fetch(`http://localhost:${PORT}/messages/${id}`);
    expect(check.status).toBe(404);
  });
});

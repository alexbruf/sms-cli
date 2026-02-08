import { Hono } from "hono";
import type { Env } from "../app.ts";
import { messageId } from "../../shared/hash.ts";
import type { WebhookPayload } from "../../shared/types.ts";

export function webhookRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.post("/webhook", async (c) => {
    const db = c.var.db;
    let body: WebhookPayload;
    try {
      const raw = await c.req.text();
      console.log(`[webhook] POST /webhook raw=${raw.slice(0, 500)}`);
      body = JSON.parse(raw);
    } catch (e) {
      console.log(`[webhook] parse error: ${e}`);
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (body.event !== "sms:received") {
      console.log(`[webhook] ignoring event: ${body.event}`);
      return c.json({ ignored: true, reason: `unhandled event: ${body.event}` });
    }

    const { phoneNumber, message, receivedAt, simNumber } = body.payload;
    const id = messageId(phoneNumber, message, receivedAt, "in");

    const inserted = db.insertMessage({
      id,
      phone_number: phoneNumber,
      text: message,
      direction: "in",
      timestamp: receivedAt,
      read: false,
      sim_number: simNumber ?? 1,
    });

    if (inserted) {
      console.log(`Received SMS from ${phoneNumber}: ${message.slice(0, 50)}`);
    }

    return c.json({ id, duplicate: !inserted });
  });

  return routes;
}

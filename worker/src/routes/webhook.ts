import { Hono } from "hono";
import type { Env } from "../app.ts";
import { messageId } from "../hash.ts";
import type { WebhookPayload } from "../types.ts";

export function webhookRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.post("/webhook", async (c) => {
    const db = c.var.db;
    let body: WebhookPayload;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (body.event !== "sms:received") {
      return c.json({ ignored: true, reason: `unhandled event: ${body.event}` });
    }

    const { phoneNumber, message, receivedAt, simNumber } = body.payload;
    const id = await messageId(phoneNumber, message, receivedAt, "in");

    const inserted = await db.insertMessage({
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

      // Fan out to registered 3rd-party webhooks
      const webhooks = await db.getWebhooksByEvent("sms:received");
      if (webhooks.length > 0) {
        const payload = JSON.stringify(body);
        await Promise.allSettled(
          webhooks.map((wh) =>
            fetch(wh.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: payload,
            })
          )
        );
      }
    }

    return c.json({ id, duplicate: !inserted });
  });

  return routes;
}

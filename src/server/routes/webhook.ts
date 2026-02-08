import { Hono } from "hono";
import type { Env } from "../app.ts";
import { messageId } from "../../shared/hash.ts";
import type { WebhookPayload } from "../../shared/types.ts";

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function webhookRoutes(signingKey: string): Hono<Env> {
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

      // Fan out to registered 3rd-party webhooks
      const webhooks = db.getWebhooksByEvent("sms:received");
      if (webhooks.length > 0) {
        const payload = JSON.stringify(body);
        const signature = signingKey
          ? await signPayload(payload, signingKey)
          : "";
        Promise.allSettled(
          webhooks.map((wh) =>
            fetch(wh.url, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(signature && { "X-Webhook-Signature": `sha256=${signature}` }),
              },
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

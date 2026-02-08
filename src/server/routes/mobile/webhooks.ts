import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth } from "../../middleware/device-auth.ts";

export function mobileWebhookRoutes(publicUrl: string): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /api/mobile/v1/webhooks — return webhook configs for device
  routes.get("/webhooks", deviceAuth, (c) => {
    const user = c.var.user!;
    const db = c.var.db;

    const userWebhooks = db.listGatewayWebhooks(user.id);

    // Always include the self-referencing webhook so the Android app
    // POSTs received SMS back to our existing /webhook endpoint
    const selfWebhook = {
      id: "self",
      url: `${publicUrl.replace(/\/$/, "")}/webhook`,
      event: "sms:received",
    };

    const webhooks = [
      selfWebhook,
      ...userWebhooks.map((w) => ({
        id: w.id,
        url: w.url,
        event: w.event,
      })),
    ];

    return c.json(webhooks);
  });

  return routes;
}

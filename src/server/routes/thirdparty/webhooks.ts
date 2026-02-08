import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { userAuth } from "../../middleware/user-auth.ts";
import { newId } from "../../../shared/id.ts";
import type { GatewayWebhookCreateRequest } from "../../../shared/gateway-types.ts";

export function thirdpartyWebhookRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /3rdparty/v1/webhooks — list webhooks
  routes.get("/webhooks", userAuth, (c) => {
    const user = c.var.user!;
    const db = c.var.db;
    const webhooks = db.listGatewayWebhooks(user.id);
    return c.json(
      webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        event: w.event,
      }))
    );
  });

  // POST /3rdparty/v1/webhooks — create a webhook
  routes.post("/webhooks", userAuth, async (c) => {
    const user = c.var.user!;
    const db = c.var.db;

    let body: GatewayWebhookCreateRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (!body.url || !body.event) {
      return c.json({ error: "url and event are required" }, 400);
    }

    const id = newId();
    db.createGatewayWebhook(id, user.id, body.url, body.event);

    return c.json({ id, url: body.url, event: body.event }, 201);
  });

  // DELETE /3rdparty/v1/webhooks/:id — delete a webhook
  routes.delete("/webhooks/:id", userAuth, (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    const wh = db.getGatewayWebhook(id);
    if (!wh) {
      return c.json({ error: "Webhook not found" }, 404);
    }
    db.deleteGatewayWebhook(id);
    return c.body(null, 204);
  });

  return routes;
}

import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth } from "../../middleware/device-auth.ts";
import type { MobilePatchMessageRequest } from "../../gateway-types.ts";

export function mobileMessageRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /api/mobile/v1/message -- return pending outgoing messages for this device
  routes.get("/message", deviceAuth, async (c) => {
    const device = c.var.device!;
    const db = c.var.db;
    const order = (c.req.query("order")?.toUpperCase() === "LIFO" ? "LIFO" : "FIFO") as "FIFO" | "LIFO";

    const pending = await db.getPendingMessages(device.id, order);
    const messages = pending.map((m) => ({
      id: m.id,
      message: m.text,
      phoneNumbers: JSON.parse(m.phone_numbers) as string[],
      simNumber: m.sim_number,
      withDeliveryReport: !!m.with_delivery_report,
      isEncrypted: !!m.is_encrypted,
      ...(m.valid_until ? { validUntil: m.valid_until } : {}),
    }));

    return c.json(messages);
  });

  // PATCH /api/mobile/v1/message -- device reports delivery status
  routes.patch("/message", deviceAuth, async (c) => {
    const device = c.var.device!;
    const db = c.var.db;

    let body: MobilePatchMessageRequest[];
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (!Array.isArray(body)) {
      return c.json({ error: "Expected array of state updates" }, 400);
    }

    for (const update of body) {
      const msg = await db.getGatewayMessage(update.id);
      if (!msg) continue;

      await db.updateGatewayMessageState(update.id, update.state, device.id);

      if (update.recipients) {
        for (const r of update.recipients) {
          await db.updateRecipientState(
            update.id,
            r.phoneNumber,
            r.state,
            r.error
          );
        }
      }
    }

    return c.json({ updated: body.length });
  });

  return routes;
}

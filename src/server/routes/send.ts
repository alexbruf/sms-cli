import { Hono } from "hono";
import type { Env } from "../app.ts";
import { messageId } from "../../shared/hash.ts";

export function sendRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.post("/send", async (c) => {
    const db = c.var.db;
    const gateway = c.var.gateway;

    let body: { phone?: string; text?: string; sim?: number };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (!body.phone || !body.text) {
      return c.json({ error: "phone and text are required" }, 400);
    }

    let gatewayMessageId: string;
    try {
      gatewayMessageId = await gateway.send([body.phone], body.text, body.sim ?? 1);
    } catch (e: unknown) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        502
      );
    }

    const timestamp = new Date().toISOString();
    const id = messageId(body.phone, body.text, timestamp, "out");
    const msg = {
      id,
      phone_number: body.phone,
      text: body.text,
      direction: "out" as const,
      timestamp,
      read: true,
      sim_number: body.sim ?? 1,
    };
    db.insertMessage(msg);

    // Link to gateway message if in private mode
    if (gatewayMessageId) {
      db.setGatewayMessageId(id, gatewayMessageId);
    }

    return c.json(msg, 201);
  });

  return routes;
}

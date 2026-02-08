import { Hono } from "hono";
import type { Env } from "../app.ts";

export function conversationRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/conversations", async (c) => {
    const db = c.var.db;
    return c.json(await db.getConversations());
  });

  routes.get("/conversations/:phone", async (c) => {
    const db = c.var.db;
    const phone = c.req.param("phone");
    const messages = await db.getConversation(phone);
    if (messages.length === 0) {
      return c.json({ error: "No messages for this number" }, 404);
    }
    return c.json(messages);
  });

  routes.post("/conversations/:phone/read", async (c) => {
    const db = c.var.db;
    const phone = c.req.param("phone");
    await db.markConversationRead(phone);
    return c.body(null, 204);
  });

  return routes;
}

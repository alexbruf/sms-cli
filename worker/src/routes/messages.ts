import { Hono } from "hono";
import type { Env } from "../app.ts";
import type { Direction } from "../types.ts";

export function messageRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/messages", async (c) => {
    const db = c.var.db;
    const direction = c.req.query("direction") as Direction | undefined;
    const unreadParam = c.req.query("unread");
    const phone = c.req.query("phone");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const messages = await db.listMessages({
      direction: direction ?? undefined,
      unread: unreadParam !== undefined ? unreadParam === "true" : undefined,
      phone: phone ?? undefined,
      limit,
      offset,
    });
    return c.json(messages);
  });

  routes.get("/messages/:id", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    try {
      const msg = await db.getMessageByPrefix(id);
      return c.json(msg);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      const status = message.includes("not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

  routes.post("/messages/:id/read", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    try {
      const msg = await db.getMessageByPrefix(id);
      await db.markRead(msg.id);
      return c.body(null, 204);
    } catch (e: unknown) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        404
      );
    }
  });

  routes.post("/messages/:id/unread", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    try {
      const msg = await db.getMessageByPrefix(id);
      await db.markUnread(msg.id);
      return c.body(null, 204);
    } catch (e: unknown) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        404
      );
    }
  });

  routes.delete("/messages/:id", async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    try {
      const msg = await db.getMessageByPrefix(id);
      await db.deleteMessage(msg.id);
      return c.body(null, 204);
    } catch (e: unknown) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        404
      );
    }
  });

  return routes;
}

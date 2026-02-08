import { Hono } from "hono";
import type { Env } from "../app.ts";

export function healthRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/health", async (c) => {
    const db = c.var.db;
    return c.json({
      status: "ok",
      unread_count: await db.getUnreadCount(),
      total_messages: await db.getTotalCount(),
    });
  });

  return routes;
}

import { Hono } from "hono";
import type { Env } from "../app.ts";

export function healthRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/health", (c) => {
    const db = c.var.db;
    return c.json({
      status: "ok",
      unread_count: db.getUnreadCount(),
      total_messages: db.getTotalCount(),
    });
  });

  return routes;
}

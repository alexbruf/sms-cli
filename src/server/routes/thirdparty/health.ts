import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";

export function thirdpartyHealthRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

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

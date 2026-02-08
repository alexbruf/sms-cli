import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";

export function thirdpartyHealthRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

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

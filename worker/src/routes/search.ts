import { Hono } from "hono";
import type { Env } from "../app.ts";

export function searchRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/search", async (c) => {
    const db = c.var.db;
    const q = c.req.query("q");
    if (!q) {
      return c.json({ error: "q parameter is required" }, 400);
    }
    const messages = await db.search(q);
    return c.json({ messages, total: messages.length });
  });

  return routes;
}

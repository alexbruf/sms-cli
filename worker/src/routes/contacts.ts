import { Hono } from "hono";
import type { Env } from "../app.ts";

export function contactRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/contacts", async (c) => {
    const db = c.var.db;
    return c.json(await db.listContacts());
  });

  routes.post("/contacts", async (c) => {
    const db = c.var.db;
    let body: { phone?: string; name?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    if (!body.phone || !body.name) {
      return c.json({ error: "phone and name are required" }, 400);
    }

    await db.upsertContact(body.phone, body.name);
    return c.body(null, 201);
  });

  routes.delete("/contacts/:phone", async (c) => {
    const db = c.var.db;
    const phone = c.req.param("phone");
    await db.deleteContact(phone);
    return c.body(null, 204);
  });

  return routes;
}

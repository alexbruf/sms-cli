import { Hono } from "hono";
import type { Env } from "../app.ts";

export function contactRoutes(): Hono<Env> {
  const routes = new Hono<Env>();

  routes.get("/contacts", (c) => {
    const db = c.var.db;
    return c.json(db.listContacts());
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

    db.upsertContact(body.phone, body.name);
    return c.body(null, 201);
  });

  routes.delete("/contacts/:phone", (c) => {
    const db = c.var.db;
    const phone = c.req.param("phone");
    db.deleteContact(phone);
    return c.body(null, 204);
  });

  return routes;
}

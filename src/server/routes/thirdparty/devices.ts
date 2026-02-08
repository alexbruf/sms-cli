import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { userAuth } from "../../middleware/user-auth.ts";

export function thirdpartyDeviceRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /3rdparty/v1/devices — list registered devices
  routes.get("/devices", userAuth, (c) => {
    const user = c.var.user!;
    const db = c.var.db;
    const devices = db.listDevices(user.id);
    return c.json(
      devices.map((d) => ({
        id: d.id,
        name: d.name,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        lastSeen: d.last_seen,
      }))
    );
  });

  // DELETE /3rdparty/v1/devices/:id — delete a device
  routes.delete("/devices/:id", userAuth, (c) => {
    const db = c.var.db;
    const id = c.req.param("id");
    const device = db.getDeviceById(id);
    if (!device) {
      return c.json({ error: "Device not found" }, 404);
    }
    db.deleteDevice(id);
    return c.body(null, 204);
  });

  return routes;
}

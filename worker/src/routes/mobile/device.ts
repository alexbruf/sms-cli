import { hash } from "bcryptjs";
import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth, tryDeviceAuth } from "../../middleware/device-auth.ts";
import { newId, newToken, newLogin, newPassword } from "../../id.ts";

export function mobileDeviceRoutes(privateToken: string): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // POST /api/mobile/v1/device -- register a new device
  routes.post("/device", async (c) => {
    const serverKey = c.req.header("ServerKey");
    const auth = c.req.header("Authorization");
    const validServerKey = serverKey === privateToken;
    const validBearer = auth === `Bearer ${privateToken}`;
    if (!validServerKey && !validBearer) {
      return c.json({ message: "Unauthorized" }, 401);
    }

    let body: { name?: string; pushToken?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      // empty body is fine
    }

    const db = c.var.db;

    let user = await db.getFirstUser();
    const login = user ? user.login : newLogin();
    const password = newPassword();
    const passwordHash = await hash(password, 10);

    if (!user) {
      const userId = newId();
      await db.createUser(userId, login, passwordHash);
      user = (await db.getUserById(userId))!;
    }

    const deviceId = newId();
    const authToken = newToken();
    await db.createDevice(deviceId, user.id, authToken, body.name ?? "", body.pushToken ?? null);

    return c.json({
      id: deviceId,
      token: authToken,
      login,
      password,
    });
  });

  // GET /api/mobile/v1/device -- get current device info
  routes.get("/device", tryDeviceAuth, (c) => {
    const device = c.var.device;
    const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "";
    if (!device) {
      return c.json({ externalIP: ip, device: null });
    }
    return c.json({
      externalIP: ip,
      device: {
        id: device.id,
        name: device.name,
        createdAt: device.created_at,
        updatedAt: device.updated_at,
        lastSeen: device.last_seen,
      },
    });
  });

  // PATCH /api/mobile/v1/device -- update device (push token, name)
  routes.patch("/device", deviceAuth, async (c) => {
    const device = c.var.device!;
    const db = c.var.db;

    let body: { id?: string; name?: string; pushToken?: string } = {};
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: "Invalid JSON" }, 400);
    }

    if (body.pushToken !== undefined) {
      await db.updateDevicePushToken(device.id, body.pushToken);
    }
    if (body.name !== undefined) {
      await db.updateDeviceName(device.id, body.name);
    }

    const updated = (await db.getDeviceById(device.id))!;
    return c.json({
      id: updated.id,
      name: updated.name,
      createdAt: updated.created_at,
      updatedAt: updated.updated_at,
      lastSeen: updated.last_seen,
    });
  });

  return routes;
}

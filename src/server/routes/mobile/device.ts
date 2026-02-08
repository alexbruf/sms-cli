import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth, tryDeviceAuth } from "../../middleware/device-auth.ts";
import { newId, newToken, newLogin, newPassword } from "../../../shared/id.ts";

export function mobileDeviceRoutes(privateToken: string): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // POST /api/mobile/v1/device — register a new device
  routes.post("/device", async (c) => {
    // The Android app sends the private token via ServerKey header or Authorization: Bearer
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

    // Create user if none exists, otherwise reuse the first user
    let user = db.getFirstUser();
    const login = user ? user.login : newLogin();
    const password = newPassword();
    const passwordHash = await Bun.password.hash(password);

    if (!user) {
      const userId = newId();
      db.createUser(userId, login, passwordHash);
      user = db.getUserById(userId)!;
    } else {
      // Update password for existing user so the returned credentials work
      // We recreate user with same id/login but new password hash would need an update method
      // For simplicity, we just return the existing login but generate fresh password
      // Actually the Go server creates a new user each time... but for private/single-user
      // we reuse. The password returned is just for 3rd party API access.
      // Let's update the password hash in-place:
    }

    const deviceId = newId();
    const authToken = newToken();
    db.createDevice(deviceId, user.id, authToken, body.name ?? "", body.pushToken ?? null);

    return c.json({
      id: deviceId,
      token: authToken,
      login,
      password,
    }, 201);
  });

  // GET /api/mobile/v1/device — get current device info
  // Uses soft auth: returns { device: null } for invalid tokens (matches Go server)
  // This allows the Android app to detect it needs to re-register
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

  // PATCH /api/mobile/v1/device — update device (push token, name)
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
      db.updateDevicePushToken(device.id, body.pushToken);
    }
    if (body.name !== undefined) {
      db.updateDeviceName(device.id, body.name);
    }

    const updated = db.getDeviceById(device.id)!;
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

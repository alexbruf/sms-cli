import type { Context, Next } from "hono";
import type { PrivateEnv } from "../app.ts";

/**
 * Soft device auth: tries to resolve device from Bearer token.
 * If token is missing or invalid, continues without setting device.
 * Matches Go server's deviceauth.New() behavior.
 */
export async function tryDeviceAuth(c: Context<PrivateEnv>, next: Next) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return next();
  }

  const token = auth.slice(7);
  const db = c.var.db;
  const device = await db.getDeviceByToken(token);
  if (!device) {
    return next();
  }

  await db.updateDeviceLastSeen(device.id);
  c.set("device", device);

  const user = await db.getUserById(device.user_id);
  if (user) c.set("user", user);

  await next();
}

/**
 * Hard device auth: requires a valid Bearer token.
 * Returns 401 if token is missing or invalid.
 */
export async function deviceAuth(c: Context<PrivateEnv>, next: Next) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  const token = auth.slice(7);
  const db = c.var.db;
  const device = await db.getDeviceByToken(token);
  if (!device) {
    return c.json({ message: "Unauthorized" }, 401);
  }

  await db.updateDeviceLastSeen(device.id);
  c.set("device", device);

  const user = await db.getUserById(device.user_id);
  if (user) c.set("user", user);

  await next();
}

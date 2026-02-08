import { compare } from "bcryptjs";
import type { Context, Next } from "hono";
import type { PrivateEnv } from "../app.ts";

export async function userAuth(c: Context<PrivateEnv>, next: Next) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Basic ")) {
    c.header("WWW-Authenticate", 'Basic realm="sms-server"');
    return c.json({ error: "Missing or invalid Authorization header" }, 401);
  }

  const decoded = atob(auth.slice(6));
  const colon = decoded.indexOf(":");
  if (colon === -1) {
    return c.json({ error: "Invalid credentials format" }, 401);
  }

  const login = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  const db = c.var.db;
  const user = await db.getUserByLogin(login);
  if (!user) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const valid = await compare(password, user.password_hash);
  if (!valid) {
    return c.json({ error: "Invalid credentials" }, 401);
  }

  c.set("user", user);
  await next();
}

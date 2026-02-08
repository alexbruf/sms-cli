import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { userAuth } from "../../middleware/user-auth.ts";
import type {
  ThirdPartySendRequest,
  ProcessingState,
} from "../../gateway-types.ts";

export function thirdpartyMessageRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // POST /3rdparty/v1/messages -- enqueue a message for sending
  routes.post("/messages", userAuth, async (c) => {
    const user = c.var.user!;
    const db = c.var.db;
    const gateway = c.var.gateway;

    let body: ThirdPartySendRequest;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON" }, 400);
    }

    const text = body.textMessage?.text ?? body.message;
    if (!text || !body.phoneNumbers?.length) {
      return c.json({ error: "phoneNumbers and message text are required" }, 400);
    }

    try {
      const msgId = await gateway.send(body.phoneNumbers, text, body.simNumber ?? 1);

      const gwMsg = await db.getGatewayMessage(msgId);
      const recipients = await db.getMessageRecipients(msgId);

      return c.json({
        id: msgId,
        state: gwMsg?.state ?? "Pending",
        isHashed: false,
        isEncrypted: false,
        recipients: recipients.map((r) => ({
          phoneNumber: r.phone_number,
          state: r.state,
          error: r.error ?? undefined,
        })),
      }, 201);
    } catch (e: unknown) {
      return c.json(
        { error: e instanceof Error ? e.message : String(e) },
        502
      );
    }
  });

  // GET /3rdparty/v1/messages -- list messages
  routes.get("/messages", userAuth, async (c) => {
    const user = c.var.user!;
    const db = c.var.db;

    const state = c.req.query("state") as ProcessingState | undefined;
    const limit = parseInt(c.req.query("limit") ?? "20", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const messages = await db.listGatewayMessages(user.id, { state, limit, offset });
    const result = [];
    for (const m of messages) {
      const recipients = await db.getMessageRecipients(m.id);
      result.push({
        id: m.id,
        state: m.state,
        isHashed: false,
        isEncrypted: !!m.is_encrypted,
        recipients: recipients.map((r) => ({
          phoneNumber: r.phone_number,
          state: r.state,
          error: r.error ?? undefined,
        })),
      });
    }
    return c.json(result);
  });

  // GET /3rdparty/v1/messages/:id -- get single message
  routes.get("/messages/:id", userAuth, async (c) => {
    const db = c.var.db;
    const id = c.req.param("id");

    let msg;
    try {
      msg = await db.getGatewayMessageByPrefix(id);
    } catch {
      return c.json({ error: "Message not found" }, 404);
    }

    const recipients = await db.getMessageRecipients(msg.id);
    return c.json({
      id: msg.id,
      state: msg.state,
      isHashed: false,
      isEncrypted: !!msg.is_encrypted,
      recipients: recipients.map((r) => ({
        phoneNumber: r.phone_number,
        state: r.state,
        error: r.error ?? undefined,
      })),
    });
  });

  return routes;
}

import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth } from "../../middleware/device-auth.ts";

export function mobileEventRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /api/mobile/v1/events — stub for SSE endpoint
  // The Android app expects an SSE stream. We can't do true SSE on Workers,
  // but we can check for pending messages and return a single SSE event
  // that triggers the app to poll /message.
  routes.get("/events", deviceAuth, async (c) => {
    const device = c.var.device!;
    const db = c.var.db;

    const pending = await db.getPendingMessages(device.id);

    if (pending.length > 0) {
      // Return SSE-formatted event to trigger message fetch
      const body = `event: MessageEnqueued\ndata: {"id":"${pending[0]!.id}"}\n\n`;
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    // No pending messages — return empty SSE with a retry hint
    return new Response("retry: 30000\n\n", {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });

  return routes;
}

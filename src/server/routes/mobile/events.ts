import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth } from "../../middleware/device-auth.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;

export function mobileEventRoutes(): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /api/mobile/v1/events — SSE stream for device notifications
  routes.get("/events", deviceAuth, (c) => {
    const device = c.var.device!;
    const eventBus = c.var.eventBus!;

    return streamSSE(c, async (stream) => {
      let alive = true;

      const unsubscribe = eventBus.subscribe(device.id, (event) => {
        if (alive) {
          stream.writeSSE({ event: event.event, data: event.data }).catch(() => {
            alive = false;
          });
        }
      });

      // Heartbeat
      const heartbeat = setInterval(() => {
        if (!alive) return;
        stream.writeSSE({ event: "ping", data: "" }).catch(() => {
          alive = false;
        });
      }, HEARTBEAT_INTERVAL_MS);

      // Wait until client disconnects
      stream.onAbort(() => {
        alive = false;
        clearInterval(heartbeat);
        unsubscribe();
      });

      // Keep the stream open until aborted
      while (alive) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
  });

  return routes;
}

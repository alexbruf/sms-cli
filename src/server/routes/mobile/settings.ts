import { Hono } from "hono";
import type { PrivateEnv } from "../../app.ts";
import { deviceAuth } from "../../middleware/device-auth.ts";
import type { DeviceSettings } from "../../../shared/gateway-types.ts";

export function mobileSettingsRoutes(webhookSigningKey: string): Hono<PrivateEnv> {
  const routes = new Hono<PrivateEnv>();

  // GET /api/mobile/v1/settings — return device settings
  routes.get("/settings", deviceAuth, (c) => {
    const settings: DeviceSettings = {
      messages: {
        processingOrder: "FIFO",
      },
      ping: {
        intervalSeconds: 30,
      },
      webhooks: {
        signingKey: webhookSigningKey,
        retryCount: 3,
        retryIntervalSeconds: 10,
      },
    };
    return c.json(settings);
  });

  return routes;
}

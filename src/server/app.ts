import { Hono } from "hono";
import type { DB } from "./db.ts";
import type { ISmsGateway } from "./gateway.ts";
import type { EventBus } from "./event-bus.ts";
import type { DbUser, DbDevice } from "../shared/gateway-types.ts";
import type { GatewayMode } from "../shared/config.ts";
import { healthRoutes } from "./routes/health.ts";
import { messageRoutes } from "./routes/messages.ts";
import { sendRoutes } from "./routes/send.ts";
import { conversationRoutes } from "./routes/conversations.ts";
import { contactRoutes } from "./routes/contacts.ts";
import { webhookRoutes } from "./routes/webhook.ts";
import { searchRoutes } from "./routes/search.ts";
import { mobileDeviceRoutes } from "./routes/mobile/device.ts";
import { mobileMessageRoutes } from "./routes/mobile/messages.ts";
import { mobileEventRoutes } from "./routes/mobile/events.ts";
import { mobileWebhookRoutes } from "./routes/mobile/webhooks.ts";
import { mobileSettingsRoutes } from "./routes/mobile/settings.ts";
import { thirdpartyMessageRoutes } from "./routes/thirdparty/messages.ts";
import { thirdpartyDeviceRoutes } from "./routes/thirdparty/devices.ts";
import { thirdpartyWebhookRoutes } from "./routes/thirdparty/webhooks.ts";
import { thirdpartyHealthRoutes } from "./routes/thirdparty/health.ts";

export type Env = {
  Variables: {
    db: DB;
    gateway: ISmsGateway;
  };
};

export type PrivateEnv = {
  Variables: {
    db: DB;
    gateway: ISmsGateway;
    eventBus: EventBus;
    device?: DbDevice;
    user?: DbUser;
  };
};

export interface AppOptions {
  db: DB;
  gateway: ISmsGateway;
  gatewayMode?: GatewayMode;
  eventBus?: EventBus;
  privateToken?: string;
  publicUrl?: string;
  webhookSigningKey?: string;
}

export function createApp(opts: AppOptions): Hono<Env> {
  const { db, gateway, gatewayMode = "proxy" } = opts;
  const app = new Hono<Env>();

  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("gateway", gateway);
    await next();
  });

  // Core routes (always available)
  app.route("/", healthRoutes());
  app.route("/", messageRoutes());
  app.route("/", sendRoutes());
  app.route("/", conversationRoutes());
  app.route("/", contactRoutes());
  app.route("/", webhookRoutes());
  app.route("/", searchRoutes());

  // Private mode routes
  if (gatewayMode === "private" && opts.eventBus && opts.privateToken && opts.publicUrl) {
    const privateApp = new Hono<PrivateEnv>();

    privateApp.use("*", async (c, next) => {
      c.set("db", db);
      c.set("gateway", gateway);
      c.set("eventBus", opts.eventBus!);
      await next();
    });

    // Mobile API (Android app)
    const mobileApp = new Hono<PrivateEnv>();
    mobileApp.route("/", mobileDeviceRoutes(opts.privateToken));
    mobileApp.route("/", mobileMessageRoutes());
    mobileApp.route("/", mobileEventRoutes());
    mobileApp.route("/", mobileWebhookRoutes(opts.publicUrl));
    mobileApp.route("/", mobileSettingsRoutes(opts.webhookSigningKey ?? ""));
    privateApp.route("/api/mobile/v1", mobileApp);

    // 3rd-party API
    const thirdpartyApp = new Hono<PrivateEnv>();
    thirdpartyApp.route("/", thirdpartyMessageRoutes());
    thirdpartyApp.route("/", thirdpartyDeviceRoutes());
    thirdpartyApp.route("/", thirdpartyWebhookRoutes());
    thirdpartyApp.route("/", thirdpartyHealthRoutes());
    privateApp.route("/3rdparty/v1", thirdpartyApp);

    app.route("/", privateApp as unknown as Hono<Env>);
  }

  return app;
}

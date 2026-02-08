#!/usr/bin/env bun
import { getServerConfig } from "../shared/config.ts";
import { DB } from "./db.ts";
import { ProxyGateway, PrivateGateway } from "./gateway.ts";
import { EventBus } from "./event-bus.ts";
import { UpstreamPushClient } from "./push.ts";
import { createApp } from "./app.ts";
import { newToken } from "../shared/id.ts";

const config = getServerConfig();
const db = new DB(config.dbPath);

let app;

if (config.gatewayMode === "private") {
  if (!config.privateToken) {
    console.error("Error: PRIVATE_TOKEN is required in private mode");
    process.exit(1);
  }
  if (!config.publicUrl) {
    console.error("Error: PUBLIC_URL is required in private mode");
    process.exit(1);
  }

  const webhookSigningKey = config.webhookSigningKey || newToken();
  const eventBus = new EventBus();
  const pushClient = new UpstreamPushClient();
  const gateway = new PrivateGateway(db, eventBus, pushClient);

  app = createApp({
    db,
    gateway,
    gatewayMode: "private",
    eventBus,
    privateToken: config.privateToken,
    publicUrl: config.publicUrl,
    webhookSigningKey,
  });

  console.log("Gateway mode: private");
  if (config.webhookSigningKey) {
    console.log("Webhook signing: enabled (from env)");
  } else {
    console.log(`Webhook signing: enabled (auto-generated key: ${webhookSigningKey.slice(0, 8)}...)`);
  }
} else {
  if (!config.asgEndpoint) {
    console.error("Error: ASG_ENDPOINT is required in proxy mode");
    process.exit(1);
  }

  const gateway = new ProxyGateway(
    config.asgEndpoint,
    config.asgUsername,
    config.asgPassword,
  );
  app = createApp({ db, gateway, gatewayMode: "proxy" });
  console.log("Gateway mode: proxy");
}

const server = Bun.serve({
  port: config.port,
  fetch: app.fetch,
  idleTimeout: 255, // max value; needed for SSE long-polling connections
});

console.log(`sms-server listening on http://localhost:${server.port}`);

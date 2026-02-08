import { DB } from "./db.ts";
import { PrivateGateway, ProxyGateway, type ISmsGateway } from "./gateway.ts";
import { UpstreamPushClient } from "./push.ts";
import { createApp } from "./app.ts";

export interface Bindings {
  DB: D1Database;
  GATEWAY_MODE: string;
  PRIVATE_TOKEN: string;
  PUBLIC_URL: string;
  WEBHOOK_SIGNING_KEY: string;
  // Proxy mode (optional)
  ASG_ENDPOINT?: string;
  ASG_USERNAME?: string;
  ASG_PASSWORD?: string;
}

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const db = new DB(env.DB);
    const pushClient = new UpstreamPushClient();

    let gateway: ISmsGateway;
    if (env.GATEWAY_MODE === "proxy" && env.ASG_ENDPOINT && env.ASG_USERNAME && env.ASG_PASSWORD) {
      gateway = new ProxyGateway(env.ASG_ENDPOINT, env.ASG_USERNAME, env.ASG_PASSWORD);
    } else {
      gateway = new PrivateGateway(db, pushClient);
    }

    const app = createApp({
      db,
      gateway,
      privateToken: env.PRIVATE_TOKEN ?? "",
      publicUrl: env.PUBLIC_URL ?? "",
      webhookSigningKey: env.WEBHOOK_SIGNING_KEY ?? "",
    });

    return app.fetch(request, env);
  },
};

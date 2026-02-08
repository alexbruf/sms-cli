import type { UpstreamPushPayload } from "./gateway-types.ts";

const UPSTREAM_URL = "https://api.sms-gate.app/upstream/v1/push";

export class UpstreamPushClient {
  async send(pushToken: string, event: string, data?: Record<string, unknown>): Promise<void> {
    const payload: UpstreamPushPayload[] = [{ token: pushToken, event, data }];
    const res = await fetch(UPSTREAM_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`Upstream push failed (${res.status}): ${body}`);
    }
  }
}

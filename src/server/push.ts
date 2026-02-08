import type { UpstreamPushPayload } from "../shared/gateway-types.ts";

const UPSTREAM_URL = "https://api.sms-gate.app/upstream/v1/push";
const DEBOUNCE_MS = 5000;

export class UpstreamPushClient {
  private pending = new Map<string, NodeJS.Timeout>();

  /**
   * Send a push notification to a device via the upstream relay.
   * Debounces per-device: batches rapid enqueues into a single push
   * (min 5s between pushes to the same device).
   */
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

  /**
   * Debounced push: if called multiple times for the same device within 5s,
   * only the last call fires.
   */
  sendDebounced(pushToken: string, event: string, data?: Record<string, unknown>): void {
    const existing = this.pending.get(pushToken);
    if (existing) clearTimeout(existing);
    this.pending.set(
      pushToken,
      setTimeout(() => {
        this.pending.delete(pushToken);
        this.send(pushToken, event, data).catch(() => {});
      }, DEBOUNCE_MS),
    );
  }

  /** Clear all pending debounced pushes (for cleanup). */
  clearAll(): void {
    for (const timer of this.pending.values()) {
      clearTimeout(timer);
    }
    this.pending.clear();
  }
}

import type { DB } from "./db.ts";
import type { EventBus } from "./event-bus.ts";
import type { UpstreamPushClient } from "./push.ts";
import { newId } from "../shared/id.ts";

export interface ISmsGateway {
  send(phoneNumbers: string[], text: string, simNumber?: number): Promise<string>;
}

/** Proxies to an external SMS Gateway server (original mode). */
export class ProxyGateway implements ISmsGateway {
  private baseUrl: string;
  private authHeader: string;

  constructor(endpoint: string, username: string, password: string) {
    this.baseUrl = endpoint.replace(/\/$/, "");
    this.authHeader = "Basic " + btoa(`${username}:${password}`);
  }

  async send(
    phoneNumbers: string[],
    text: string,
    simNumber: number = 1,
  ): Promise<string> {
    const url = `${this.baseUrl}/3rdparty/v1/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.authHeader,
      },
      body: JSON.stringify({
        textMessage: { text },
        phoneNumbers,
        simNumber,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SMS Gateway error ${res.status}: ${body}`);
    }
    // Proxy mode doesn't track gateway message IDs internally
    return "";
  }
}

/** Enqueues messages directly for a registered Android device (private mode). */
export class PrivateGateway implements ISmsGateway {
  constructor(
    private db: DB,
    private eventBus: EventBus,
    private pushClient: UpstreamPushClient,
  ) {}

  async send(
    phoneNumbers: string[],
    text: string,
    simNumber: number = 1,
  ): Promise<string> {
    // Find a user (single-user private mode)
    const user = this.db.getFirstUser();
    if (!user) throw new Error("No registered device. Register a device first.");

    // Find the most recently active device
    const device = this.db.getActiveDevice(user.id);

    const msgId = newId();
    this.db.insertGatewayMessage({
      id: msgId,
      userId: user.id,
      deviceId: device?.id,
      phoneNumbers,
      text,
      simNumber,
    });

    // Notify the device
    if (device) {
      // 1. Push via upstream relay if device has a push token
      if (device.push_token) {
        this.pushClient.sendDebounced(
          device.push_token,
          "PushMessageEnqueued",
          {}
        );
      }
      // 2. Always notify via EventBus (for active SSE connections)
      this.eventBus.publish(device.id, {
        event: "MessageEnqueued",
        data: JSON.stringify({ id: msgId }),
      });
    }

    return msgId;
  }
}

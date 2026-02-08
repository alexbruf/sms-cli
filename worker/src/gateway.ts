import type { DB } from "./db.ts";
import type { UpstreamPushClient } from "./push.ts";
import { newId } from "./id.ts";

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
    return "";
  }
}

/** Enqueues messages directly for a registered Android device (private mode). */
export class PrivateGateway implements ISmsGateway {
  constructor(
    private db: DB,
    private pushClient: UpstreamPushClient,
  ) {}

  async send(
    phoneNumbers: string[],
    text: string,
    simNumber: number = 1,
  ): Promise<string> {
    const user = await this.db.getFirstUser();
    if (!user) throw new Error("No registered device. Register a device first.");

    const device = await this.db.getActiveDevice(user.id);

    const msgId = newId();
    await this.db.insertGatewayMessage({
      id: msgId,
      userId: user.id,
      deviceId: device?.id,
      phoneNumbers,
      text,
      simNumber,
    });

    // Push via upstream relay if device has a push token
    if (device?.push_token) {
      await this.pushClient.send(device.push_token, "PushMessageEnqueued", {});
    }

    return msgId;
  }
}

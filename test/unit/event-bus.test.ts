import { test, expect, describe } from "bun:test";
import { EventBus } from "../../src/server/event-bus.ts";
import type { SseEvent } from "../../src/shared/gateway-types.ts";

describe("EventBus", () => {
  test("subscribe and publish", () => {
    const bus = new EventBus();
    const received: SseEvent[] = [];
    bus.subscribe("d1", (e) => received.push(e));
    bus.publish("d1", { event: "test", data: "hello" });
    expect(received).toHaveLength(1);
    expect(received[0]!.event).toBe("test");
    expect(received[0]!.data).toBe("hello");
  });

  test("unsubscribe stops events", () => {
    const bus = new EventBus();
    const received: SseEvent[] = [];
    const unsub = bus.subscribe("d1", (e) => received.push(e));
    bus.publish("d1", { event: "a", data: "" });
    unsub();
    bus.publish("d1", { event: "b", data: "" });
    expect(received).toHaveLength(1);
  });

  test("publish to different device is ignored", () => {
    const bus = new EventBus();
    const received: SseEvent[] = [];
    bus.subscribe("d1", (e) => received.push(e));
    bus.publish("d2", { event: "test", data: "" });
    expect(received).toHaveLength(0);
  });

  test("multiple listeners receive events", () => {
    const bus = new EventBus();
    const r1: SseEvent[] = [];
    const r2: SseEvent[] = [];
    bus.subscribe("d1", (e) => r1.push(e));
    bus.subscribe("d1", (e) => r2.push(e));
    bus.publish("d1", { event: "test", data: "" });
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
  });

  test("listenerCount tracks subscriptions", () => {
    const bus = new EventBus();
    expect(bus.listenerCount("d1")).toBe(0);
    const unsub = bus.subscribe("d1", () => {});
    expect(bus.listenerCount("d1")).toBe(1);
    unsub();
    expect(bus.listenerCount("d1")).toBe(0);
  });
});

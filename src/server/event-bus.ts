import type { SseEvent } from "../shared/gateway-types.ts";

type Listener = (event: SseEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  /** Subscribe to events for a device. Returns an unsubscribe function. */
  subscribe(deviceId: string, listener: Listener): () => void {
    let set = this.listeners.get(deviceId);
    if (!set) {
      set = new Set();
      this.listeners.set(deviceId, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(deviceId);
    };
  }

  /** Publish an event to all listeners for a device. */
  publish(deviceId: string, event: SseEvent): void {
    const set = this.listeners.get(deviceId);
    if (!set) return;
    for (const listener of set) {
      listener(event);
    }
  }

  /** Number of active listeners for a device. */
  listenerCount(deviceId: string): number {
    return this.listeners.get(deviceId)?.size ?? 0;
  }
}

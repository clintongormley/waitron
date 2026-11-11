import { describe, expect, it, vi } from "vitest";
import { LiveEvents } from "./live-api.js";
import { publishState } from "./live-publish.js";

describe("state publication", () => {
  it("publishes the resource and absorbs a subscriber's throw", () => {
    const bus = new LiveEvents();
    const changes: unknown[] = [];
    const log = vi.fn();
    bus.subscribe((event) => {
      changes.push(event);
    });
    bus.subscribe(() => {
      throw new Error("subscriber failed");
    });
    expect(() => publishState(bus, "pairing", log)).not.toThrow();
    expect(changes).toEqual([{ kind: "change", change: { resources: [{ type: "pairing" }] } }]);
    expect(log).toHaveBeenCalledWith("warn", "live.publish_failed", { errorCode: "unknown" });
  });
});

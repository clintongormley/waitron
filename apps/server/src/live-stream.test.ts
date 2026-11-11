import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { LiveEvents } from "./live-api.js";
import { liveStreamResponse, type LiveStreamOptions } from "./live-stream.js";

function fixture(options: Partial<LiveStreamOptions> = {}) {
  const bus = new LiveEvents();
  const log = vi.fn();
  const app = new Hono();
  app.get("/events", (c) =>
    liveStreamResponse(c, {
      bus,
      interests: [{ type: "printers", id: "p1" }],
      recheck: async () => {},
      invalidCodes: new Set(["session.required"]),
      sendIds: true,
      log,
      ...options,
    }),
  );
  return { app, bus, log };
}
const text = (chunk: ReadableStreamReadResult<Uint8Array>) => new TextDecoder().decode(chunk.value);

describe("shared live stream", () => {
  it("filters types and ids and releases a closed bus", async () => {
    const { app, bus } = fixture();
    const response = await app.request("/events");
    const reader = response.body!.getReader();
    try {
      expect(text(await reader.read())).toBe("event: ready\ndata: {}\n\n");
      bus.publish({
        resources: [
          { type: "other" },
          { type: "printers", id: "p2" },
          { type: "printers", id: "p1" },
        ],
      });
      expect(text(await reader.read())).toBe(
        'event: change\ndata: [{"type":"printers","id":"p1"}]\n\n',
      );
      bus.close();
      expect((await reader.read()).done).toBe(true);
      expect(bus.subscriberCount).toBe(0);
    } finally {
      await reader.cancel();
    }
  });

  it("bounds more than 256 pending identities with one reset", async () => {
    const { app, bus } = fixture({ interests: [{ type: "printers" }] });
    const response = await app.request("/events");
    const reader = response.body!.getReader();
    try {
      await reader.read();
      bus.publish({
        resources: Array.from({ length: 257 }, (_, i) => ({ type: "printers", id: String(i) })),
      });
      expect(text(await reader.read())).toBe("event: reset\ndata: []\n\n");
      bus.publish({ resources: [{ type: "printers", id: "next" }] });
      expect(text(await reader.read())).toBe(
        'event: change\ndata: [{"type":"printers","id":"next"}]\n\n',
      );
    } finally {
      await reader.cancel();
    }
  });

  it("sends each matching type once without exposing ids", async () => {
    const { app, bus } = fixture({ interests: [{ type: "printers" }], sendIds: false });
    const response = await app.request("/events");
    const reader = response.body!.getReader();
    try {
      await reader.read();
      bus.publish({
        resources: [
          { type: "printers", id: "secret-a" },
          { type: "printers", id: "secret-b" },
        ],
      });
      expect(text(await reader.read())).toBe('event: change\ndata: [{"type":"printers"}]\n\n');
    } finally {
      await reader.cancel();
    }
  });

  it.each(["session.required", "storage.disk_full"] as const)(
    "ends a refused recheck: %s",
    async (code) => {
      const { app, bus, log } = fixture({
        recheck: async () => {
          throw new AppError(code, {});
        },
      });
      const response = await app.request("/events");
      const reader = response.body!.getReader();
      try {
        await reader.read();
        bus.publish({ resources: [{ type: "printers", id: "p1" }] });
        if (code === "session.required")
          expect(text(await reader.read())).toBe(
            'event: session-invalid\ndata: {"code":"session.required"}\n\n',
          );
        expect((await reader.read()).done).toBe(true);
        if (code === "storage.disk_full")
          expect(log).toHaveBeenCalledExactlyOnceWith("warn", "live.stream_failed", {
            errorCode: "storage.disk_full",
          });
      } finally {
        await reader.cancel();
      }
    },
  );
});

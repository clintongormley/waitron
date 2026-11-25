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

describe("catching up a management stream", () => {
  const ready = (chunk: ReadableStreamReadResult<Uint8Array>) => {
    const [, data, id] = /^event: ready\ndata: (.*)\nid: (.*)\n\n$/.exec(text(chunk)) ?? [];
    return { id, data: JSON.parse(data!) as unknown };
  };
  async function open(
    bus: LiveEvents,
    since: string | undefined,
    interests: LiveStreamOptions["interests"] = [{ type: "printers" }],
  ) {
    const app = new Hono();
    app.get("/events", (c) =>
      liveStreamResponse(c, {
        bus,
        interests,
        recheck: async () => {},
        invalidCodes: new Set(),
        sendIds: true,
        log: vi.fn(),
        catchUp: { since },
      }),
    );
    const reader = (await app.request("/events")).body!.getReader();
    return { reader, first: ready(await reader.read()) };
  }

  it("names each watched type that changed after the given position, and no other", async () => {
    const bus = new LiveEvents();
    bus.publish({ resources: [{ type: "courses", id: "before" }] });
    const since = bus.position;
    bus.publish({ resources: [{ type: "printers", id: "p1" }, { type: "unwatched" }] });
    bus.publish({ resources: [{ type: "printers", id: "p2" }] });
    const { reader, first } = await open(bus, since, [
      { type: "printers", id: "p9" },
      { type: "printers" },
      { type: "courses" },
    ]);
    try {
      expect(first).toEqual({ id: bus.position, data: { missed: [{ type: "printers" }] } });
    } finally {
      await reader.cancel();
    }
  });

  it("names nothing when nothing changed since", async () => {
    const bus = new LiveEvents();
    bus.publish({ resources: [{ type: "printers" }] });
    const { reader, first } = await open(bus, bus.position);
    try {
      expect(first).toEqual({ id: bus.position, data: { missed: [] } });
    } finally {
      await reader.cancel();
    }
  });

  it.each([
    ["none was given", () => undefined],
    ["it came from another run of the server", () => new LiveEvents().position],
    ["it has no number", (bus: LiveEvents) => bus.position.split(":")[0]!],
    ["its number is empty", (bus: LiveEvents) => `${bus.position.split(":")[0]!}:`],
    ["its number is not whole", (bus: LiveEvents) => `${bus.position.split(":")[0]!}:0.5`],
    ["it is ahead of the server", (bus: LiveEvents) => `${bus.position.split(":")[0]!}:2`],
    ["it is not a position", () => "nonsense"],
  ] as const)("does not claim to know what was missed when %s", async (_, position) => {
    const bus = new LiveEvents();
    bus.publish({ resources: [{ type: "printers" }] });
    const { reader, first } = await open(bus, position(bus));
    try {
      expect(first).toEqual({ id: bus.position, data: {} });
    } finally {
      await reader.cancel();
    }
  });

  it("stamps each change with a position that already covers it", async () => {
    const bus = new LiveEvents();
    const { reader } = await open(bus, undefined);
    try {
      bus.publish({ resources: [{ type: "printers", id: "p1" }] });
      const changed = text(await reader.read());
      expect(changed).toBe(
        `event: change\ndata: [{"type":"printers","id":"p1"}]\nid: ${bus.position}\n\n`,
      );
      const next = await open(bus, /id: (.*)/.exec(changed)![1]!);
      expect(next.first.data).toEqual({ missed: [] });
      await next.reader.cancel();
    } finally {
      await reader.cancel();
    }
  });

  it("stamps the position after a batch, not one a change still waiting has passed", async () => {
    const bus = new LiveEvents();
    let rechecking = false;
    let release = (): void => {};
    const app = new Hono();
    app.get("/events", (c) =>
      liveStreamResponse(c, {
        bus,
        interests: [{ type: "printers" }],
        recheck: () =>
          new Promise<void>((resolve) => {
            rechecking = true;
            release = resolve;
          }),
        invalidCodes: new Set(),
        sendIds: true,
        log: vi.fn(),
        catchUp: { since: undefined },
      }),
    );
    const reader = (await app.request("/events")).body!.getReader();
    try {
      await reader.read();
      bus.publish({ resources: [{ type: "printers", id: "p1" }] });
      await vi.waitFor(() => expect(rechecking).toBe(true));
      bus.publish({ resources: [{ type: "printers", id: "p2" }] });
      release();
      expect(text(await reader.read())).toBe(
        `event: change\ndata: [{"type":"printers","id":"p1"},{"type":"printers","id":"p2"}]\nid: ${bus.position}\n\n`,
      );
    } finally {
      release();
      await reader.cancel();
    }
  });
});

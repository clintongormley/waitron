import { afterEach, describe, expect, it, vi } from "vitest";
import * as diagnostics from "./index.js";
import type { TrailEvent } from "./log.js";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const ID = "00000000-0000-4000-8000-000000000001";
const CLIENT = {
  build: "abcdef0",
  locale: "en" as const,
  theme: "dark" as const,
  viewport: { width: 390, height: 844 },
  online: false,
  browser: "chromium" as const,
};
const event = (fields: TrailEvent["fields"] = {}, kind = "api", ago = 0): TrailEvent => ({
  at: new Date(+NOW - ago).toISOString(),
  level: "warn",
  event: kind,
  fields,
});
function capture(trail: TrailEvent[] = [], client = CLIENT, now = NOW) {
  const result = diagnostics.captureClientReport?.({
    app: "dashboard",
    trail,
    client,
    now,
    makeId: () => ID,
  });
  expect(result).toBeDefined();
  return result!;
}
const parsed = (text: string) => JSON.parse(text.split("```json\n")[1]!.split("\n```")[0]!);
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("local browser report", () => {
  it("copies and freezes opening facts without freezing its inputs", () => {
    const source = event({ phase: "end", path: "/api/sales/private", requestId: ID, status: 500 });
    const client = { ...CLIENT, viewport: { ...CLIENT.viewport } };
    const base = capture([source], client);
    source.fields.path = "/private/changed";
    client.build = "changed";
    client.viewport.width = 1;
    expect(base).toMatchObject({
      version: 1,
      id: ID,
      app: "dashboard",
      openedAt: NOW.toISOString(),
      truncated: false,
      trail: [{ fields: { path: "/api/sales/:id" } }],
      client: { build: "abcdef0", viewport: { width: 390 } },
    });
    expect(Object.isFrozen(base)).toBe(true);
    expect(Object.isFrozen(base.trail[0]!.fields)).toBe(true);
    expect(Object.isFrozen(base.client.viewport)).toBe(true);
    expect(Object.isFrozen(source)).toBe(false);
  });
  it("projects only allowed events and fields, canonical request IDs and codes", () => {
    const base = capture([
      event({
        phase: "end",
        method: "GET",
        path: "/api/persons/john.smith?token=secret",
        requestId: "john.smith",
        status: 500,
        code: "password.invalid",
        body: "secret",
        message: "private",
        origin: "https://private.test",
        stack: "private",
      }),
      event({ requestId: ID, code: "john.smith", error: "network" }),
      event({ screen: "private" }, "nav"),
      event({ name: "TypeError", message: "private", stack: "private" }, "window.error"),
      event({ code: "storage.disk_full" }, "disk_stop.load_failed"),
      event({ token: "secret" }, "arbitrary"),
    ]);
    expect(base.trail.map((row) => [row.event, row.fields])).toEqual([
      [
        "api",
        {
          phase: "end",
          method: "GET",
          path: "/api/persons/:id",
          status: 500,
          code: "password.invalid",
        },
      ],
      ["api", { requestId: ID, code: "unknown", error: "network" }],
      ["nav", {}],
      ["window.error", { name: "TypeError" }],
      ["disk_stop.load_failed", { code: "storage.disk_full" }],
    ]);
    expect(JSON.stringify(base)).not.toMatch(/john\.smith|secret|private/);
  });
  it("normalizes report metadata without copying extra client fields", () => {
    const client = Object.assign(
      { ...CLIENT },
      {
        build: "john.smith",
        locale: "fr",
        theme: "system",
        online: "yes",
        browser: "private user agent",
        viewport: { width: -1, height: 20001 },
        email: "secret",
      },
    );
    expect(capture([], client).client).toEqual({
      build: null,
      locale: "en",
      theme: "light",
      online: false,
      browser: "other",
      viewport: { width: 1, height: 10000 },
    });
  });
  it("keeps the newest 200 events in order", () => {
    const base = capture(Array.from({ length: 201 }, (_, i) => event({}, "nav", (201 - i) * 1000)));
    expect(base.trail).toHaveLength(200);
    expect(base.truncated).toBe(true);
    expect(base.trail[0]!.at).toBe(new Date(+NOW - 200000).toISOString());
    expect(base.trail.at(-1)!.at).toBe(new Date(+NOW - 1000).toISOString());
  });
  it("keeps only the opening fifteen minutes, including the boundary", () => {
    const base = capture([
      event({}, "nav", 900001),
      event({}, "nav", 900000),
      event({}, "nav", -1),
    ]);
    expect(base.trail.map((row) => row.at)).toEqual([new Date(+NOW - 900000).toISOString()]);
    expect(base.truncated).toBe(true);
  });
  it("bounds distinct request IDs to the newest hundred", () => {
    const base = capture(
      Array.from({ length: 101 }, (_, i) =>
        event(
          { requestId: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}` },
          "api",
          101 - i,
        ),
      ),
    );
    expect(new Set(base.trail.map((row) => row.fields.requestId)).size).toBe(100);
    expect(base.truncated).toBe(true);
    expect(base.trail.at(-1)!.fields.requestId).toBe("00000000-0000-4000-8000-000000000064");
  });
  it("bounds the encoded trail to 64 KiB even with long masked paths", () => {
    const fields = {
      phase: "end",
      method: "OPTIONS",
      path: "/api/" + "guest/".repeat(100),
      requestId: ID,
      status: 599,
      code: "management_session.required",
      error: "network",
    };
    const base = capture(Array.from({ length: 200 }, (_, i) => event(fields, "api", 200 - i)));
    expect(new TextEncoder().encode(JSON.stringify(base.trail)).byteLength).toBeLessThanOrEqual(
      65536,
    );
    expect(base.trail.length).toBeLessThan(200);
    expect(base.truncated).toBe(true);
    expect(base.trail.at(-1)!.at).toBe(new Date(+NOW - 1).toISOString());
  });
  it.each(["2001-01-01T00:00:00.000Z", "2099-01-01T00:00:00.000Z"])(
    "allows a download made with clock %s",
    (time) => {
      const base = capture([], CLIENT, new Date(time));
      expect(diagnostics.renderClientReport?.(base, "The page froze.")?.text).toContain(time);
    },
  );
  it("renders current descriptions without regenerating opening time or ID", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const id = vi.spyOn(crypto, "randomUUID").mockReturnValue(ID);
    const base = diagnostics.captureClientReport?.({ app: "dashboard", trail: [], client: CLIENT });
    expect(base).toBeDefined();
    vi.setSystemTime(new Date("2099-01-01"));
    const first = diagnostics.renderClientReport?.(base!, "First");
    const next = diagnostics.renderClientReport?.(base!, "Second");
    expect(first?.name).toBe(`problem-report-${ID}.md`);
    expect(next?.name).toBe(first?.name);
    expect(id).toHaveBeenCalledOnce();
    expect(parsed(next!.text)).toMatchObject({
      id: ID,
      openedAt: NOW.toISOString(),
      description: "Second",
    });
    expect(parsed(first!.text).description).toBe("First");
  });
  it("escapes Markdown fences, HTML and direction controls while retaining the description", () => {
    const description = "```\n<script>\u202eprivate";
    const file = diagnostics.renderClientReport?.(capture(), description);
    expect(file).toBeDefined();
    expect(file!.text.match(/^```/gm)).toHaveLength(2);
    expect(file!.text).not.toContain("<script>");
    expect(file!.text).not.toContain("\u202e");
    expect(parsed(file!.text).description).toBe(description);
  });
  it.each(["a".repeat(2001), "before\u0000after"])(
    "does not render an invalid description %#",
    (description) => {
      expect(diagnostics.renderClientReport?.(capture(), description)).toBeUndefined();
    },
  );
});

import { describe, expect, it } from "vitest";
import { createDiagnosticsLog } from "./log.js";

const at = () => new Date("2026-08-31T10:00:00.000Z");

describe("diagnostics ring buffer", () => {
  it("keeps only the last `max` events, oldest evicted", () => {
    const log = createDiagnosticsLog({ max: 2, now: at });
    log.record("info", "a");
    log.record("info", "b");
    log.record("info", "c");
    expect(log.snapshot().map((e) => e.event)).toEqual(["b", "c"]);
  });

  it("snapshot returns a copy that cannot mutate the buffer", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "a");
    log.snapshot().push({ at: "x", level: "info", event: "hacked", fields: {} });
    expect(log.snapshot().map((e) => e.event)).toEqual(["a"]);
  });

  it("snapshot deep-copies each event's fields, so mutating them does not reach the buffer", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "a", { status: 200 });
    const snap = log.snapshot();
    snap[0]!.fields.status = 999;
    snap[0]!.fields.extra = "leaked";
    expect(log.snapshot()[0]!.fields).toEqual({ status: 200 });
  });

  it("keeps primitive fields and drops non-primitive ones", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "api", { status: 200, code: "sale.void", ok: true, body: { card: "4242" } });
    expect(log.snapshot()[0]!.fields).toEqual({ status: 200, code: "sale.void", ok: true });
  });

  it("in strict mode, a non-primitive field throws (guard is provable)", () => {
    const log = createDiagnosticsLog({ now: at, strict: true });
    expect(() => log.record("info", "x", { body: { a: 1 } })).toThrow();
  });

  it("caps a long string field", () => {
    const log = createDiagnosticsLog({ now: at });
    log.record("info", "x", { s: "z".repeat(1000) });
    expect((log.snapshot()[0]!.fields.s as string).length).toBe(300);
  });

  it("keeps at most 20 fields, dropping the rest", () => {
    const log = createDiagnosticsLog({ now: at });
    const fields: Record<string, number> = {};
    for (let i = 0; i < 30; i++) fields[`f${i}`] = i;
    log.record("info", "x", fields);
    expect(Object.keys(log.snapshot()[0]!.fields)).toHaveLength(20);
  });

  it("stamps `at` from the real clock when no `now` is supplied", () => {
    const log = createDiagnosticsLog();
    const before = Date.now();
    log.record("info", "a");
    const after = Date.now();
    const parsed = Date.parse(log.snapshot()[0]!.at);
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });
});

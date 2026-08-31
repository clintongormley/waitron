import { describe, expect, it } from "vitest";
import { createDiagnosticsLog } from "./log.js";
import { installErrorCapture } from "./error-capture.js";

function fakeTarget() {
  const listeners: Record<string, (ev: unknown) => void> = {};
  return {
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      listeners[type] = fn;
    },
    dispatch: (type: string, ev: unknown) => listeners[type]?.(ev),
  };
}

describe("installErrorCapture", () => {
  it("records a window error with name and message", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("error", { message: "boom", error: { name: "TypeError", stack: "at x" } });
    const e = log.snapshot().at(-1)!;
    expect(e.level).toBe("error");
    expect(e.fields.name).toBe("TypeError");
    expect(e.fields.message).toBe("boom");
  });

  it("records the domain code from a rejected { code } (duck-typed, not verbatim)", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("unhandledrejection", { reason: { code: "sale.void_forbidden" } });
    expect(log.snapshot().at(-1)!.fields.code).toBe("sale.void_forbidden");
  });

  it("never throws even on a malformed event", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    expect(() => t.dispatch("error", null)).not.toThrow();
  });

  it("records only the fields present — a bare message, no error object", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("error", { message: "lonely" });
    const e = log.snapshot().at(-1)!;
    expect(e.fields.message).toBe("lonely");
    expect(e.fields.name).toBeUndefined();
    expect(e.fields.stack).toBeUndefined();
  });

  it("swallows a throwing getter on the error event (never re-throws)", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    const ev = {
      get error() {
        throw new Error("hostile getter");
      },
    };
    expect(() => t.dispatch("error", ev)).not.toThrow();
    expect(log.snapshot()).toHaveLength(0);
  });

  it("records the reason name from a rejection with no code", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("unhandledrejection", { reason: { name: "RangeError" } });
    const e = log.snapshot().at(-1)!;
    expect(e.fields.name).toBe("RangeError");
    expect(e.fields.code).toBeUndefined();
  });

  it("ignores a non-string code on a rejection reason", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    t.dispatch("unhandledrejection", { reason: { code: 42 } });
    expect(log.snapshot().at(-1)!.fields.code).toBeUndefined();
  });

  it("swallows a throwing getter on the rejection reason (never re-throws)", () => {
    const log = createDiagnosticsLog();
    const t = fakeTarget();
    installErrorCapture(t, log);
    const reason = {
      get code() {
        throw new Error("hostile getter");
      },
    };
    expect(() => t.dispatch("unhandledrejection", { reason })).not.toThrow();
    expect(log.snapshot()).toHaveLength(0);
  });
});

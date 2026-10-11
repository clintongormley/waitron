import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionSignals } from "./session-signals.js";

function harness() {
  const target = new EventTarget();
  const invalid: unknown[] = [];
  let active = 0;
  target.addEventListener("waitron-session-invalid", (event) => {
    invalid.push((event as CustomEvent<{ code: string }>).detail);
  });
  target.addEventListener("waitron-session-active", () => {
    active += 1;
  });
  const signals = createSessionSignals({ target });
  return { signals, invalid, active: () => active };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session signals", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("no request expected")));

  beforeEach(() => {
    fetchSpy.mockClear();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["management_session.expired", "management_session.required", "person.suspended"])(
    "reports %s as an invalid session without asking the box anything",
    async (code) => {
      const h = harness();
      h.signals.reportError(code, 401);
      await settle();
      expect(h.invalid).toEqual([{ code }]);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("reports node.reset from a 404 as an invalid session without asking the box anything", async () => {
    const h = harness();
    h.signals.reportError("node.reset", 404);
    await settle();
    expect(h.invalid).toEqual([{ code: "node.reset" }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["server.internal", 404],
    ["product.not_found", 404],
    ["server.internal", 500],
    ["connection.failed", undefined],
  ] as const)("reports nothing and asks nothing after %s with status %s", async (code, status) => {
    const h = harness();
    h.signals.reportError(code, status);
    await settle();
    expect(h.invalid).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports activity as a session-active event", () => {
    const h = harness();
    h.signals.reportActivity();
    expect(h.active()).toBe(1);
  });
});

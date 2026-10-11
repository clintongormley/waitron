import { describe, expect, it, vi } from "vitest";
import { createSessionSignals } from "./session-signals.js";

function setupModeAnswer(): Response {
  return new Response(
    JSON.stringify({ provisioned: false, environment: "preproduction", needs: ["venue"] }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function harness(
  fetchImpl: (path: string, init: RequestInit) => Promise<Response>,
  probeTimeLimitMs?: number,
) {
  const target = new EventTarget();
  const invalid: unknown[] = [];
  let active = 0;
  target.addEventListener("waitron-session-invalid", (event) => {
    invalid.push((event as CustomEvent<{ code: string }>).detail);
  });
  target.addEventListener("waitron-session-active", () => {
    active += 1;
  });
  let clock = 1_000_000;
  const fetchMock = vi.fn(fetchImpl);
  const signals = createSessionSignals({
    fetchImpl: fetchMock,
    target,
    minProbeIntervalMs: 10_000,
    now: () => clock,
    probeTimeLimitMs,
  });
  return {
    signals,
    fetchMock,
    invalid,
    active: () => active,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("session signals", () => {
  it.each(["management_session.expired", "management_session.required", "person.suspended"])(
    "reports %s as an invalid session without asking the box anything",
    async (code) => {
      const h = harness(() => Promise.resolve(setupModeAnswer()));
      h.signals.reportError(code, 401);
      await settle();
      expect(h.invalid).toEqual([{ code }]);
      expect(h.fetchMock).not.toHaveBeenCalled();
    },
  );

  it("reports activity as a session-active event", () => {
    const h = harness(() => Promise.resolve(setupModeAnswer()));
    h.signals.reportActivity();
    expect(h.active()).toBe(1);
  });

  it("asks the setup status after a bare 404 and reports a reset box once", async () => {
    const h = harness(() => Promise.resolve(setupModeAnswer()));
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledExactlyOnceWith("/setup-api/status", {
      method: "GET",
      credentials: "include",
      headers: expect.any(Headers),
      signal: expect.any(AbortSignal),
    });
    const headers = h.fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("x-waitron-live")).toBe("1");
    expect(h.invalid).toEqual([{ code: "node.reset" }]);
  });

  it("reports nothing when a trading box answers the status with an empty 404", async () => {
    const h = harness(() => Promise.resolve(new Response(null, { status: 404 })));
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(h.invalid).toEqual([]);
  });

  it.each([{ provisioned: true }, { provisioned: "false" }, {}, [false], null])(
    "reports nothing when the status answers %j",
    async (body) => {
      const h = harness(() => Promise.resolve(Response.json(body)));
      h.signals.reportError("server.internal", 404);
      await settle();
      expect(h.fetchMock).toHaveBeenCalledOnce();
      expect(h.invalid).toEqual([]);
    },
  );

  it.each([500, 503, 404, 403])(
    "reports nothing when the status read fails with %i, even carrying provisioned: false",
    async (status) => {
      const h = harness(() =>
        Promise.resolve(
          new Response(JSON.stringify({ provisioned: false }), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      h.signals.reportError("server.internal", 404);
      await settle();
      expect(h.fetchMock).toHaveBeenCalledOnce();
      expect(h.invalid).toEqual([]);
    },
  );

  it("ignores a status answer that is not JSON", async () => {
    const h = harness(() => Promise.resolve(new Response("<html></html>", { status: 200 })));
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.invalid).toEqual([]);
  });

  it("ignores a status read that fails to connect", async () => {
    const h = harness(() => Promise.reject(new TypeError("Failed to fetch")));
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.invalid).toEqual([]);
  });

  it.each([
    ["product.not_found", 404],
    ["server.internal", 500],
    ["connection.failed", undefined],
    ["server.internal", undefined],
  ] as const)("never asks the status after %s with status %s", async (code, status) => {
    const h = harness(() => Promise.resolve(setupModeAnswer()));
    h.signals.reportError(code, status);
    await settle();
    expect(h.fetchMock).not.toHaveBeenCalled();
    expect(h.invalid).toEqual([]);
  });

  it("asks once for a burst of 404s", async () => {
    const h = harness(() => Promise.resolve(new Response(null, { status: 404 })));
    for (let i = 0; i < 5; i += 1) h.signals.reportError("server.internal", 404);
    await settle();
    h.advance(9_999);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledOnce();
  });

  it("asks only once while the first read is still unanswered, even past the interval", async () => {
    let answer: (response: Response) => void = () => undefined;
    const h = harness(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    h.signals.reportError("server.internal", 404);
    h.advance(20_000);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledOnce();
    answer(new Response(null, { status: 404 }));
    await settle();
  });

  it("gives up on a status read that never answers, aborts it, and asks again on a later 404", async () => {
    const signals: AbortSignal[] = [];
    // Ignores its signal, so only racing the time limit can settle the read.
    const h = harness((_path, init) => {
      signals.push(init.signal!);
      return new Promise<Response>(() => undefined);
    }, 20);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(signals[0]!.aborted).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signals[0]!.aborted).toBe(true);
    h.advance(10_000);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on a status answer whose body never finishes, and asks again on a later 404", async () => {
    const h = harness(
      () => Promise.resolve(new Response(new ReadableStream({ start: () => undefined }))),
      20,
    );
    h.signals.reportError("server.internal", 404);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 40));
    h.advance(10_000);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    expect(h.invalid).toEqual([]);
  });

  it("asks again after the interval has passed", async () => {
    const h = harness(() => Promise.resolve(new Response(null, { status: 404 })));
    h.signals.reportError("server.internal", 404);
    await settle();
    h.advance(10_000);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops asking once a reset was reported", async () => {
    const h = harness(() => Promise.resolve(setupModeAnswer()));
    h.signals.reportError("server.internal", 404);
    await settle();
    h.advance(60_000);
    h.signals.reportError("server.internal", 404);
    await settle();
    expect(h.fetchMock).toHaveBeenCalledOnce();
    expect(h.invalid).toEqual([{ code: "node.reset" }]);
  });
});

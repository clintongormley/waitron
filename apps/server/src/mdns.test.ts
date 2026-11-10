import { afterEach, describe, it, expect, vi } from "vitest";
import type { MdnsQuerySocket } from "./box-lookup.js";
import {
  buildMdnsAnswers,
  startMdnsResponder,
  watchVenueNameInSetup,
  MDNS_TTL_SECONDS,
  type MdnsSocket,
} from "./mdns.js";

function fakeSocket() {
  let queryHandler: ((q: { questions: { name: string; type: string }[] }) => void) | undefined;
  let errorHandler: ((err: Error) => void) | undefined;
  const respond = vi.fn();
  const destroy = vi.fn((cb?: () => void) => cb?.());
  // The fake routes BY event so a later `on("error", …)` registration cannot clobber the query
  // handler (the real socket has distinct listeners per event); the cast satisfies the overloaded
  // `MdnsSocket["on"]` from a single broad implementation.
  const socket: MdnsSocket = {
    on: ((event: string, h: (...args: never[]) => void): void => {
      if (event === "error") errorHandler = h as (err: Error) => void;
      else queryHandler = h as (q: { questions: { name: string; type: string }[] }) => void;
    }) as MdnsSocket["on"],
    respond,
    destroy,
  };
  return {
    socket,
    respond,
    destroy,
    query: (q: { questions: { name: string; type: string }[] }) => queryHandler?.(q),
    // Mirrors Node's EventEmitter: an `'error'` with no listener THROWS.
    emitError: (err: Error) => {
      if (errorHandler === undefined) throw err;
      errorHandler(err);
    },
  };
}

describe("mdns", () => {
  it("builds one A answer per address", () => {
    const answers = buildMdnsAnswers("waitron.local", ["192.168.1.5", "10.0.0.9"]);
    expect(answers).toEqual([
      { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
      { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "10.0.0.9" },
    ]);
  });

  it.each([
    { devMode: true, httpHost: "0.0.0.0" },
    { devMode: true, httpHost: "192.168.10.101" },
    { devMode: false, httpHost: "127.0.0.1" },
    { devMode: false, httpHost: "127.255.255.254" },
    { devMode: false, httpHost: "::1" },
    { devMode: false, httpHost: "localhost" },
  ])("does not advertise the box name for $httpHost with devMode=$devMode", async (config) => {
    const f = fakeSocket();
    const makeSocket = vi.fn(() => f.socket);
    const log = vi.fn();
    const responder = startMdnsResponder({
      ...config,
      names: () => ["waitron.local"],
      getAddresses: () => ["192.168.10.101"],
      log,
      makeSocket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    await responder.stop();
    await responder.stop();
    expect(makeSocket).not.toHaveBeenCalled();
    expect(f.respond).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalledWith("info", "mdns.responding", expect.anything());
  });

  it("answers an A query for its hostname with the current addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it("answers an ANY query for its hostname (mDNS ANY asks for every record)", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it("answers each of its names", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "A" }] });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond.mock.calls).toEqual([
      [
        {
          answers: [
            {
              name: "box-0a1b.waitron.local",
              type: "A",
              ttl: MDNS_TTL_SECONDS,
              data: "192.168.1.5",
            },
          ],
        },
      ],
      [
        {
          answers: [
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          ],
        },
      ],
    ]);
  });

  it("answers every one of its names asked in one query", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local", "waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({
      questions: [
        { name: "box-0a1b.waitron.local", type: "A" },
        { name: "other.local", type: "A" },
        { name: "waitron.local", type: "ANY" },
      ],
    });
    expect(f.respond.mock.calls).toEqual([
      [
        {
          answers: [
            {
              name: "box-0a1b.waitron.local",
              type: "A",
              ttl: MDNS_TTL_SECONDS,
              data: "192.168.1.5",
            },
            { name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
          ],
        },
      ],
    ]);
  });

  it("stops answering a name dropped from the list on the next query", () => {
    const f = fakeSocket();
    let names = ["box-0a1b.waitron.local", "waitron.local"];
    startMdnsResponder({
      names: () => names,
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(1);
    names = ["box-0a1b.waitron.local"];
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(1);
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "A" }] });
    expect(f.respond).toHaveBeenCalledTimes(2);
  });

  it("a box that is not selling answers its own name and not the venue's", () => {
    const f = fakeSocket();
    const logged: Array<{ event: string; fields?: Record<string, unknown> }> = [];
    startMdnsResponder({
      names: () => ["box-0a1b.waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: (_level, event, fields) => logged.push({ event, fields }),
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
    f.query({ questions: [{ name: "box-0a1b.waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [
        { name: "box-0a1b.waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" },
      ],
    });
    expect(logged).toContainEqual({
      event: "mdns.responding",
      fields: { hostnames: ["box-0a1b.waitron.local"] },
    });
  });

  it("ignores a query for a different name", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "other.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("does not respond when the box has no addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => [],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "A" }] });
    expect(f.respond).not.toHaveBeenCalled();
  });

  it("stop() destroys the socket once", async () => {
    const f = fakeSocket();
    const r = startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    await r.stop();
    await r.stop();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("logs a socket error without throwing", () => {
    // A bind/membership failure arrives as an ASYNC `'error'` event, which with no listener kills the
    // box. The box stays reachable by IP without mDNS, so it must be swallowed, not fatal.
    const f = fakeSocket();
    const logged: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
    startMdnsResponder({
      names: () => ["waitron.local"],
      devMode: false,
      httpHost: "0.0.0.0",
      getAddresses: () => ["192.168.1.5"],
      log: (level, event, fields) => logged.push({ level, event, fields }),
      makeSocket: () => f.socket,
    });
    expect(() => f.emitError(new Error("bind EADDRINUSE 0.0.0.0:5353"))).not.toThrow();
    expect(logged).toContainEqual({
      level: "warn",
      event: "mdns.socket_error",
      fields: { message: "bind EADDRINUSE 0.0.0.0:5353" },
    });
  });
});

const OWN = "192.168.10.5";
const OTHER = "192.168.10.9";

/** Each ask opens a socket; whoever is in `answering` answers it, and `fail` makes it error instead. */
function fakeNetwork() {
  const net = {
    answering: [OWN],
    fail: undefined as Error | undefined,
    asks: [] as number[],
    destroys: 0,
  };
  const makeSocket = (): MdnsQuerySocket => {
    const handlers: {
      response?: (r: { answers: { name: string; type: string; data: unknown }[] }) => void;
      error?: (e: Error) => void;
    } = {};
    return {
      on(event: "response" | "error", handler: never) {
        handlers[event] = handler;
      },
      query() {
        net.asks.push(Date.now());
        if (net.fail !== undefined) {
          handlers.error?.(net.fail);
          handlers.error?.(net.fail);
          return;
        }
        const answers = net.answering.map((data) => ({ name: "waitron.local", type: "A", data }));
        handlers.response?.({ answers });
      },
      destroy(cb) {
        net.destroys += 1;
        cb?.();
      },
    };
  };
  return { net, makeSocket };
}

describe("a box in setup mode and the venue's name", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function watch(random: () => number, answering = [OWN]) {
    const { net, makeSocket } = fakeNetwork();
    net.answering = answering;
    const w = watchVenueNameInSetup({
      hostname: "waitron.local",
      devMode: false,
      httpHost: "0.0.0.0",
      ownAddresses: () => [OWN],
      random,
      makeSocket,
    });
    return { net, w };
  }

  it("a box in setup mode stops answering the venue's name once another box answers it", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0.5);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(net.asks).toEqual([0]);
    expect(w.names()).toEqual(["waitron.local"]);

    net.answering = [OWN, OTHER];
    expect(w.names()).toEqual(["waitron.local"]);
    await vi.advanceTimersByTimeAsync(35_000 + 2_000);
    expect(net.asks).toEqual([0, 37_000]);
    expect(w.names()).toEqual([]);

    net.answering = [OWN];
    await vi.advanceTimersByTimeAsync(35_000 + 2_000);
    expect(net.asks).toEqual([0, 37_000, 74_000]);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("a box in setup mode answers nothing while its first ask is in flight, nor after it hears another box", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0, [OWN, OTHER]);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(net.asks).toEqual([0]);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual([]);
    await w.stop();
  });

  it("a box in setup mode begins answering only when its first ask ends having heard nobody", async () => {
    vi.useFakeTimers({ now: 0 });
    const { w } = watch(() => 0);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(w.names()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it("a box in setup mode that is answering stops at the end of the next ask that hears another box, and no later", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0.999_9);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(w.names()).toEqual(["waitron.local"]);
    net.answering = [OWN, OTHER];
    // The longest wait: 30 s plus a draw just under the 10 s of jitter, then the 2 s ask.
    await vi.advanceTimersByTimeAsync(30_000 + 9_999);
    expect(net.asks).toEqual([0, 41_999]);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(w.names()).toEqual(["waitron.local"]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.names()).toEqual([]);
    await w.stop();
  });

  it("asks again after 30 seconds plus the random delay, drawn afresh each time", async () => {
    vi.useFakeTimers({ now: 0 });
    const draws = [0.7, 0.2];
    const { net, w } = watch(() => draws.shift()!);
    await vi.advanceTimersByTimeAsync(2_000 + 30_000 + 6_999);
    expect(net.asks).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(net.asks).toEqual([0, 39_000]);
    await vi.advanceTimersByTimeAsync(2_000 + 32_000);
    expect(net.asks).toEqual([0, 39_000, 73_000]);
    await vi.advanceTimersByTimeAsync(2_000);
    await w.stop();
  });

  it("asks no more once stopped, and stops only after closing an ask in flight", async () => {
    vi.useFakeTimers({ now: 0 });
    const random = vi.fn(() => 0);
    const { net, w } = watch(random);
    const destroysWhenStopped = w.stop().then(() => net.destroys);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await destroysWhenStopped).toBe(1);
    expect(net.asks).toEqual([0]);
    expect(random).not.toHaveBeenCalled();
  });

  it("a failed ask counts as hearing nobody, so the box answers again", async () => {
    vi.useFakeTimers({ now: 0 });
    const { net, w } = watch(() => 0);
    net.answering = [OWN, OTHER];
    await vi.advanceTimersByTimeAsync(2_000 + 30_000 + 2_000);
    expect(w.names()).toEqual([]);
    net.fail = new Error("bind EADDRINUSE 0.0.0.0:5353");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(net.asks).toEqual([0, 32_000, 64_000]);
    expect(w.names()).toEqual(["waitron.local"]);
    await w.stop();
  });

  it.each([
    { devMode: true, httpHost: "0.0.0.0" },
    { devMode: false, httpHost: "127.0.0.1" },
  ])("asks nothing where the responder is off ($httpHost, devMode=$devMode)", async (config) => {
    const makeSocket = vi.fn();
    const w = watchVenueNameInSetup({
      hostname: "waitron.local",
      ...config,
      random: () => 0,
      makeSocket,
    });
    expect(makeSocket).not.toHaveBeenCalled();
    await w.stop();
  });
});

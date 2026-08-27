import { describe, it, expect, vi } from "vitest";
import { buildMdnsAnswers, startMdnsResponder, MDNS_TTL_SECONDS, type MdnsSocket } from "./mdns.js";

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
    // Mirrors Node's EventEmitter: an `'error'` with no listener THROWS. So this stays quiet ONLY
    // because `startMdnsResponder` registered a handler — which is exactly what the resilience test
    // below proves by deletion (drop the `socket.on("error", …)` line and this throws again).
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

  it("answers an A query for its hostname with the current addresses", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
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
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    f.query({ questions: [{ name: "waitron.local", type: "ANY" }] });
    expect(f.respond).toHaveBeenCalledWith({
      answers: [{ name: "waitron.local", type: "A", ttl: MDNS_TTL_SECONDS, data: "192.168.1.5" }],
    });
  });

  it("ignores a query for a different name", () => {
    const f = fakeSocket();
    startMdnsResponder({
      hostname: "waitron.local",
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
      hostname: "waitron.local",
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
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: () => {},
      makeSocket: () => f.socket,
    });
    await r.stop();
    await r.stop();
    expect(f.destroy).toHaveBeenCalledTimes(1);
  });

  it("logs a socket 'error' and does NOT throw (mDNS is non-load-bearing — a host with no multicast route must still boot)", () => {
    // A real `multicast-dns` instance surfaces a bind/membership failure (EADDRINUSE/EACCES on a host
    // with no multicast route — some CI/containers) as an ASYNC `'error'` event; with no listener,
    // Node throws it and kills the box. The box stays reachable by IP whether or not mDNS advertises,
    // so this must be swallowed, not fatal: `startMdnsResponder` registers an `'error'` handler that
    // logs `mdns.socket_error` and rethrows nothing.
    const f = fakeSocket();
    const logged: Array<{ level: string; event: string; fields?: Record<string, unknown> }> = [];
    startMdnsResponder({
      hostname: "waitron.local",
      getAddresses: () => ["192.168.1.5"],
      log: (level, event, fields) => logged.push({ level, event, fields }),
      makeSocket: () => f.socket,
    });
    // The fake mirrors Node: `emitError` throws if no handler was registered. So `not.toThrow()`
    // proves the handler exists AND swallows — delete the `socket.on("error", …)` line in mdns.ts and
    // this throws (proof by deletion).
    expect(() => f.emitError(new Error("bind EADDRINUSE 0.0.0.0:5353"))).not.toThrow();
    expect(logged).toContainEqual({
      level: "warn",
      event: "mdns.socket_error",
      fields: { message: "bind EADDRINUSE 0.0.0.0:5353" },
    });
  });
});

import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import multicastDns from "multicast-dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";

const systemLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns/promises", () => ({ lookup: systemLookup }));

import {
  askedAndHeardOthers,
  lookupBoxName,
  RememberedAnswers,
  type MdnsQuerySocket,
} from "./box-lookup.js";
import { MDNS_TTL_SECONDS } from "./mdns.js";

const NAME = "box-a1b2.waitron.local";
const OWN = "192.168.10.5";

interface Answer {
  name: string;
  type: string;
  data: unknown;
  ttl?: number;
}

/** A socket whose `query` hands the queued answer packets back, one per event, in order. */
function fakeSocket(packets: Answer[][]) {
  const handlers: { response?: (r: { answers: Answer[] }) => void; error?: (e: Error) => void } =
    {};
  const queries: unknown[] = [];
  let destroyed = false;
  const socket: MdnsQuerySocket = {
    on(event: "response" | "error", handler: never) {
      handlers[event] = handler;
    },
    query(query) {
      queries.push(query);
      queueMicrotask(() => {
        for (const answers of packets) handlers.response?.({ answers });
      });
    },
    destroy(cb) {
      destroyed = true;
      cb?.();
    },
  };
  return {
    socket,
    queries,
    fail: (err: Error) => handlers.error?.(err),
    isDestroyed: () => destroyed,
  };
}

const VENUE = "waitron.local";
const fresh = (...addresses: string[]) => ({ addresses, remembered: false });
const a = (data: string, name = NAME): Answer => ({ name, type: "A", data });

function opts(fake: ReturnType<typeof fakeSocket>, timeoutMs = 20) {
  return { timeoutMs, makeSocket: () => fake.socket, ownAddresses: () => [OWN] };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

afterEach(() => {
  systemLookup.mockReset();
});

describe("lookupBoxName", () => {
  it("collects every A record answered within the limit", async () => {
    const fake = fakeSocket([
      [a("192.168.10.7"), a("10.0.0.7")],
      [a("192.168.10.7"), a("192.168.10.8")],
    ]);
    await expect(lookupBoxName(NAME, opts(fake))).resolves.toEqual(
      fresh("192.168.10.7", "10.0.0.7", "192.168.10.8"),
    );
    expect(fake.queries).toEqual([{ questions: [{ name: NAME, type: "A" }] }]);
    expect(fake.isDestroyed()).toBe(true);
  });

  it("ignores an answer for another name", async () => {
    const fake = fakeSocket([
      [a("192.168.10.9", "box-ffff.waitron.local"), { name: NAME, type: "AAAA", data: "fe80::1" }],
      [a("192.168.10.7", NAME.toUpperCase())],
    ]);
    await expect(lookupBoxName(NAME, opts(fake))).resolves.toEqual(fresh("192.168.10.7"));
  });

  it("a box in setup mode does not resolve the venue's name to itself", async () => {
    const fake = fakeSocket([[a(OWN, VENUE)], [a("192.168.10.7", VENUE)]]);
    await expect(lookupBoxName(VENUE, opts(fake))).resolves.toEqual(fresh("192.168.10.7"));
  });

  it("refuses when only its own answer comes back", async () => {
    const fake = fakeSocket([[a(OWN, VENUE), a("127.0.0.1", VENUE)]]);
    const error = await refusal(lookupBoxName(VENUE, opts(fake)));
    expect(error.code).toBe("mirror.peer_unresolved");
    expect(error.params).toEqual({});
  });

  it("leaves out this box's interface addresses by default", async () => {
    const own = Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => entry.address);
    const fake = fakeSocket([[...own, "127.0.0.1", "192.0.2.77"].map((ip) => a(ip))]);
    await expect(
      lookupBoxName(NAME, { timeoutMs: 20, makeSocket: () => fake.socket }),
    ).resolves.toEqual(fresh("192.0.2.77"));
  });

  it("refuses after its time limit", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSocket([]);
      const pending = refusal(lookupBoxName(NAME, opts(fake, 2000)));
      await vi.advanceTimersByTimeAsync(1999);
      expect(fake.isDestroyed()).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await pending).code).toBe("mirror.peer_unresolved");
      expect(fake.isDestroyed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits two seconds when given no limit", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSocket([[a("192.168.10.7")]]);
      let settled = false;
      const pending = lookupBoxName(NAME, {
        makeSocket: () => fake.socket,
        ownAddresses: () => [],
      }).finally(() => (settled = true));
      await vi.advanceTimersByTimeAsync(1999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual(fresh("192.168.10.7"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses when the socket fails before anyone answers", async () => {
    const fake = fakeSocket([]);
    const pending = refusal(lookupBoxName(NAME, opts(fake, 60_000)));
    fake.fail(new Error("EADDRINUSE"));
    expect((await pending).code).toBe("mirror.peer_unresolved");
    expect(fake.isDestroyed()).toBe(true);
  });

  it("refuses when the socket fails after another box answered, rather than return what it heard", async () => {
    const fake = fakeSocket([[a("192.168.10.7")]]);
    const pending = refusal(lookupBoxName(NAME, opts(fake, 60_000)));
    await Promise.resolve();
    fake.fail(new Error("EADDRINUSE"));
    expect((await pending).code).toBe("mirror.peer_unresolved");
    expect(fake.isDestroyed()).toBe(true);
  });

  it("hands a name that is not .local to the system lookup", async () => {
    systemLookup.mockResolvedValue([
      { address: "203.0.113.4", family: 4 },
      { address: "2001:db8::4", family: 6 },
    ]);
    const makeSocket = vi.fn();
    await expect(lookupBoxName("box.example.com", { makeSocket })).resolves.toEqual(
      fresh("203.0.113.4", "2001:db8::4"),
    );
    expect(systemLookup).toHaveBeenCalledWith("box.example.com", { all: true });
    expect(makeSocket).not.toHaveBeenCalled();
  });

  it("returns a literal address as it is", async () => {
    const makeSocket = vi.fn();
    await expect(lookupBoxName("192.168.10.7", { makeSocket })).resolves.toEqual(
      fresh("192.168.10.7"),
    );
    expect(systemLookup).not.toHaveBeenCalled();
    expect(makeSocket).not.toHaveBeenCalled();
  });
});

describe("lookupBoxName keeping answers", () => {
  const lived = (data: string, ttl: number | undefined): Answer => ({ ...a(data), ttl });

  function keeping(packets: Answer[][]) {
    let nowMs = 1_000_000;
    const fake = fakeSocket(packets);
    const remembered = new RememberedAnswers(() => nowMs);
    return {
      fake,
      ask: (more: { fresh?: boolean } = {}) =>
        lookupBoxName(NAME, { ...opts(fake), remembered, ...more }),
      pass: (ms: number) => (nowMs += ms),
    };
  }

  it("asks a name once while the shortest of its records lives, and again once it has ended", async () => {
    const k = keeping([[lived("192.168.10.7", 120), lived("192.168.10.8", 60)]]);
    const both = ["192.168.10.7", "192.168.10.8"];
    await expect(k.ask()).resolves.toEqual({ addresses: both, remembered: false });
    k.pass(59_999);
    await expect(k.ask()).resolves.toEqual({ addresses: both, remembered: true });
    expect(k.fake.queries).toHaveLength(1);
    k.pass(1);
    await expect(k.ask()).resolves.toEqual({ addresses: both, remembered: false });
    expect(k.fake.queries).toHaveLength(2);
  });

  it("keeps an answer no longer than a Waitron box's own records live, whatever lifetime it gives", async () => {
    const k = keeping([[lived("192.168.10.7", 2_147_483_647)]]);
    await k.ask();
    k.pass(MDNS_TTL_SECONDS * 1000 - 1);
    await expect(k.ask()).resolves.toMatchObject({ remembered: true });
    k.pass(1);
    await expect(k.ask()).resolves.toMatchObject({ remembered: false });
    expect(k.fake.queries).toHaveLength(2);
  });

  it("a fresh ask passes over what was kept, and keeps the new answer in its place", async () => {
    const packets = [[lived("192.168.10.7", 120)]];
    const k = keeping(packets);
    await k.ask();
    packets.splice(0, 1, [lived("192.168.10.9", 120)]);
    await expect(k.ask({ fresh: true })).resolves.toEqual(fresh("192.168.10.9"));
    await expect(k.ask()).resolves.toEqual({ addresses: ["192.168.10.9"], remembered: true });
    expect(k.fake.queries).toHaveLength(2);
  });

  it("a fresh ask nobody answers leaves nothing kept", async () => {
    const packets = [[lived("192.168.10.7", 120)]];
    const k = keeping(packets);
    await k.ask();
    packets.splice(0, 1);
    expect((await refusal(k.ask({ fresh: true }))).code).toBe("mirror.peer_unresolved");
    await refusal(k.ask());
    expect(k.fake.queries).toHaveLength(3);
  });

  it("keeps nothing from records that give no lifetime, or a lifetime of none", async () => {
    for (const ttl of [undefined, 0]) {
      const k = keeping([[lived("192.168.10.7", 120), lived("192.168.10.8", ttl)]]);
      await k.ask();
      await k.ask();
      expect(k.fake.queries).toHaveLength(2);
    }
  });

  it("keeps nothing for a name nobody answered", async () => {
    const k = keeping([[lived(OWN, 120)]]);
    await refusal(k.ask());
    await refusal(k.ask());
    expect(k.fake.queries).toHaveLength(2);
  });

  it("keeps a name's answers apart from another name's", async () => {
    const fake = fakeSocket([[lived("192.168.10.7", 120)]]);
    const remembered = new RememberedAnswers(() => 0);
    await lookupBoxName(NAME, { ...opts(fake), remembered });
    const other = fakeSocket([[{ ...a("192.168.10.9", VENUE), ttl: 120 }]]);
    await expect(lookupBoxName(VENUE, { ...opts(other), remembered })).resolves.toEqual(
      fresh("192.168.10.9"),
    );
    await expect(
      lookupBoxName(NAME.toUpperCase(), { ...opts(other), remembered }),
    ).resolves.toEqual({ addresses: ["192.168.10.7"], remembered: true });
  });
});

describe("askedAndHeardOthers", () => {
  it("answers true when a box other than this one holds the name", async () => {
    const fake = fakeSocket([[a(OWN, VENUE)], [a("192.168.10.7", VENUE)]]);
    await expect(askedAndHeardOthers(VENUE, opts(fake))).resolves.toBe(true);
  });

  it("answers false when only this box answers", async () => {
    const fake = fakeSocket([[a(OWN, VENUE)]]);
    await expect(askedAndHeardOthers(VENUE, opts(fake))).resolves.toBe(false);
  });

  it("rejects when the socket fails, whether or not anyone answered first", async () => {
    for (const packets of [[], [[a("192.168.10.7", VENUE)]]]) {
      const fake = fakeSocket(packets);
      const pending = askedAndHeardOthers(VENUE, opts(fake, 60_000));
      await Promise.resolve();
      fake.fail(new Error("EADDRINUSE"));
      await expect(pending).rejects.toThrow("EADDRINUSE");
      expect(fake.isDestroyed()).toBe(true);
    }
  });

  it("rejects when the port it asks from is already taken", async () => {
    const blocker = createSocket("udp4");
    await new Promise<void>((resolve) => blocker.bind(0, "0.0.0.0", resolve));
    try {
      const { port } = blocker.address();
      await expect(
        askedAndHeardOthers(VENUE, {
          timeoutMs: 1_000,
          ownAddresses: () => [],
          makeSocket: () => multicastDns({ port, multicast: false }) as MdnsQuerySocket,
        }),
      ).rejects.toMatchObject({ code: "EADDRINUSE" });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });
});

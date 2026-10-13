import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generationPrefix, markerKey } from "./generations.js";
import { generationName, venuePrefix } from "./names.js";
import type { ObjectStore, StoreCall } from "./object-store.js";
import { pointerKey, readPointer, SentPointers } from "./pointer.js";
import { PROBE_PREFIX } from "./probe.js";
import { callCancelled } from "./store-call.js";
import { READ_DEADLINE_MS, StreamSupervisor } from "./supervisor.js";
import { FakeLitestream } from "./testing/fake-litestream.js";
import { ManualClock } from "./testing/manual-clock.js";
import { SwitchableStore } from "./testing/switchable-store.js";
import type { BucketOperation } from "./errors.js";

const VENUE = "venue-1";
const NODE = "node-a";
const START = "2026-09-23T12:00:00Z";
const LIMIT = 1_000;

const fullCopyOf = (generation: string) =>
  `${generationPrefix(VENUE, generation)}0000/0000000000000001-0000000000000001.ltx`;
const levelZero = (generation: string) => `${generationPrefix(VENUE, generation)}0000/`;

type Call = { operation: BucketOperation; key: string; signal: AbortSignal | undefined };

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

/** Lets a cancelled call's rejection, and whatever it sets off, run. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function harness() {
  const clock = new ManualClock(START);
  const store = new SwitchableStore(() => clock.trueNow());
  const calls: Call[] = [];
  /** A call this picks waits until its signal is cancelled, then fails as the S3 store's does. */
  let hold: (operation: BucketOperation, key: string) => boolean = () => false;
  const through = <T>(
    operation: BucketOperation,
    key: string,
    call: StoreCall | undefined,
    send: () => Promise<T>,
  ): Promise<T> => {
    calls.push({ operation, key, signal: call?.signal });
    if (!hold(operation, key)) return send();
    return new Promise<never>((_, reject) => {
      call?.signal?.addEventListener("abort", () => reject(callCancelled(operation, key)), {
        once: true,
      });
    });
  };
  const recording: ObjectStore = {
    get: (key, call) => through("get", key, call, () => store.get(key, call)),
    put: (key, body, condition, call) =>
      through("put", key, call, () => store.put(key, body, condition, call)),
    list: (prefix, call) => through("list", prefix, call, () => store.list(prefix, call)),
    delete: (key, call) => through("delete", key, call, () => store.delete(key, call)),
    deleteMany: (keys, call) =>
      through("delete", keys[0] ?? "", call, () => store.deleteMany(keys, call)),
  };
  const litestream = new FakeLitestream([]);
  const directory = await mkdtemp(join(tmpdir(), "waitron-stream-cancel-"));
  let wal = 0;
  let walFails = false;
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const supervisor = new StreamSupervisor({
    litestreamBin: "litestream",
    venueDbPath: join(directory, "venue.db"),
    configDir: join(directory, "stream"),
    bucket: {
      region: "eu-south-2",
      bucket: "venue-copies",
      prefix: "",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret-example",
    },
    venueId: VENUE,
    nodeId: NODE,
    term: 2,
    sign: async (message) => `signed:${message.length}`,
    foldBack: async () => {
      wal = 0;
      return { reclaimed: true };
    },
    walBytes: async () => {
      if (walFails) throw new Error("the side file could not be measured");
      return wal;
    },
    walLimitBytes: LIMIT,
    now: clock.now,
    monotonic: clock.monotonic,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    spawn: (bin, args, env) => litestream.spawn(bin, args, env),
    store: recording,
    sleep: clock.sleep,
    onCommit: () => () => {},
    sentPointers: new SentPointers(),
  });
  cleanups.push(async () => {
    await supervisor.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    supervisor,
    store,
    litestream,
    clock,
    calls,
    logs,
    holdWhen: (pick: (operation: BucketOperation, key: string) => boolean) => {
      hold = pick;
    },
    setWal: (bytes: number) => {
      wal = bytes;
    },
    failWal: (fails = true) => {
      walFails = fails;
    },
    /** The calls after the first `since`, of `operation` on `key`. */
    callsOn: (operation: BucketOperation, key: string, since = 0) =>
      calls.slice(since).filter((call) => call.operation === operation && call.key === key),
  };
}

async function streaming() {
  const h = await harness();
  await h.supervisor.start();
  await h.clock.until(() => h.litestream.running() !== undefined);
  const generation = h.supervisor.status().generation!;
  h.store.upload(fullCopyOf(generation));
  await h.clock.until(() => h.supervisor.status().state === "streaming");
  return { ...h, generation, callsBefore: h.calls.length, logsBefore: h.logs.length };
}

describe("the pause's question to the bucket", () => {
  /** Ticks into a pause whose listing never answers; answers that listing. */
  async function pausedOnAListing() {
    const h = await streaming();
    h.store.hang = true;
    h.setWal(LIMIT);
    await h.clock.next();
    // The tick's freshness read lists level 0 first, then the pause asks the same.
    await vi.waitFor(() =>
      expect(h.callsOn("list", levelZero(h.generation), h.callsBefore)).toHaveLength(2),
    );
    expect(h.supervisor.status().state).toBe("paused");
    return { h, listing: h.callsOn("list", levelZero(h.generation), h.callsBefore)[1]! };
  }

  it("cancels a listing still unanswered at the deadline, and logs the timeout once", async () => {
    const { h, listing } = await pausedOnAListing();
    expect(listing.signal?.aborted).toBe(false);
    await h.clock.next();
    expect(h.clock.slept.at(-1)).toBe(READ_DEADLINE_MS);
    await h.clock.asleep();
    await settle();
    expect(listing.signal?.aborted).toBe(true);
    expect(h.logs.filter((line) => line.event === "stream.pause_check_failed")).toEqual([
      { level: "warn", event: "stream.pause_check_failed", fields: { errorCode: "timeout" } },
    ]);
  });

  it("cancels the listing on stop, and logs nothing after", async () => {
    const { h, listing } = await pausedOnAListing();
    const logged = h.logs.length;
    await h.supervisor.stop();
    await settle();
    expect(listing.signal?.aborted).toBe(true);
    expect(h.logs.slice(logged)).toEqual([]);
  });
});

describe("the freshness read", () => {
  it("cancels a read a newer one replaces after the deadline, and the old read logs nothing", async () => {
    const h = await streaming();
    h.store.hang = true;
    await h.clock.next();
    await vi.waitFor(() =>
      expect(h.callsOn("list", levelZero(h.generation), h.callsBefore)).toHaveLength(1),
    );
    h.clock.advance(READ_DEADLINE_MS);
    await h.clock.next();
    await vi.waitFor(() =>
      expect(h.callsOn("list", levelZero(h.generation), h.callsBefore)).toHaveLength(2),
    );
    const [replaced, newer] = h.callsOn("list", levelZero(h.generation), h.callsBefore);
    await settle();
    expect(replaced!.signal?.aborted).toBe(true);
    expect(newer!.signal?.aborted).toBe(false);
    expect(h.logs.slice(h.logsBefore)).toEqual([
      { level: "warn", event: "stream.freshness_unreadable", fields: { errorCode: "timeout" } },
    ]);
  });

  it("cancels a read in flight when the stream pauses, and logs nothing for it", async () => {
    const h = await streaming();
    h.store.hang = true;
    h.setWal(LIMIT);
    await h.clock.next();
    await vi.waitFor(() =>
      expect(h.callsOn("list", levelZero(h.generation), h.callsBefore)).toHaveLength(2),
    );
    const [read] = h.callsOn("list", levelZero(h.generation), h.callsBefore);
    await settle();
    expect(h.supervisor.status().state).toBe("paused");
    expect(read!.signal?.aborted).toBe(true);
    expect(h.logs.slice(h.logsBefore).map((line) => line.event)).toEqual(["stream.paused"]);
  });

  it("cancels the read and the prune in flight on stop, and logs nothing after", async () => {
    const h = await streaming();
    h.store.hang = true;
    await h.clock.next();
    await vi.waitFor(() =>
      expect(h.callsOn("list", levelZero(h.generation), h.callsBefore)).toHaveLength(1),
    );
    const [read] = h.callsOn("list", levelZero(h.generation), h.callsBefore);
    const [prune] = h.callsOn("list", venuePrefix(VENUE), h.callsBefore);
    expect(prune).toBeDefined();
    const logged = h.logs.length;
    await h.supervisor.stop();
    await settle();
    expect(read!.signal?.aborted).toBe(true);
    expect(prune!.signal?.aborted).toBe(true);
    expect(h.logs.slice(logged)).toEqual([]);
  });

  it("cancels the bucket check a failed read starts on stop, and logs nothing after", async () => {
    const h = await streaming();
    h.holdWhen((operation, key) => operation === "put" && key.startsWith(PROBE_PREFIX));
    h.store.down = true;
    await h.clock.next();
    await vi.waitFor(() => {
      const checks = h.calls
        .slice(h.callsBefore)
        .filter((call) => call.operation === "put" && call.key.startsWith(PROBE_PREFIX));
      expect(checks).toHaveLength(1);
    });
    const check = h.calls
      .slice(h.callsBefore)
      .find((call) => call.operation === "put" && call.key.startsWith(PROBE_PREFIX))!;
    const logged = h.logs.length;
    await h.supervisor.stop();
    await settle();
    expect(check.signal?.aborted).toBe(true);
    expect(h.logs.slice(logged)).toEqual([]);
  });
});

describe("opening", () => {
  const first = generationName(2, NODE, new Date(START));
  it.each([
    ["the safe-write check's write", "put", (key: string) => key.startsWith(PROBE_PREFIX)],
    ["the pointer read", "get", (key: string) => key === pointerKey(VENUE)],
    ["the claim", "put", (key: string) => key === markerKey(VENUE, first)],
    ["the read of the claim's time", "list", (key: string) => key === markerKey(VENUE, first)],
    [
      "the wait for the first full copy",
      "list",
      (key: string) => key === generationPrefix(VENUE, first),
    ],
    ["the pointer write", "put", (key: string) => key === pointerKey(VENUE)],
  ] as const)("cancels %s on stop, and logs nothing after", async (_, operation, picks) => {
    const h = await harness();
    const pick = (op: BucketOperation, key: string) => op === operation && picks(key);
    h.holdWhen(pick);
    await h.supervisor.start();
    await h.clock.until(() => {
      const opened = h.supervisor.status().generation;
      if (opened !== null && !h.store.has(fullCopyOf(opened))) h.store.upload(fullCopyOf(opened));
      return h.calls.some((call) => pick(call.operation, call.key));
    });
    const held = h.calls.find((call) => pick(call.operation, call.key))!;
    expect(held.signal?.aborted).toBe(false);
    const logged = h.logs.length;
    await h.supervisor.stop();
    await settle();
    expect(held.signal?.aborted).toBe(true);
    expect(h.logs.slice(logged)).toEqual([]);
  });

  it("cancels the wait for the first full copy when the side file reaches the limit, and logs no failed listing after", async () => {
    const h = await harness();
    const waiting = (op: BucketOperation, key: string) =>
      op === "list" && key === generationPrefix(VENUE, first);
    h.holdWhen(waiting);
    await h.supervisor.start();
    await h.clock.until(() => h.calls.some((call) => waiting(call.operation, call.key)));
    const held = h.calls.find((call) => waiting(call.operation, call.key))!;
    expect(held.signal?.aborted).toBe(false);
    const logged = h.logs.length;
    h.setWal(LIMIT);
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.paused"));
    await settle();
    expect(held.signal?.aborted).toBe(true);
    await h.clock.until(() => {
      const opened = h.supervisor.status().generation;
      return opened !== null && opened !== first;
    });
    expect(h.logs.slice(logged).filter((line) => line.event === "stream.list_failed")).toEqual([]);
  });

  it("opens a second generation when a pointer write it cancelled lands after the next pointer read", async () => {
    const h = await harness();
    const put = h.store.put.bind(h.store);
    const get = h.store.get.bind(h.store);
    let held: StoreCall | undefined;
    let land: (() => void) | undefined;
    // The first pointer write answers its caller as cancelled, yet the bucket still takes it later.
    h.store.put = (key, body, condition, call) => {
      if (key !== pointerKey(VENUE) || held !== undefined) return put(key, body, condition, call);
      held = call ?? {};
      return new Promise((_, reject) => {
        call?.signal?.addEventListener("abort", () => reject(callCancelled("put", key)), {
          once: true,
        });
        land = () => {
          land = undefined;
          void put(key, body, condition);
        };
      });
    };
    // It lands just after the pointer is next read: the order that makes it a change.
    h.store.get = async (key, call) => {
      const answer = await get(key, call);
      if (key === pointerKey(VENUE) && held?.signal?.aborted) land?.();
      return answer;
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => held !== undefined);
    h.failWal();
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.open_failed"));
    expect(held!.signal?.aborted).toBe(true);
    h.failWal(false);
    await h.clock.until(() => h.litestream.replicas().length === 2);
    expect(land).toBeUndefined();
    const second = h.supervisor.status().generation!;
    h.store.upload(fullCopyOf(second));
    await h.clock.until(() => ["streaming", "refused"].includes(h.supervisor.status().state));
    expect(h.supervisor.status()).toMatchObject({
      state: "streaming",
      reason: null,
      generation: second,
    });
    expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(second);
  });
});

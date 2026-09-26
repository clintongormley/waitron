import { spawn } from "node:child_process";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@waitron/shared";
import { claimGeneration, generationPrefix, markerKey } from "./generations.js";
import { generationName } from "./names.js";
import {
  pointerKey,
  readPointer,
  SentPointers,
  writePointer,
  type SignedPointer,
} from "./pointer.js";
import { CommitLog } from "./freshness.js";
import { PROBE_PREFIX } from "./probe.js";
import type { BucketConfig } from "./s3-store.js";
import { FakeLitestream } from "./testing/fake-litestream.js";
import { SwitchableStore } from "./testing/switchable-store.js";
import {
  OPEN_RETRY_MS,
  PRUNE_EVERY_MS,
  READ_DEADLINE_MS,
  RESTART_BACKOFF_MS,
  StreamSupervisor,
  abortableSleep,
  exitCategory,
  type SupervisorDeps,
} from "./supervisor.js";

const VENUE = "venue-1";
const NODE = "node-a";
const START = "2026-09-23T12:00:00Z";
const LIMIT = 1_000;
const BUCKET: BucketConfig = {
  region: "eu-south-2",
  bucket: "venue-copies",
  prefix: "",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret-example",
};

/**
 * Time that moves only when a test says so. Every wait in the supervisor is one of these sleeps,
 * so `next()` wakes the earliest sleeper and moves the clock to its wake time.
 *
 * Three readings: `now()` is this box's time of day, which `step()` corrects without time passing;
 * `monotonic()` counts time passing and nothing else; `trueNow()` is the time of day the bucket
 * keeps, which a box's correction does not move.
 */
class ManualClock {
  readonly #start: number;
  #t: number;
  /** Starts far from any time of day, so a reading used as one shows. */
  #m = 5_000;
  #sleeping: { at: number; ms: number; wake: () => void }[] = [];
  readonly slept: number[] = [];

  constructor(start: string) {
    this.#start = Date.parse(start);
    this.#t = this.#start;
  }

  readonly now = (): Date => new Date(this.#t);

  readonly monotonic = (): number => this.#m;

  readonly trueNow = (): Date => new Date(this.#start + this.#m - 5_000);

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const entry = { at: this.#m + ms, ms, wake: () => resolve() };
      this.#sleeping.push(entry);
      signal.addEventListener(
        "abort",
        () => {
          this.#sleeping = this.#sleeping.filter((other) => other !== entry);
          resolve();
        },
        { once: true },
      );
    });

  advance(ms: number): void {
    this.#t += ms;
    this.#m += ms;
  }

  /** This box's time of day corrected by `ms`, as time sync does; no time passes. */
  step(ms: number): void {
    this.#t += ms;
  }

  /** Waits until something is asleep — the woken code has run as far as its next wait. */
  async asleep(timeout = 1_000): Promise<void> {
    await vi.waitFor(
      () => {
        if (this.#sleeping.length === 0) throw new Error("nothing is asleep yet");
      },
      { timeout },
    );
  }

  async next(): Promise<void> {
    while (!(await this.#wakeEarliest())) {
      // The sleeper `asleep()` saw was aborted before this resumed.
    }
  }

  /** Wakes sleepers one at a time until `done()` holds. */
  async until(done: () => boolean, limit = 100): Promise<void> {
    for (let i = 0; i <= limit; i += 1) {
      await this.asleep(300).catch(() => undefined);
      if (done()) return;
      if (i < limit) await this.#wakeEarliest();
    }
    throw new Error(`not reached after ${limit} wakes`);
  }

  /** False when the sleeper `asleep()` saw was aborted before this resumed. */
  async #wakeEarliest(): Promise<boolean> {
    await this.asleep();
    this.#sleeping.sort((a, b) => a.at - b.at);
    const entry = this.#sleeping.shift();
    if (entry === undefined) return false;
    const passed = Math.max(0, entry.at - this.#m);
    this.#m += passed;
    this.#t += passed;
    this.slept.push(entry.ms);
    entry.wake();
    return true;
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const fullCopyOf = (generation: string) =>
  `${generationPrefix(VENUE, generation)}0000/0000000000000001-0000000000000001.ltx`;
const markerOf = (generation: string) => markerKey(VENUE, generation);
const hex16 = (n: number) => n.toString(16).padStart(16, "0");

interface HarnessOptions {
  term?: number;
  venueId?: string;
  bucket?: BucketConfig;
  version?: string;
  versionExitCode?: number | null;
  versionHangs?: boolean;
  /** What successive fold-backs report, or throw; `true` once the list runs out. */
  foldResults?: (boolean | Error)[];
  /** What every `replicate` child prints. */
  replicateOutput?: string;
  /** The PID every `replicate` child reports. */
  pid?: number;
  readCommandLine?: SupervisorDeps["readCommandLine"];
  /** A `replicate` start that throws at once, as `spawn` does for arguments it cannot use. */
  replicateThrows?: boolean;
  litestreamBin?: string;
  stopWaitMs?: number;
  /** How far the bucket's clock runs ahead of this box's; negative when behind. */
  bucketAheadMs?: number;
  /** False gives `successor()` a record of the pointers sent of its own, not the first one's. */
  shareSentPointers?: boolean;
}

async function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const clock = new ManualClock(START);
  const store = new SwitchableStore(
    () => new Date(clock.trueNow().getTime() + (options.bucketAheadMs ?? 0)),
    events,
  );
  /** Every prefix a listing was answered for, in order. */
  const listed: string[] = [];
  const list = store.list.bind(store);
  store.list = async (prefix) => {
    const answer = await list(prefix);
    listed.push(prefix);
    return answer;
  };
  /** Writes the bucket check attempted, answered or not. */
  let probeWrites = 0;
  const put = store.put.bind(store);
  store.put = async (key, body, cond) => {
    if (key.startsWith(PROBE_PREFIX)) probeWrites += 1;
    return put(key, body, cond);
  };
  let listener: (() => void) | undefined;
  const litestream = new FakeLitestream(events);
  if (options.version !== undefined) litestream.version = options.version;
  if (options.versionExitCode !== undefined) litestream.versionExitCode = options.versionExitCode;
  litestream.versionHangs = options.versionHangs ?? false;
  litestream.replicateOutput = options.replicateOutput ?? "";
  litestream.pid = options.pid;
  const foldResults = [...(options.foldResults ?? [])];
  const directory = await mkdtemp(join(tmpdir(), "waitron-stream-"));
  const venueDbPath = join(directory, "venue.db");
  let wal = 0;
  let walFails = false;
  let walHeld: Promise<void> | undefined;
  let walWaiting = false;
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const sentPointers = new SentPointers();
  const deps: SupervisorDeps = {
    litestreamBin: options.litestreamBin ?? "litestream",
    venueDbPath,
    configDir: join(directory, "stream"),
    bucket: options.bucket ?? BUCKET,
    venueId: options.venueId ?? VENUE,
    nodeId: NODE,
    term: options.term ?? 2,
    sign: async (message) => `signed:${message.length}`,
    foldBack: async () => {
      events.push("fold");
      const result = foldResults.shift() ?? true;
      if (result instanceof Error) throw result;
      // A fold-back a reader held leaves the side file as large as it was.
      if (result) wal = 0;
      return { reclaimed: result };
    },
    walBytes: async () => {
      if (walHeld !== undefined) {
        walWaiting = true;
        await walHeld;
      }
      if (walFails) throw new Error("the side file could not be measured");
      return wal;
    },
    walLimitBytes: LIMIT,
    now: clock.now,
    monotonic: clock.monotonic,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    spawn: (bin, args, env) => {
      if (options.replicateThrows === true && args[0] === "replicate") {
        throw new Error("spawn refused its arguments");
      }
      return litestream.spawn(bin, args, env);
    },
    store,
    sleep: clock.sleep,
    onCommit: (next) => {
      listener = next;
      return () => {
        listener = undefined;
      };
    },
    sentPointers,
    ...(options.stopWaitMs === undefined ? {} : { stopWaitMs: options.stopWaitMs }),
    ...(options.readCommandLine === undefined ? {} : { readCommandLine: options.readCommandLine }),
  };
  const supervisor = new StreamSupervisor(deps);
  const successors: StreamSupervisor[] = [];
  cleanups.push(async () => {
    for (const next of successors) await next.stop();
    await supervisor.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    supervisor,
    /** The next supervisor on the same box and bucket, as a reload builds it. */
    sentPointers,
    successor: () => {
      const next = new StreamSupervisor(
        options.shareSentPointers === false ? { ...deps, sentPointers: new SentPointers() } : deps,
      );
      successors.push(next);
      return next;
    },
    store,
    litestream,
    clock,
    events,
    logs,
    directory,
    venueDbPath,
    setWal: (bytes: number) => {
      wal = bytes;
    },
    /** Holds every side-file measurement until the answer is released. */
    holdWal: () => {
      let release!: () => void;
      walHeld = new Promise((resolve) => (release = resolve));
      return {
        waiting: () => walWaiting,
        release: () => {
          walHeld = undefined;
          release();
        },
      };
    },
    failWal: (fails = true) => {
      walFails = fails;
    },
    /** The venue database committing now. */
    commit: () => listener?.(),
    listening: () => listener !== undefined,
    listed,
    probeWrites: () => probeWrites,
  };
}

async function streaming(options: HarnessOptions = {}) {
  const h = await harness(options);
  await h.supervisor.start();
  await h.clock.until(() => h.litestream.running() !== undefined);
  const generation = h.supervisor.status().generation!;
  h.store.upload(fullCopyOf(generation));
  await h.clock.until(() => h.supervisor.status().state === "streaming");
  return { ...h, generation };
}

const pointerFrom = (nodeId: string, term: number, generation: string): SignedPointer => ({
  body: { venueId: VENUE, term, nodeId, generation, writtenAt: new Date(START).toISOString() },
  signature: "another box",
});

describe("opening a generation", () => {
  it("claims the marker, starts Litestream, and moves the pointer only once the first full copy is in the bucket", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const generation = h.supervisor.status().generation!;
    expect(generation).toBe(generationName(2, NODE, new Date(START)));
    expect(h.supervisor.status().state).toBe("opening");

    // Litestream has uploaded something, but not a file that starts at the first transaction.
    h.store.upload(
      `${generationPrefix(VENUE, generation)}0000/0000000000000002-0000000000000002.ltx`,
    );
    await h.clock.next();
    await h.clock.asleep();
    expect(await readPointer(h.store, VENUE)).toBeNull();
    expect(h.supervisor.status().state).toBe("opening");

    h.store.upload(fullCopyOf(generation));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    const pointer = await readPointer(h.store, VENUE);
    expect(pointer?.pointer.body).toEqual({
      venueId: VENUE,
      term: 2,
      nodeId: NODE,
      generation,
      writtenAt: expect.any(String),
    });
    const order = h.events.filter(
      (event) =>
        event === `put ${markerOf(generation)}` ||
        event === "spawn replicate" ||
        event === `upload ${fullCopyOf(generation)}` ||
        (event.startsWith("put ") && event.endsWith("current.json")),
    );
    expect(order).toEqual([
      `put ${markerOf(generation)}`,
      "spawn replicate",
      `upload ${fullCopyOf(generation)}`,
      expect.stringMatching(/^put .*current\.json$/),
    ]);
  });

  it("gives Litestream the bucket key through its environment and nowhere else", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const child = h.litestream.running()!;
    expect(child.env).toEqual({
      WAITRON_STREAM_ACCESS_KEY_ID: "AKIAEXAMPLE",
      WAITRON_STREAM_SECRET_ACCESS_KEY: "secret-example",
    });
    expect(child.args).toEqual([
      "replicate",
      "-config",
      join(h.directory, "stream", "litestream.yml"),
    ]);
    const config = await readFile(join(h.directory, "stream", "litestream.yml"), "utf8");
    expect(config).not.toContain("secret-example");
    expect(config).toContain(
      `venues/${VENUE}/${h.supervisor.status().generation}?region=eu-south-2`,
    );
  });

  // Every check on what goes into Litestream's configuration and environment is made once, before
  // anything is written to the bucket: a refusal there is the settings' fault, and retrying it
  // would open a new, empty generation on every attempt.
  it.each([
    ["secretAccessKey", { ...BUCKET, secretAccessKey: "secret'example" }],
    ["bucket", { ...BUCKET, bucket: "venue/copies" }],
    ["prefix", { ...BUCKET, prefix: "a//b" }],
  ])(
    "refuses settings it cannot hand Litestream safely (%s), once, before touching the bucket",
    async (field, bucket) => {
      const h = await harness({ bucket });
      await h.supervisor.start();
      await vi.waitFor(() => expect(h.supervisor.status().state).toBe("refused"));
      expect(h.supervisor.status().reason).toBe("config_unsafe");
      expect(h.logs).toContainEqual({
        level: "error",
        event: "stream.config_unsafe",
        fields: { errorCode: "backup.stream_config_unsafe", field },
      });
      await expect(h.clock.asleep(300)).rejects.toThrow("nothing is asleep yet");
      expect(h.events).toEqual([]);
      expect(JSON.stringify(h.logs)).not.toContain("secret'example");
    },
  );

  it("refuses a venue id no key can be formed from, before touching the bucket", async () => {
    const h = await harness({ venueId: "venue/1" });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().state).toBe("refused"));
    expect(h.logs).toContainEqual({
      level: "error",
      event: "stream.config_unsafe",
      fields: { errorCode: "backup.stream_name_invalid", field: "venueId" },
    });
    expect(h.events).toEqual([]);
  });

  // Settings come from outside the type system (the vault), so a missing field is a refusal too,
  // not a supervisor that fails without saying why.
  it("refuses settings with a field missing, naming no field it cannot know", async () => {
    const h = await harness({ bucket: { ...BUCKET, prefix: undefined as unknown as string } });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().state).toBe("refused"));
    expect(h.supervisor.status().reason).toBe("config_unsafe");
    expect(h.logs).toContainEqual({
      level: "error",
      event: "stream.config_unsafe",
      fields: { errorCode: "unknown", field: undefined },
    });
    expect(h.events).toEqual([]);
  });

  it("starts a new generation from a clean local state", async () => {
    const h = await harness();
    const meta = join(h.directory, ".venue.db-litestream", "ltx", "0");
    mkdirSync(meta, { recursive: true });
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(existsSync(join(h.directory, ".venue.db-litestream"))).toBe(false);
  });

  // Review Focus 3: power was cut while Litestream ran. The next start finds Litestream's own
  // folder still describing the old generation, and last run's configuration still naming it. It
  // must open a new generation from a clean local state, under a configuration written afresh.
  it("starts cleanly after a power cut: a stale Litestream folder and configuration are replaced", async () => {
    const h = await harness();
    const stale = join(h.directory, ".venue.db-litestream", "ltx", "0");
    mkdirSync(stale, { recursive: true });
    writeFileSync(
      join(stale, "0000000000000007-0000000000000007.ltx"),
      "from before the power cut",
    );
    mkdirSync(join(h.directory, "stream"), { recursive: true });
    writeFileSync(
      join(h.directory, "stream", "litestream.yml"),
      'dbs:\n  - path: "/stale"\n    replica:\n      url: "s3://venue-copies/venues/venue-1/gen-1-node-a-20260922T000000Z"\n',
    );
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const generation = h.supervisor.status().generation!;
    expect(existsSync(join(h.directory, ".venue.db-litestream"))).toBe(false);
    const config = await readFile(join(h.directory, "stream", "litestream.yml"), "utf8");
    expect(config).toContain(generation);
    expect(config).not.toContain("gen-1-node-a-20260922T000000Z");
    h.store.upload(fullCopyOf(generation));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
  });

  it("never writes into a generation whose marker already exists; it takes the next second's name", async () => {
    const h = await harness();
    await claimGeneration(h.store, VENUE, generationName(2, NODE, new Date(START)));
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.supervisor.status().generation).toBe(
      generationName(2, NODE, new Date(Date.parse(START) + 1_000)),
    );
  });

  it("stops and refuses when another box moved the pointer after it was read", async () => {
    const h = await harness();
    await writePointer(
      h.store,
      VENUE,
      pointerFrom("node-b", 2, "gen-2-node-b-20260923T110000Z"),
      null,
    );
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const read = await readPointer(h.store, VENUE);
    await writePointer(
      h.store,
      VENUE,
      pointerFrom("node-b", 2, "gen-2-node-b-20260923T115959Z"),
      read!.etag,
    );
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "refused");
    expect(h.supervisor.status().reason).toBe("pointer_changed");
    expect(h.litestream.replicas().every((child) => child.killed)).toBe(true);
    expect((await readPointer(h.store, VENUE))?.pointer.body.nodeId).toBe("node-b");
  });

  it("stops and refuses when the pointer was deleted after it was read", async () => {
    const h = await harness();
    await writePointer(
      h.store,
      VENUE,
      pointerFrom("node-b", 2, "gen-2-node-b-20260923T110000Z"),
      null,
    );
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    await h.store.delete(pointerKey(VENUE));
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "refused");
    expect(h.supervisor.status().reason).toBe("pointer_changed");
    expect(h.store.has(pointerKey(VENUE))).toBe(false);
  });

  it("treats its own pointer write as done when only the answer was lost", async () => {
    const h = await harness();
    h.store.failNext({
      operation: "put",
      key: pointerKey(VENUE),
      error: new Error("connection reset after the write"),
      landed: true,
    });
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const generation = h.supervisor.status().generation!;
    h.store.upload(fullCopyOf(generation));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(generation);
    expect(h.logs.some((line) => line.event === "stream.pointer_write_failed")).toBe(true);
  });

  it("refuses to replace a pointer at a higher term, and starts nothing", async () => {
    const h = await harness({ term: 2 });
    await writePointer(
      h.store,
      VENUE,
      pointerFrom("node-b", 3, "gen-3-node-b-20260923T110000Z"),
      null,
    );
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().state).toBe("refused"));
    expect(h.supervisor.status().reason).toBe("pointer_newer_term");
    expect(h.litestream.replicas()).toHaveLength(0);
    expect(h.events.some((event) => event.endsWith("opened.json"))).toBe(false);
  });

  it("names a bucket that fails the safe-write check once, and waits instead of opening", async () => {
    const h = await harness();
    h.store.honoursConditions = false;
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().bucketProblem).not.toBeNull());
    const since = h.supervisor.status().bucketProblem!.since;
    expect(h.litestream.replicas()).toHaveLength(0);
    // Still failing on the next attempt: the same problem, not a new one.
    await h.clock.next();
    await h.clock.asleep();
    expect(h.supervisor.status().bucketProblem?.since).toBe(since);
    expect(h.logs.filter((line) => line.event === "stream.bucket_unusable")).toHaveLength(1);
    h.store.honoursConditions = true;
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.supervisor.status().bucketProblem).toBeNull();
  });

  // Boot calls `start()`. A start that waited for the bucket would hold boot, and so every sale,
  // for as long as the bucket did not answer.
  it("returns from start while the bucket never answers, and stop still ends it", async () => {
    const h = await harness();
    h.store.hang = true;
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().state).toBe("opening"));
    await h.supervisor.stop();
    expect(h.supervisor.status().state).toBe("off");
  });

  // `stop()` leaves behind a run blocked on a bucket call. If that call answers later, the run must
  // not go on to start a Litestream nothing would ever stop.
  it("starts nothing when a claim answers after stop gave up waiting for it", async () => {
    const h = await harness();
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let claiming = false;
    const put = h.store.put.bind(h.store);
    h.store.put = async (key, body, cond) => {
      if (key.endsWith("opened.json")) {
        claiming = true;
        await answered;
      }
      return put(key, body, cond);
    };
    await h.supervisor.start();
    await vi.waitFor(() => expect(claiming).toBe(true));
    await h.supervisor.stop();
    release();
    const marker = markerOf(generationName(2, NODE, new Date(START)));
    await vi.waitFor(() => expect(h.events).toContain(`put ${marker}`));
    await expect(
      vi.waitFor(() => expect(h.litestream.replicas()).not.toHaveLength(0), { timeout: 300 }),
    ).rejects.toThrow();
    expect(h.supervisor.status().state).toBe("off");
  });

  it("does not move the pointer when the full copy is seen only after stop", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const generation = h.supervisor.status().generation!;
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let listing = false;
    const list = h.store.list.bind(h.store);
    h.store.list = async (prefix) => {
      listing = true;
      await answered;
      return list(prefix);
    };
    h.store.upload(fullCopyOf(generation));
    await h.clock.until(() => listing); // the opening poll
    await h.supervisor.stop();
    release();
    await expect(
      vi.waitFor(
        () => expect(h.events.some((event) => event.endsWith("current.json"))).toBe(true),
        {
          timeout: 300,
        },
      ),
    ).rejects.toThrow();
    expect(h.supervisor.status()).toMatchObject({ state: "off", reason: "stopped" });
  });

  // A reader holding the side file keeps a fold-back from reclaiming it. Until the file is back under
  // the limit, restarting Litestream would only grow it again: one paused episode, one claim.
  it("stays paused while opening until a fold-back reclaims the side file", async () => {
    const h = await harness({ foldResults: Array<boolean>(12).fill(false) });
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    for (let tick = 0; tick < 10; tick += 1) await h.clock.next();
    await h.clock.asleep();
    expect(h.supervisor.status().state).toBe("paused");
    expect(h.events.filter((event) => event.endsWith("opened.json"))).toHaveLength(1);
    expect(h.litestream.replicas()).toHaveLength(1);
    expect(h.events.filter((event) => event === "fold").length).toBeGreaterThanOrEqual(10);
    expect(h.logs.filter((line) => line.event === "stream.paused")).toHaveLength(1);
    expect(h.logs.filter((line) => line.event === "stream.fold_back_busy")).toHaveLength(1);
    // The reader lets go: the next fold-back reclaims the file and a new generation opens.
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.events.filter((event) => event.endsWith("opened.json"))).toHaveLength(2);
  });

  it("does nothing more when stopped during start-up, and leaves the status stopped", async () => {
    let release!: (line: string | null) => void;
    const answered = new Promise<string | null>((resolve) => (release = resolve));
    let asked = false;
    const h = await harness({
      readCommandLine: async () => {
        asked = true;
        return answered;
      },
    });
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "litestream.pid"), "424242\n");
    await h.supervisor.start();
    await vi.waitFor(() => expect(asked).toBe(true));
    await h.supervisor.stop();
    release(null);
    await expect(
      vi.waitFor(() => expect(h.litestream.children).not.toHaveLength(0), { timeout: 300 }),
    ).rejects.toThrow();
    expect(h.supervisor.status()).toMatchObject({ state: "off", reason: "stopped" });
  });

  it("stops the version check when stopped while `litestream version` hangs", async () => {
    const h = await harness({ versionHangs: true });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.litestream.children).toHaveLength(1));
    await h.supervisor.stop();
    expect(h.litestream.children[0]!.killed).toBe(true);
    expect(h.supervisor.status()).toMatchObject({ state: "off", reason: "stopped" });
    expect(h.logs.some((line) => line.event === "stream.litestream_unavailable")).toBe(false);
  });

  it("waits, on stop, for a `litestream version` that is slow to exit once killed", async () => {
    const h = await harness({ versionHangs: true, stopWaitMs: 10 });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.litestream.children).toHaveLength(1));
    const probe = h.litestream.children[0]!;
    probe.kill = () => {
      probe.killed = true;
    };
    let stopped = false;
    const stopping = h.supervisor.stop().then(() => {
      stopped = true;
    });
    await vi.waitFor(() => expect(probe.killed).toBe(true));
    // Thirty times stop()'s wait for a run blocked on the bucket.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(stopped).toBe(false);
    probe.exit(null);
    await stopping;
  });

  it("refuses to run a Litestream that is not the pinned version, and touches no bucket", async () => {
    const h = await harness({ version: "0.5.18" });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().reason).toBe("litestream_unavailable"));
    expect(h.supervisor.status().state).toBe("off");
    expect(h.litestream.replicas()).toHaveLength(0);
    expect(h.events.filter((event) => event.startsWith("put "))).toEqual([]);
    expect(h.logs.find((line) => line.event === "stream.litestream_unavailable")?.fields).toEqual({
      exitCode: 0,
      reason: "version_mismatch",
    });
  });

  // A binary missing from PATH never starts: the real child handle settles with no exit code.
  it("refuses a Litestream that cannot be run at all", async () => {
    const h = await harness({ versionExitCode: null });
    await h.supervisor.start();
    await vi.waitFor(() => expect(h.supervisor.status().reason).toBe("litestream_unavailable"));
    expect(h.logs.find((line) => line.event === "stream.litestream_unavailable")?.fields).toEqual({
      exitCode: null,
      reason: "not_runnable",
    });
    expect(h.litestream.replicas()).toHaveLength(0);
  });

  it("gives up on a Litestream that does not answer `version`", async () => {
    const h = await harness({ versionHangs: true });
    await h.supervisor.start();
    await h.clock.next(); // the version timeout
    await vi.waitFor(() => expect(h.supervisor.status().reason).toBe("litestream_unavailable"));
    expect(h.litestream.children[0]!.killed).toBe(true);
  });

  it("retries opening after a bucket error, under a new generation", async () => {
    const h = await harness();
    h.store.failNext({
      operation: "put",
      key: markerOf(generationName(2, NODE, new Date(START))),
      error: new Error("connection reset after the write"),
      landed: true,
    });
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.logs.some((line) => line.event === "stream.open_failed")).toBe(true);
    expect(h.supervisor.status().generation).not.toBe(generationName(2, NODE, new Date(START)));
  });

  it("pauses while still opening if the side file reaches the limit first, then opens a new generation", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const first = h.supervisor.status().generation!;
    h.store.down = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    expect(h.litestream.running()).toBeUndefined();
    h.store.down = false;
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.supervisor.status().generation).not.toBe(first);
    expect(await readPointer(h.store, VENUE)).toBeNull();
  });

  it("logs a listing that fails while waiting for the full copy, and keeps waiting", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.down = true;
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.list_failed"));
    expect(h.logs.find((line) => line.event === "stream.list_failed")?.fields).toEqual({
      errorCode: "backup.stream_request_failed",
    });
    h.store.down = false;
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
  });

  it("pauses at the limit while waiting on a bucket that never answers whether the full copy landed", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.hang = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.events.includes("fold"));
    expect(h.litestream.replicas()[0]!.killed).toBe(true);
    expect(h.events.indexOf("kill replicate")).toBeLessThan(h.events.indexOf("fold"));
    expect(h.supervisor.status()).toMatchObject({ state: "paused", reason: "side_file_limit" });
  });

  it.each([
    ["keeps failing", () => Promise.reject(new Error("offline"))],
    ["never answers", () => new Promise<never>(() => {})],
  ])(
    "pauses at the limit while the pointer write %s, then resumes the same generation",
    async (_, pointerWrite) => {
      const h = await harness();
      const put = h.store.put.bind(h.store);
      let pointerWrites = 0;
      h.store.put = async (key, body, cond) => {
        if (!key.endsWith("current.json")) return put(key, body, cond);
        pointerWrites += 1;
        return pointerWrite();
      };
      await h.supervisor.start();
      await h.clock.until(() => h.litestream.running() !== undefined);
      const generation = h.supervisor.status().generation!;
      h.store.upload(fullCopyOf(generation));
      await h.clock.until(() => pointerWrites > 0);
      h.setWal(LIMIT);
      await h.clock.until(() => h.events.includes("fold"));
      expect(h.events.indexOf("kill replicate")).toBeLessThan(h.events.indexOf("fold"));
      await h.clock.until(() => h.litestream.running() !== undefined);
      expect(h.supervisor.status()).toMatchObject({ state: "opening", generation });
      expect(h.litestream.running()!.args).toEqual(h.litestream.replicas()[0]!.args);
      expect(h.events.filter((event) => event.endsWith("opened.json"))).toHaveLength(1);
    },
  );

  it("stops writing the pointer once the side file cannot be measured while it is being written", async () => {
    const h = await harness();
    const put = h.store.put.bind(h.store);
    let pointerWrites = 0;
    h.store.put = async (key, body, cond) => {
      if (!key.endsWith("current.json")) return put(key, body, cond);
      pointerWrites += 1;
      throw new Error("offline");
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => pointerWrites > 0);
    h.failWal();
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.open_failed"));
    const writes = pointerWrites;
    for (let wake = 0; wake < 10; wake += 1) await h.clock.next();
    expect(pointerWrites).toBe(writes);
  });

  it("waits for a pointer write it already sent before opening again, so that write never reads as another box's", async () => {
    const h = await harness();
    const put = h.store.put.bind(h.store);
    const get = h.store.get.bind(h.store);
    let release: (() => void) | undefined;
    h.store.put = async (key, body, cond) => {
      if (key === pointerKey(VENUE) && release === undefined) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return put(key, body, cond);
    };
    // The held write lands just after the pointer is next read: the order that makes it a change.
    h.store.get = async (key) => {
      const answer = await get(key);
      if (key === pointerKey(VENUE)) release?.();
      return answer;
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => release !== undefined);
    h.failWal();
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.open_failed"));
    h.failWal(false);
    // Asleep in its retry wait only if it gave the attempt up without waiting for the write.
    const retrying = await h.clock.asleep(300).then(
      () => true,
      () => false,
    );
    if (!retrying) release!();
    await h.clock.until(() => h.litestream.replicas().length === 2);
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

  it("still stops promptly while waiting for a pointer write already sent, and sends nothing new after", async () => {
    const h = await harness({ stopWaitMs: 10 });
    const put = h.store.put.bind(h.store);
    let release: (() => void) | undefined;
    h.store.put = async (key, body, cond) => {
      if (key === pointerKey(VENUE) && release === undefined) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return put(key, body, cond);
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => release !== undefined);
    h.failWal();
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.open_failed"));
    const before = h.events.length;
    await h.supervisor.stop();
    expect(h.supervisor.status()).toMatchObject({ state: "off", reason: "stopped" });
    release!();
    await vi.waitFor(() => expect(h.events.length).toBeGreaterThan(before));
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.events.slice(before)).toEqual([`put ${pointerKey(VENUE)}`]);
  });

  /**
   * The first supervisor's pointer write is held in flight, the supervisor is stopped with it still
   * unanswered, and the write lands just after the successor has read the pointer: the order that
   * makes the successor's own conditional write be refused.
   */
  async function reloadWithLateWrite(options: HarnessOptions = {}) {
    const h = await harness(options);
    const put = h.store.put.bind(h.store);
    const get = h.store.get.bind(h.store);
    let release: (() => void) | undefined;
    let armed = false;
    h.store.put = async (key, body, cond) => {
      if (key === pointerKey(VENUE) && release === undefined) {
        await new Promise<void>((resolve) => (release = resolve));
      }
      return put(key, body, cond);
    };
    h.store.get = async (key) => {
      const answer = await get(key);
      if (key === pointerKey(VENUE) && armed) release?.();
      return answer;
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => release !== undefined);
    await h.supervisor.stop();
    armed = true;
    const next = h.successor();
    await next.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    await vi.waitFor(() => expect(h.store.has(pointerKey(VENUE))).toBe(true));
    return { ...h, next };
  }

  it("takes a pointer its predecessor sent before a reload, landing late, as this box's own, and streams on", async () => {
    const h = await reloadWithLateWrite();
    const first = (await readPointer(h.store, VENUE))!.pointer.body.generation;
    const second = h.next.status().generation!;
    expect(first).not.toBe(second);
    h.store.upload(fullCopyOf(second));
    await h.clock.until(() => ["streaming", "refused"].includes(h.next.status().state));
    expect(h.next.status()).toMatchObject({ state: "streaming", reason: null, generation: second });
    expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(second);
  });

  it("takes a predecessor's late pointer as another box's when each keeps its own record of what was sent", async () => {
    const h = await reloadWithLateWrite({ shareSentPointers: false });
    h.store.upload(fullCopyOf(h.next.status().generation!));
    await h.clock.until(() => ["streaming", "refused"].includes(h.next.status().state));
    expect(h.next.status()).toMatchObject({ state: "refused", reason: "pointer_changed" });
  });

  it("retries in place, on the same generation, when the read after a refusal fails", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    const generation = h.supervisor.status().generation!;
    // A predecessor's pointer, landing after this supervisor read the pointer as absent.
    const late = pointerFrom(NODE, 2, "gen-2-node-a-20260923T110000Z");
    h.sentPointers.add(late);
    await writePointer(h.store, VENUE, late, null);
    const get = h.store.get.bind(h.store);
    let reads = 0;
    h.store.get = async (key) => {
      if (key === pointerKey(VENUE) && ++reads === 1) {
        throw new AppError("backup.stream_request_failed", {
          operation: "get",
          key,
          status: null,
          name: "ECONNRESET",
        });
      }
      return get(key);
    };
    h.store.upload(fullCopyOf(generation));
    await h.clock.until(
      () =>
        ["streaming", "refused"].includes(h.supervisor.status().state) ||
        h.litestream.replicas().length > 1,
    );
    expect(h.litestream.replicas()).toHaveLength(1);
    expect(h.supervisor.status()).toMatchObject({ state: "streaming", generation });
    expect(h.logs.map((line) => line.event)).toContain("stream.pointer_write_failed");
    expect(h.logs.map((line) => line.event)).not.toContain("stream.open_failed");
  });

  // A bucket whose reads lag its conditional-write check keeps refusing the write while showing a
  // pointer this box sent.
  it("waits between retries once a retry against its own pointer is refused again", async () => {
    const h = await harness();
    const own = pointerFrom(NODE, 2, "gen-2-node-a-20260923T110000Z");
    h.sentPointers.add(own);
    await writePointer(h.store, VENUE, own, null);
    const put = h.store.put.bind(h.store);
    const get = h.store.get.bind(h.store);
    let writes = 0;
    h.store.put = async (key, body, cond) => {
      if (key !== pointerKey(VENUE)) return put(key, body, cond);
      writes += 1;
      throw new AppError("backup.stream_precondition_failed", { key });
    };
    h.store.get = async (key) => {
      // Through the event loop, so a retry that never waits still lets this test run.
      await new Promise((resolve) => setImmediate(resolve));
      return get(key);
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => writes >= 2);
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(writes).toBe(2);
    const slept = h.clock.slept.length;
    await h.clock.until(() => writes === 3);
    expect(h.clock.slept.slice(slept)).toContain(OPEN_RETRY_MS);
    expect(h.supervisor.status().state).toBe("opening");
    expect(h.litestream.replicas()).toHaveLength(1);
  });

  // Two reloads, each leaving a pointer write unanswered; the OLDER one lands after the third
  // supervisor reads the pointer. A record that kept fewer than three pointers would have
  // forgotten it.
  it("takes the oldest of two predecessors' late pointers as its own, after two reloads", async () => {
    const h = await harness();
    await writePointer(
      h.store,
      VENUE,
      pointerFrom("node-b", 2, "gen-2-node-b-20260923T110000Z"),
      null,
    );
    const put = h.store.put.bind(h.store);
    const get = h.store.get.bind(h.store);
    const held: (() => void)[] = [];
    let holding = true;
    h.store.put = async (key, body, cond) => {
      if (key === pointerKey(VENUE) && holding) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return put(key, body, cond);
    };
    let armed = false;
    h.store.get = async (key) => {
      const answer = await get(key);
      if (key === pointerKey(VENUE) && armed) for (const release of held) release();
      return answer;
    };
    const opened = async (supervisor: StreamSupervisor, writesHeld: number) => {
      await supervisor.start();
      await h.clock.until(() => h.litestream.running() !== undefined);
      const generation = supervisor.status().generation!;
      h.store.upload(fullCopyOf(generation));
      await h.clock.until(() => held.length === writesHeld);
      await supervisor.stop();
      return generation;
    };
    const first = await opened(h.supervisor, 1);
    await opened(h.successor(), 2);
    holding = false;
    armed = true;
    const third = h.successor();
    await third.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    await vi.waitFor(async () =>
      expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(first),
    );
    const generation = third.status().generation!;
    h.store.upload(fullCopyOf(generation));
    await h.clock.until(() => ["streaming", "refused"].includes(third.status().state));
    expect(third.status()).toMatchObject({ state: "streaming", generation });
    expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(generation);
  });

  // The pointers a rebuilt twin or a later term would write: the same node id is not this box.
  it.each([
    { who: "another node at the same term", nodeId: "node-b", term: 2 },
    {
      who: "this node's id at the same term, from bytes this box never sent",
      nodeId: NODE,
      term: 2,
    },
    { who: "this node's id at a higher term", nodeId: NODE, term: 3 },
  ])(
    "still refuses, after a reload, a pointer from $who written over the late one",
    async ({ nodeId, term }) => {
      const h = await reloadWithLateWrite();
      const late = await readPointer(h.store, VENUE);
      const foreign = pointerFrom(nodeId, term, `gen-${term}-${nodeId}-20260923T115959Z`);
      await writePointer(h.store, VENUE, foreign, late!.etag);
      h.store.upload(fullCopyOf(h.next.status().generation!));
      await h.clock.until(() => ["streaming", "refused"].includes(h.next.status().state));
      expect(h.next.status()).toMatchObject({ state: "refused", reason: "pointer_changed" });
      expect((await readPointer(h.store, VENUE))?.pointer).toEqual(foreign);
    },
  );

  it("does nothing more when started twice, and nothing at all when stopped before it started", async () => {
    const h = await harness();
    await h.supervisor.stop();
    expect(h.supervisor.status().state).toBe("off");
    expect(h.events).toEqual([]);
    await h.supervisor.start();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.events.filter((event) => event === "spawn version")).toHaveLength(1);
    expect(h.litestream.replicas()).toHaveLength(1);
  });
});

describe("while streaming", () => {
  it("restarts Litestream when it exits, backing off, and starts the backoff again after a healthy run", async () => {
    const h = await streaming();
    h.litestream.running()!.exit(1);
    await h.clock.until(() => h.litestream.replicas().length === 2);
    expect(h.clock.slept.at(-1)).toBe(1_000);
    h.litestream.running()!.exit(1);
    await h.clock.until(() => h.litestream.replicas().length === 3);
    expect(h.clock.slept.at(-1)).toBe(2_000);
    h.clock.advance(61_000);
    h.litestream.running()!.exit(1);
    await h.clock.until(() => h.litestream.replicas().length === 4);
    expect(h.clock.slept.at(-1)).toBe(1_000);
    expect(h.logs.filter((line) => line.event === "stream.litestream_exited")).toHaveLength(3);
  });

  // Review Focus 4: the bucket's key is revoked (or the bucket deleted) while the venue trades, and
  // Litestream exits at once every time it is started. It is restarted at a widening interval that
  // settles at one minute — never in a tight loop — and nothing else waits on it.
  it("restarts a Litestream that keeps exiting at once no faster than the backoff, settling at a minute", async () => {
    const h = await streaming();
    h.store.denied = true;
    for (let restart = 0; restart < 9; restart += 1) {
      const before = h.litestream.replicas().length;
      h.litestream.running()!.exit(1);
      await h.clock.until(() => h.litestream.replicas().length === before + 1);
    }
    const waits = h.logs
      .filter((line) => line.event === "stream.litestream_exited")
      .map((line) => line.fields?.restartInMs);
    expect(waits).toEqual([...RESTART_BACKOFF_MS, 60_000, 60_000]);
    expect(h.events).not.toContain("fold");
    expect(h.supervisor.status().state).toBe("streaming");
  });

  it("stops a Litestream that is waiting out its backoff", async () => {
    const h = await streaming();
    const child = h.litestream.running()!;
    child.exit(1);
    await vi.waitFor(() =>
      expect(h.logs.some((line) => line.event === "stream.litestream_exited")).toBe(true),
    );
    await h.supervisor.stop();
    expect(h.litestream.replicas()).toHaveLength(1);
    expect(h.supervisor.status().state).toBe("off");
  });

  it("pauses at the side-file limit: stops Litestream, then folds the file back, then waits for the bucket", async () => {
    const h = await streaming();
    h.store.down = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    expect(h.supervisor.status().reason).toBe("side_file_limit");
    expect(h.litestream.running()).toBeUndefined();
    expect(h.events.indexOf("kill replicate")).toBeLessThan(h.events.indexOf("fold"));

    // Still unreachable: it stays paused and starts nothing.
    await h.clock.next();
    await h.clock.asleep();
    expect(h.supervisor.status().state).toBe("paused");
    expect(h.litestream.running()).toBeUndefined();

    h.store.down = false;
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect(h.supervisor.status().generation).toBe(h.generation);
    expect(h.litestream.running()).toBeDefined();
    expect(h.logs.some((line) => line.event === "stream.resumed")).toBe(true);
  });

  // The S3 client sets no request timeout: a listing sent to a server that accepts the connection
  // and never replies was still pending after 20,000 ms (`@smithy/node-http-handler` 4.12.1).
  it("asks the bucket again when a question during the pause goes unanswered, and resumes once one is answered", async () => {
    const h = await streaming();
    const list = h.store.list.bind(h.store);
    let questions = 0;
    h.store.list = async (prefix) => {
      if (prefix.endsWith("/0000/") && h.supervisor.status().state === "paused") {
        questions += 1;
        if (questions === 1) await new Promise<never>(() => {});
      }
      return list(prefix);
    };
    h.setWal(LIMIT);
    await h.clock.until(() => questions === 1);
    expect(h.supervisor.status().state).toBe("paused");

    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect(questions).toBe(2);
    expect(h.clock.slept).toContain(READ_DEADLINE_MS);
    expect(h.supervisor.status().generation).toBe(h.generation);
    expect(h.litestream.running()).toBeDefined();
  });

  it("stays paused when a question during the pause throws before it is sent, and resumes once one is answered", async () => {
    const h = await streaming();
    const list = h.store.list.bind(h.store);
    let questions = 0;
    h.store.list = (prefix) => {
      if (prefix.endsWith("/0000/") && h.supervisor.status().state === "paused") {
        questions += 1;
        if (questions === 1) throw new Error("thrown before any request");
      }
      return list(prefix);
    };
    h.setWal(LIMIT);
    await h.clock.until(() => questions === 1);
    expect(h.supervisor.status().state).toBe("paused");

    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect(questions).toBe(2);
    expect(h.supervisor.status().generation).toBe(h.generation);
    expect(h.litestream.running()).toBeDefined();
  });

  // A restore reads the pointer's generation, so a pause must leave that generation whole and still
  // the one being written: Litestream restarted after an outside fold-back uploads a full copy into
  // the same generation, from its own local state. The restore itself needs the real binary; this
  // pins the supervisor's side of it.
  it("keeps the paused generation restorable: the same pointer, marker, configuration and local state", async () => {
    const h = await streaming();
    const meta = join(h.directory, ".venue.db-litestream");
    mkdirSync(meta, { recursive: true });
    const configPath = join(h.directory, "stream", "litestream.yml");
    const before = h.litestream.running()!;
    h.store.down = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    h.store.down = false;
    await h.clock.until(() => h.supervisor.status().state === "streaming");

    expect((await readPointer(h.store, VENUE))?.pointer.body.generation).toBe(h.generation);
    expect(h.events.filter((event) => event.endsWith("opened.json"))).toEqual([
      `put ${markerOf(h.generation)}`,
    ]);
    expect(await readFile(configPath, "utf8")).toContain(`venues/${VENUE}/${h.generation}?`);
    const after = h.litestream.running()!;
    expect(after).not.toBe(before);
    expect(after.args).toEqual(before.args);
    expect(after.args).toEqual(["replicate", "-config", configPath]);
    expect(existsSync(meta)).toBe(true);
  });

  it("folds the side file back again on the next tick when a reader held it the first time", async () => {
    const h = await streaming({ foldResults: [false, true] });
    h.store.down = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    await h.clock.next();
    await h.clock.asleep();
    expect(h.events.filter((event) => event === "fold")).toHaveLength(2);
    expect(h.logs.some((line) => line.event === "stream.fold_back_busy")).toBe(true);
  });

  it("logs a fold-back that fails and tries it again on the next tick", async () => {
    const h = await streaming({ foldResults: [new Error("disk I/O error"), true] });
    h.store.down = true;
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    await h.clock.next();
    await h.clock.asleep();
    expect(h.events.filter((event) => event === "fold")).toHaveLength(2);
    expect(h.logs).toContainEqual({
      level: "error",
      event: "stream.fold_back_failed",
      fields: { errorCode: "unknown" },
    });
  });

  // The limit is checked on the tick; with no measurement it cannot be kept, so the supervisor
  // stops rather than stream on unwatched.
  it("stops Litestream and reads off when the side file cannot be measured", async () => {
    const h = await streaming();
    h.failWal();
    await h.clock.until(() => h.supervisor.status().state === "off");
    expect(h.supervisor.status().reason).toBe("supervisor_failed");
    expect(h.litestream.running()).toBeUndefined();
    expect(h.logs).toContainEqual({
      level: "error",
      event: "stream.supervisor_failed",
      fields: { errorCode: "unknown" },
    });
  });

  it("stays paused, with Litestream stopped, while fold-backs keep failing to reclaim the side file", async () => {
    const h = await streaming({ foldResults: Array<boolean>(12).fill(false) });
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    for (let tick = 0; tick < 10; tick += 1) await h.clock.next();
    await h.clock.asleep();
    expect(h.supervisor.status().state).toBe("paused");
    expect(h.litestream.replicas()).toHaveLength(1);
    expect(h.litestream.running()).toBeUndefined();
    expect(h.logs.filter((line) => line.event === "stream.paused")).toHaveLength(1);
    expect(h.logs.filter((line) => line.event === "stream.fold_back_busy")).toHaveLength(1);
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect(h.supervisor.status().generation).toBe(h.generation);
    expect(h.litestream.replicas()).toHaveLength(2);
  });

  it("stays paused while every fold-back throws, and says so once", async () => {
    const failure = new Error("disk I/O error");
    const h = await streaming({ foldResults: Array<Error>(12).fill(failure) });
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
    for (let tick = 0; tick < 10; tick += 1) await h.clock.next();
    await h.clock.asleep();
    expect(h.supervisor.status().state).toBe("paused");
    expect(h.litestream.replicas()).toHaveLength(1);
    expect(h.logs.filter((line) => line.event === "stream.fold_back_failed")).toHaveLength(1);
  });

  it("does not pause, fold or change the status when the side file is measured only after stop", async () => {
    const h = await streaming();
    const held = h.holdWal();
    h.setWal(LIMIT);
    await h.clock.next(); // the streaming tick
    await vi.waitFor(() => expect(held.waiting()).toBe(true));
    await h.supervisor.stop();
    held.release();
    await expect(
      vi.waitFor(() => expect(h.events).toContain("fold"), { timeout: 300 }),
    ).rejects.toThrow();
    expect(h.logs.some((line) => line.event === "stream.paused")).toBe(false);
    expect(h.supervisor.status()).toMatchObject({ state: "off", reason: "stopped" });
  });

  // An unhandled rejection ends the server process, and a keeper loop that died would leave
  // Litestream running with nothing restarting it.
  it("keeps supervising when the PID record cannot be written, and stops cleanly", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = await harness({ pid: 424_242 });
      // A directory where the record belongs: the write fails, and so does removing it.
      mkdirSync(join(h.directory, "stream", "litestream.pid"), { recursive: true });
      await h.supervisor.start();
      await h.clock.until(() => h.litestream.running() !== undefined);
      await vi.waitFor(() =>
        expect(h.logs.some((line) => line.event === "stream.pid_record_failed")).toBe(true),
      );
      h.litestream.running()!.exit(1);
      await h.clock.until(() => h.litestream.replicas().length === 2);
      await h.supervisor.stop();
      expect(h.supervisor.status().state).toBe("off");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("stops and reads off when Litestream cannot be started at all, rather than failing unseen", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const h = await harness({ replicateThrows: true });
      await h.supervisor.start();
      await vi.waitFor(() => expect(h.supervisor.status().reason).toBe("supervisor_failed"));
      expect(h.supervisor.status().reason).toBe("supervisor_failed");
      expect(h.logs).toContainEqual({
        level: "error",
        event: "stream.supervisor_failed",
        fields: { errorCode: "unknown" },
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("waits, on stop, for a Litestream a pause is still stopping", async () => {
    const h = await streaming({ stopWaitMs: 10 });
    const child = h.litestream.running()!;
    child.kill = () => {
      child.killed = true;
    };
    h.setWal(LIMIT);
    await h.clock.next(); // the streaming tick
    await vi.waitFor(() => expect(child.killed).toBe(true));
    let stopped = false;
    const stopping = h.supervisor.stop().then(() => {
      stopped = true;
    });
    // Thirty times stop()'s wait for a run blocked on the bucket.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(stopped).toBe(false);
    child.exit(null);
    await stopping;
  });

  it("stop kills Litestream and reads off", async () => {
    const h = await streaming();
    const child = h.litestream.running()!;
    await h.supervisor.stop();
    expect(child.killed).toBe(true);
    expect(h.supervisor.status().state).toBe("off");
    expect(h.logs.some((line) => line.event === "stream.supervisor_failed")).toBe(false);
  });
});

const DAY = 24 * 60 * 60_000;

// Reconciliation N25: Litestream tidies only the generation it writes (spec §4.4), so the
// supervisor prunes the others, from its streaming tick, at most once a day.
describe("generation housekeeping", () => {
  /** A generation of this venue whose one object was last written at `at`, on the bucket's clock. */
  const oldGeneration = (h: { store: SwitchableStore }, name: string, at: number) =>
    h.store.upload(fullCopyOf(name), new Date(at));

  it("prunes an old generation from the streaming tick, at most once a day, and never the live one", async () => {
    const h = await streaming();
    const old = generationName(1, "node-old", new Date(Date.parse(START) - 9 * DAY));
    oldGeneration(h, old, Date.parse(START) - 8 * DAY);
    // Eight days on, the live generation's own objects are as old as the window too.
    h.clock.advance(8 * DAY);
    await h.clock.next(); // the streaming tick
    await vi.waitFor(() => expect(h.store.has(fullCopyOf(old))).toBe(false));
    expect(h.store.has(fullCopyOf(h.generation))).toBe(true);
    expect(h.store.has(markerOf(h.generation))).toBe(true);
    expect(h.logs).toContainEqual({
      level: "info",
      event: "stream.generations_pruned",
      fields: { count: 1 },
    });

    // Once a day: a second old generation waits for the next day's tick.
    const older = generationName(1, "node-older", new Date(Date.parse(START) - 10 * DAY));
    oldGeneration(h, older, Date.parse(START) - 10 * DAY);
    await h.clock.next();
    await h.clock.asleep();
    expect(h.store.has(fullCopyOf(older))).toBe(true);
    h.clock.advance(PRUNE_EVERY_MS);
    await h.clock.next();
    await vi.waitFor(() => expect(h.store.has(fullCopyOf(older))).toBe(false));
    expect(h.store.has(fullCopyOf(h.generation))).toBe(true);
  });

  it("logs a prune the bucket refuses, and streams on", async () => {
    const h = await streaming();
    h.store.denied = true;
    await h.clock.next(); // the streaming tick
    await vi.waitFor(() =>
      expect(h.logs).toContainEqual({
        level: "warn",
        event: "stream.prune_failed",
        fields: { errorCode: "backup.stream_request_failed" },
      }),
    );
    expect(h.supervisor.status().state).toBe("streaming");
  });

  // A bucket that never answers must not hold the tick: the side-file limit is checked there.
  it("does not wait for the prune: a bucket that never answers still lets the tick pause at the limit", async () => {
    const h = await streaming();
    h.store.hang = true;
    h.clock.advance(8 * DAY);
    await h.clock.next(); // this tick starts a prune that never returns
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
  });
});

// Reconciliation N20: the recovery page shows the log's tail to anyone on the box's network
// (`apps/server/src/recovery-surface.ts`), and Litestream's output can name the bucket, the
// endpoint and the access key id. Only the exit code and a fixed word are logged.
describe("what the supervisor logs about Litestream", () => {
  it("logs an exit by its code and a fixed category, never the output", async () => {
    const h = await streaming({
      replicateOutput:
        'level=ERROR msg="access denied" bucket=venue-copies key=AKIAEXAMPLE secret=secret-example\n',
    });
    h.litestream.running()!.exit(1);
    await h.clock.until(() => h.litestream.replicas().length === 2);
    const exited = h.logs.find((line) => line.event === "stream.litestream_exited")!;
    expect(exited.fields).toEqual({ exitCode: 1, category: "bucket_refused", restartInMs: 1_000 });
    const logged = JSON.stringify(h.logs);
    for (const text of ["AKIAEXAMPLE", "secret-example", "venue-copies", "access denied"]) {
      expect(logged).not.toContain(text);
    }
  });

  it.each([
    [1, "write /data/venue.db-wal: no space left on device", "disk_full"],
    [1, "operation error S3: PutObject, api error InvalidAccessKeyId", "bucket_refused"],
    [1, "dial tcp: lookup s3.example.net: no such host", "bucket_unreachable"],
    [null, "", "signal"],
    [2, "something else entirely", "other"],
  ] as const)("names exit %s with output %j as %s", (code, output, category) => {
    expect(exitCategory(code, output)).toBe(category);
  });
});

// Reconciliation N21: a server that died without stopping its Litestream (a development machine's
// Esc, a killed parent) leaves one running. The next start stops it — only when the recorded PID's
// command line is this box's own `replicate -config <its configuration>`.
describe("a Litestream left running by a server that died", () => {
  /**
   * A process whose command line reads `<binDir>/<name> replicate -config <config>`: `<name>` is a
   * link to node, which runs the file `replicate` in `binDir`. Resolves once it has started.
   */
  async function processNamed(
    binDir: string,
    name: string,
    config: string,
    { ignoresTerm = false } = {},
  ) {
    const bin = join(binDir, name);
    if (!existsSync(bin)) symlinkSync(process.execPath, bin);
    writeFileSync(
      join(binDir, "replicate"),
      `${ignoresTerm ? 'process.on("SIGTERM", () => {});' : ""}console.log("ready");setInterval(() => {}, 1000);`,
    );
    const child = spawn(bin, ["replicate", "-config", config], {
      cwd: binDir,
      stdio: ["ignore", "pipe", "ignore"],
    });
    cleanups.push(async () => {
      child.kill("SIGKILL");
    });
    await once(child.stdout, "data");
    return child;
  }

  async function binDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "waitron-stream-bin-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    return directory;
  }

  it.each([
    ["another configuration file", "litestream", (config: string) => `${config}.other`],
    ["another executable", "not-litestream", (config: string) => config],
  ])("leaves alone a recorded PID whose command line names %s", async (_, name, configOf) => {
    const binDir = await binDirectory();
    const h = await harness({ litestreamBin: join(binDir, "litestream") });
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    const stranger = await processNamed(binDir, name, configOf(join(configDir, "litestream.yml")));
    writeFileSync(join(configDir, "litestream.pid"), `${stranger.pid}\n`);
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(stranger.signalCode).toBeNull();
    expect(stranger.exitCode).toBeNull();
    expect(h.logs.some((line) => line.event === "stream.leftover_stopped")).toBe(false);
  });

  it("records its child's PID beside the configuration, and removes the record when stopped", async () => {
    const h = await streaming({ pid: 424_242 });
    expect(await readFile(join(h.directory, "stream", "litestream.pid"), "utf8")).toBe("424242\n");
    await h.supervisor.stop();
    expect(existsSync(join(h.directory, "stream", "litestream.pid"))).toBe(false);
  });

  it("stops a leftover whose PID and command line are this box's Litestream, before starting its own", async () => {
    const binDir = await binDirectory();
    const h = await harness({ litestreamBin: join(binDir, "litestream") });
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    const leftover = await processNamed(binDir, "litestream", join(configDir, "litestream.yml"));
    const gone = once(leftover, "exit");
    writeFileSync(join(configDir, "litestream.pid"), `${leftover.pid}\n`);
    await h.supervisor.start();
    expect((await gone)[1]).toBe("SIGTERM");
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.logs.some((line) => line.event === "stream.leftover_stopped")).toBe(true);
  });

  it("kills a leftover that ignores the polite signal, after the grace", async () => {
    const binDir = await binDirectory();
    const h = await harness({ litestreamBin: join(binDir, "litestream") });
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    const leftover = await processNamed(binDir, "litestream", join(configDir, "litestream.yml"), {
      ignoresTerm: true,
    });
    let signal: string | null | undefined;
    leftover.on("exit", (_code, received) => (signal = received));
    writeFileSync(join(configDir, "litestream.pid"), `${leftover.pid}\n`);
    await h.supervisor.start();
    await h.clock.until(() => signal !== undefined);
    expect(signal).toBe("SIGKILL");
    await h.clock.until(() => h.litestream.running() !== undefined);
  });

  it("does not SIGKILL a PID whose command line changed during the grace", async () => {
    const stubborn = spawn("/bin/sh", ["-c", "trap '' TERM; echo ready; sleep 30; :"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      await new Promise((resolve) => stubborn.stdout.once("data", resolve));
      let asked = 0;
      const h = await harness({
        readCommandLine: async () => {
          asked += 1;
          return asked === 1
            ? `litestream replicate -config ${join(h.directory, "stream", "litestream.yml")}`
            : "some other program";
        },
      });
      const configDir = join(h.directory, "stream");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "litestream.pid"), `${stubborn.pid}\n`);
      await h.supervisor.start();
      // The version check starts once the sweep, grace included, is over.
      await h.clock.until(() => h.litestream.children.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(stubborn.signalCode).toBeNull();
      expect(stubborn.exitCode).toBeNull();
    } finally {
      stubborn.kill("SIGKILL");
    }
  });

  it("leaves alone a process whose command line is not this box's Litestream", async () => {
    const h = await harness();
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    const stranger = spawn("/bin/sh", ["-c", "sleep 30; :"], { stdio: "ignore" });
    try {
      writeFileSync(join(configDir, "litestream.pid"), `${stranger.pid}\n`);
      await h.supervisor.start();
      await h.clock.until(() => h.litestream.running() !== undefined);
      expect(stranger.exitCode).toBeNull();
      expect(() => process.kill(stranger.pid!, 0)).not.toThrow();
    } finally {
      stranger.kill("SIGKILL");
    }
  });

  // PID 1 is init, and a record that is not a number names no process: neither is ever signalled,
  // nor its command line read.
  it.each(["not a pid\n", "1\n", "0\n"])(
    "ignores a PID record of %j, and removes it",
    async (record) => {
      const asked: number[] = [];
      const h = await harness({
        readCommandLine: async (pid) => {
          asked.push(pid);
          return null;
        },
      });
      const configDir = join(h.directory, "stream");
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, "litestream.pid"), record);
      await h.supervisor.start();
      await h.clock.until(() => h.litestream.running() !== undefined);
      expect(asked).toEqual([]);
      expect(existsSync(join(configDir, "litestream.pid"))).toBe(false);
    },
  );

  it("starts normally when the leftover exits between the check and the signal", async () => {
    const exited = spawn("/bin/sh", ["-c", "exit 0"], { stdio: "ignore" });
    await new Promise((resolve) => exited.on("exit", resolve));
    const h = await harness({
      readCommandLine: async () =>
        `litestream replicate -config ${join(h.directory, "stream", "litestream.yml")}`,
    });
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "litestream.pid"), `${exited.pid}\n`);
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.logs.some((line) => line.event === "stream.leftover_stopped")).toBe(false);
  });
});

const MINUTE = 60_000;

describe("freshness", () => {
  const l0 = (generation: string, n: number) =>
    `${generationPrefix(VENUE, generation)}0000/${hex16(n)}-${hex16(n)}.ltx`;
  const l1 = (generation: string, n: number) =>
    `${generationPrefix(VENUE, generation)}0001/${hex16(1)}-${hex16(n)}.ltx`;
  const listingsOf = (h: { listed: string[] }, level: string) =>
    h.listed.filter((prefix) => prefix.endsWith(`/${level}/`)).length;

  // The failing case this exists for: a Litestream that is up and says nothing wrong while nothing
  // reaches the bucket must read as behind, because freshness is read from the bucket.
  it("reads a running Litestream that uploads nothing as behind", async () => {
    const h = await streaming();
    h.commit();
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBeGreaterThanOrEqual(16));
    expect(h.litestream.running()).toBeDefined();
    expect(h.supervisor.status().lagMs).toBeGreaterThanOrEqual(15 * MINUTE);
  });

  it("reads zero once the bucket holds a file newer than the last commit", async () => {
    const h = await streaming();
    h.commit();
    h.clock.advance(1_000);
    h.store.upload(l0(h.generation, 2));
    const uploadedAt = h.clock.trueNow().toISOString();
    await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().lagMs).toBe(0));
    expect(h.supervisor.status().lastConfirmedUploadAt).toBe(uploadedAt);
  });

  it("is zero at open once the first full copy is in, whatever was committed before it", async () => {
    const h = await harness();
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.commit();
    h.clock.advance(2_000);
    expect(h.supervisor.status().lagMs).toBe(2_000);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    expect(h.supervisor.status().lagMs).toBe(0);
  });

  // A generation abandoned before the pointer named it is not the copy a restore reads, so what it
  // holds says nothing about the next one.
  it("does not count a commit as uploaded because a generation it abandoned held it", async () => {
    const h = await harness();
    const put = h.store.put.bind(h.store);
    h.store.put = async (key, body, cond) => {
      if (key.endsWith("current.json")) throw new Error("offline");
      return put(key, body, cond);
    };
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.commit();
    h.clock.advance(1_000);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.pointer_write_failed"));
    expect(h.supervisor.status().lagMs).toBe(0);
    h.failWal();
    await h.clock.until(() => h.logs.some((line) => line.event === "stream.open_failed"));
    h.failWal(false);
    await h.clock.until(() => h.litestream.replicas().length === 2);
    expect(h.supervisor.status().lagMs).toBeGreaterThan(0);
  });

  // Level 0 keeps a file five minutes after it is compacted; a change older than that can only be
  // confirmed from level 1.
  it("reads level 1 only once a change has waited longer than level 0 keeps a file", async () => {
    const h = await streaming();
    h.commit();
    h.clock.advance(30_000);
    h.store.upload(l1(h.generation, 2)); // compacted, and level 0 already tidied
    for (let tick = 0; tick < 5; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBe(5));
    expect(listingsOf(h, "0001")).toBe(0);
    expect(h.supervisor.status().lagMs).toBe(5 * MINUTE);
    await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().lagMs).toBe(0));
    expect(listingsOf(h, "0001")).toBe(1);
  });

  it("counts an upload stamped by a bucket whose clock runs behind as holding the commit before it", async () => {
    const h = await streaming({ bucketAheadMs: -10 * MINUTE });
    h.commit();
    h.clock.advance(1_000);
    h.store.upload(l0(h.generation, 2));
    await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().lagMs).toBe(0));
  });

  it("does not count changes as uploaded because the bucket's clock is ahead", async () => {
    const h = await streaming({ bucketAheadMs: 10 * MINUTE });
    h.commit();
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBeGreaterThanOrEqual(16));
    expect(h.supervisor.status().lagMs).toBeGreaterThanOrEqual(15 * MINUTE);
  });

  it("logs a marker it cannot read, keeps its last measure of the bucket's clock, and streams", async () => {
    const h = await harness();
    h.store.failNext({
      operation: "list",
      key: markerOf(generationName(2, NODE, new Date(START))),
      error: new Error("connection reset"),
    });
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.logs).toContainEqual({
      level: "warn",
      event: "stream.freshness_unreadable",
      fields: { errorCode: "unknown" },
    });
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
  });

  it("takes the bucket's clock as this box's when the listing does not show the marker", async () => {
    const h = await harness();
    const list = h.store.list.bind(h.store);
    h.store.list = async (prefix) => (prefix.endsWith("opened.json") ? [] : list(prefix));
    await h.supervisor.start();
    await h.clock.until(() => h.litestream.running() !== undefined);
    h.store.upload(fullCopyOf(h.supervisor.status().generation!));
    await h.clock.until(() => h.supervisor.status().state === "streaming");
    h.commit();
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBeGreaterThanOrEqual(16));
    expect(h.supervisor.status().lagMs).toBeGreaterThanOrEqual(15 * MINUTE);
    expect(h.logs.some((line) => line.event === "stream.freshness_unreadable")).toBe(false);
  });

  it("names a bucket that stops honouring the safe write, on its daily check", async () => {
    const h = await streaming();
    h.store.honoursConditions = false;
    h.clock.advance(24 * 60 * MINUTE);
    await h.clock.next();
    await vi.waitFor(() =>
      expect(h.supervisor.status().bucketProblem).toMatchObject({ reason: "create_only_ignored" }),
    );
  });

  // Review Focus 4, the half that needs this task's bucket reads: a key revoked (or a bucket
  // deleted) while streaming is named once — `bucketProblem`, which the backups alert source turns
  // into one `backup.stream_bucket_unusable` — however many reads it fails, and checked for it no
  // more than every ten minutes.
  it("names a key revoked while streaming once, however many reads it fails", async () => {
    const h = await streaming();
    h.store.denied = true;
    const writesBefore = h.probeWrites();
    h.commit();
    for (let tick = 0; tick < 30; tick += 1) await h.clock.next();
    await vi.waitFor(() =>
      expect(h.supervisor.status().bucketProblem).toMatchObject({ reason: "access_denied" }),
    );
    expect(h.logs.filter((line) => line.event === "stream.bucket_unusable")).toHaveLength(1);
    // Refused at its first write: one write per check, at minutes 1, 11 and 21.
    expect(h.probeWrites() - writesBefore).toBe(3);
  });

  it("clears a named bucket problem once the bucket works again, without waiting a day", async () => {
    const h = await streaming();
    h.store.denied = true;
    await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().bucketProblem).not.toBeNull());
    h.store.denied = false;
    for (let tick = 0; tick < 11; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().bucketProblem).toBeNull());
  });

  it("reads a bucket that does not answer as behind, not as unusable", async () => {
    const h = await streaming();
    h.store.down = true;
    h.commit();
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await vi.waitFor(() =>
      expect(h.logs).toContainEqual({
        level: "warn",
        event: "stream.bucket_unreachable",
        fields: { errorCode: "backup.stream_request_failed" },
      }),
    );
    expect(h.logs).toContainEqual({
      level: "warn",
      event: "stream.freshness_unreadable",
      fields: { errorCode: "backup.stream_request_failed" },
    });
    expect(h.supervisor.status().bucketProblem).toBeNull();
    expect(h.supervisor.status().lagMs).toBeGreaterThanOrEqual(15 * MINUTE);
  });

  // The recovery page shows the log's tail: an outage is logged when it starts and every ten
  // minutes while it lasts, not on every tick.
  it("logs a bucket it cannot read when that starts and every ten minutes after, not every minute", async () => {
    const h = await streaming();
    const unreadable = () =>
      h.logs.filter((line) => line.event === "stream.freshness_unreadable").length;
    h.store.down = true;
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(unreadable()).toBe(2);
    h.store.down = false;
    await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBe(1));
    h.store.down = true;
    await h.clock.next();
    await vi.waitFor(() => expect(unreadable()).toBe(3));
  });

  // Review Focus 1 across a correction: time sync steps this box's clock back after the
  // generation opened, and the bucket holds nothing after the commit.
  it("reads as behind when this box's clock is stepped back after the generation opened", async () => {
    const h = await streaming();
    h.clock.advance(MINUTE);
    h.store.upload(l0(h.generation, 2));
    h.clock.advance(MINUTE);
    h.clock.step(-5 * MINUTE);
    h.commit();
    for (let tick = 0; tick < 16; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBeGreaterThanOrEqual(16));
    expect(h.supervisor.status().lagMs).toBeGreaterThanOrEqual(15 * MINUTE);
  });

  // A box that booted with a stale clock and then synced: its clock jumps forward while the bucket
  // keeps up with every commit.
  it("reads as current when this box's clock is stepped forward after the generation opened", async () => {
    const h = await streaming();
    h.clock.step(5 * MINUTE);
    for (let tick = 0; tick < 16; tick += 1) {
      h.commit();
      h.clock.advance(1_000);
      h.store.upload(l0(h.generation, tick + 2));
      await h.clock.next();
      await vi.waitFor(() => expect(listingsOf(h, "0000")).toBe(tick + 1));
      expect(h.supervisor.status().lagMs).toBe(0);
    }
  });

  it("forgets the commits the bucket holds", async () => {
    const pending = vi.spyOn(CommitLog.prototype, "pending");
    try {
      const h = await streaming();
      h.commit();
      h.clock.advance(1_000);
      h.store.upload(l0(h.generation, 2));
      await h.clock.next();
      await vi.waitFor(() => expect(listingsOf(h, "0000")).toBe(1));
      h.supervisor.status();
      expect(pending.mock.results.at(-1)?.value).toEqual([]);
    } finally {
      pending.mockRestore();
    }
  });

  it("changes nothing when a read answers after stop, and checks no bucket", async () => {
    const h = await streaming();
    const list = h.store.list.bind(h.store);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let held = false;
    h.store.list = async (prefix) => {
      if (prefix.endsWith("/0000/")) {
        held = true;
        await answered;
      }
      return list(prefix);
    };
    await h.clock.next();
    await vi.waitFor(() => expect(held).toBe(true));
    await h.supervisor.stop();
    const writes = h.probeWrites();
    h.store.denied = true;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.probeWrites()).toBe(writes);
    expect(h.logs.some((line) => line.event === "stream.freshness_unreadable")).toBe(false);
  });

  it("does not name a bucket problem from a check that answers after stop", async () => {
    const h = await streaming();
    const put = h.store.put.bind(h.store);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let probing = false;
    h.store.put = async (key, body, cond) => {
      if (key.startsWith(PROBE_PREFIX)) {
        probing = true;
        await answered;
      }
      return put(key, body, cond);
    };
    h.store.down = true;
    await h.clock.next();
    await vi.waitFor(() => expect(probing).toBe(true));
    await h.supervisor.stop();
    h.store.down = false;
    h.store.denied = true;
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.supervisor.status().bucketProblem).toBeNull();
    expect(h.logs.some((line) => line.event === "stream.bucket_unusable")).toBe(false);
  });

  // A read given up on at the deadline answers with what the bucket held when it was asked, after
  // a newer read has already seen more.
  it("does not let a read given up on overwrite a newer read's answer", async () => {
    const h = await streaming();
    h.clock.advance(5_000);
    h.store.upload(l0(h.generation, 2));
    const u2 = h.clock.trueNow().toISOString();
    await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().lastConfirmedUploadAt).toBe(u2));
    const list = h.store.list.bind(h.store);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let hold = true;
    h.store.list = async (prefix) => {
      if (!prefix.endsWith("/0000/") || !hold) return list(prefix);
      hold = false;
      const snapshot = await list(prefix);
      await answered;
      return snapshot;
    };
    await h.clock.next();
    await vi.waitFor(() => expect(hold).toBe(false));
    h.store.upload(l0(h.generation, 3));
    const u3 = h.clock.trueNow().toISOString();
    for (let tick = 0; tick < 5; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(h.supervisor.status().lastConfirmedUploadAt).toBe(u3));
    expect(u3).not.toBe(u2);
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(h.supervisor.status().lastConfirmedUploadAt).toBe(u3);
  });

  it.each([
    { late: "a refusal", fail: "denied", event: "stream.bucket_unusable" },
    { late: "no answer", fail: "down", event: "stream.bucket_unreachable" },
  ] as const)(
    "does not let a bucket check from a read given up on, answering $late, overwrite a newer check's answer",
    async ({ fail, event }) => {
      const h = await streaming();
      const list = h.store.list.bind(h.store);
      h.store.list = async (prefix) => {
        if (prefix.endsWith("/0000/")) throw new Error("the listing was refused");
        return list(prefix);
      };
      const put = h.store.put.bind(h.store);
      let release!: () => void;
      const answered = new Promise<void>((resolve) => (release = resolve));
      let settle!: () => void;
      const settled = new Promise<void>((resolve) => (settle = resolve));
      let held = false;
      h.store.put = async (key, body, cond) => {
        if (!key.startsWith(PROBE_PREFIX) || held) return put(key, body, cond);
        held = true;
        try {
          await answered;
          return await put(key, body, cond);
        } finally {
          settle();
        }
      };
      await h.clock.next();
      await vi.waitFor(() => expect(held).toBe(true));
      const writes = h.probeWrites();
      // Replaced at five minutes; the replacing reads may check the bucket again from ten.
      for (let tick = 0; tick < 12; tick += 1) await h.clock.next();
      await vi.waitFor(() => expect(h.probeWrites()).toBeGreaterThan(writes));
      expect(h.supervisor.status().bucketProblem).toBeNull();
      h.store[fail] = true;
      release();
      await settled;
      // The rest of the late check runs on promises alone, so it has finished by the next turn.
      await new Promise((resolve) => setImmediate(resolve));
      expect(h.supervisor.status().bucketProblem).toBeNull();
      expect(h.logs.some((line) => line.event === event)).toBe(false);
    },
  );

  // The read that replaces a daily check's read starts no check of its own: its listing succeeds,
  // no problem is named, and the day is counted from the check given up on.
  it("names a bucket problem from a check whose read was given up on, when no newer check has started", async () => {
    const h = await streaming();
    const put = h.store.put.bind(h.store);
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    let held = false;
    h.store.put = async (key, body, cond) => {
      if (!key.startsWith(PROBE_PREFIX) || held) return put(key, body, cond);
      held = true;
      try {
        await answered;
        return await put(key, body, cond);
      } finally {
        settle();
      }
    };
    h.clock.advance(24 * 60 * MINUTE);
    await h.clock.next();
    await vi.waitFor(() => expect(held).toBe(true));
    const writes = h.probeWrites();
    const listings = listingsOf(h, "0000");
    for (let tick = 0; tick < 7; tick += 1) await h.clock.next();
    await vi.waitFor(() => expect(listingsOf(h, "0000")).toBeGreaterThan(listings));
    expect(h.logs).toContainEqual({
      level: "warn",
      event: "stream.freshness_unreadable",
      fields: { errorCode: "timeout" },
    });
    expect(h.probeWrites()).toBe(writes);
    h.store.denied = true;
    release();
    await settled;
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.supervisor.status().bucketProblem).toMatchObject({ reason: "access_denied" });
  });

  it("starts a new read once one has waited five minutes without an answer", async () => {
    const h = await streaming();
    const list = h.store.list.bind(h.store);
    const held: (() => void)[] = [];
    let holding = true;
    h.store.list = async (prefix) => {
      if (prefix.endsWith("/0000/") && holding) {
        await new Promise<void>((resolve) => held.push(resolve));
      }
      return list(prefix);
    };
    h.commit();
    h.clock.advance(1_000);
    h.store.upload(l0(h.generation, 2));
    for (let tick = 0; tick < 5; tick += 1) await h.clock.next();
    await h.clock.asleep();
    expect(held).toHaveLength(1);
    expect(h.supervisor.status().lagMs).toBeGreaterThan(0);
    await h.clock.next();
    await vi.waitFor(() => expect(held).toHaveLength(2));
    expect(h.logs).toContainEqual({
      level: "warn",
      event: "stream.freshness_unreadable",
      fields: { errorCode: "timeout" },
    });
    // The read given up on answers late: the one that replaced it is still the one in flight.
    held[0]!();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await h.clock.next();
    await h.clock.asleep();
    expect(held).toHaveLength(2);
    holding = false;
    held[1]!();
    await vi.waitFor(() => expect(h.supervisor.status().lagMs).toBe(0));
  });

  // A bucket that never answers must not hold the tick: the side-file limit is checked there.
  it("does not wait for the freshness read: a bucket that never answers still lets the tick pause at the limit", async () => {
    const h = await streaming();
    h.store.hang = true;
    await h.clock.next(); // this tick starts a freshness read that never returns
    h.setWal(LIMIT);
    await h.clock.until(() => h.supervisor.status().state === "paused");
  });

  it("reads the bucket once at a time: a tick while a read is still waiting starts no second one", async () => {
    const h = await streaming();
    const list = h.store.list.bind(h.store);
    let reads = 0;
    let release!: () => void;
    const answered = new Promise<void>((resolve) => (release = resolve));
    h.store.list = async (prefix) => {
      if (prefix.endsWith("/0000/")) {
        reads += 1;
        await answered;
      }
      return list(prefix);
    };
    for (let tick = 0; tick < 3; tick += 1) await h.clock.next();
    await h.clock.asleep();
    expect(reads).toBe(1);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    await h.clock.next();
    await vi.waitFor(() => expect(reads).toBe(2));
  });

  it("stops hearing commits once stopped", async () => {
    const h = await streaming();
    expect(h.listening()).toBe(true);
    await h.supervisor.stop();
    expect(h.listening()).toBe(false);
  });
});

// Addendum 1: a supervisor that has stopped for good is a problem, never "nothing waiting".
describe("freshness once the supervisor has stopped by itself", () => {
  it.each([
    [
      "supervisor_failed",
      async () => {
        const h = await streaming();
        h.failWal();
        await h.clock.until(() => h.supervisor.status().state === "off");
        return h;
      },
    ],
    [
      "litestream_unavailable",
      async () => {
        const h = await harness({ version: "0.5.18" });
        await h.supervisor.start();
        await vi.waitFor(() => expect(h.supervisor.status().reason).toBe("litestream_unavailable"));
        return h;
      },
    ],
  ])("keeps reading a growing lag after commits when off with %s", async (reason, reach) => {
    const h = await reach();
    expect(h.supervisor.status().reason).toBe(reason);
    h.commit();
    h.clock.advance(5 * MINUTE);
    expect(h.supervisor.status().lagMs).toBe(5 * MINUTE);
    h.clock.advance(10 * MINUTE);
    expect(h.supervisor.status().lagMs).toBe(15 * MINUTE);
  });
});

describe("constructed without test seams", () => {
  it("reads off until started", () => {
    const supervisor = new StreamSupervisor({
      litestreamBin: "litestream",
      venueDbPath: "/nowhere/venue.db",
      configDir: "/nowhere/stream",
      bucket: BUCKET,
      venueId: VENUE,
      nodeId: NODE,
      term: 0,
      sign: async () => "",
      foldBack: async () => ({ reclaimed: true }),
      walBytes: async () => 0,
      walLimitBytes: LIMIT,
      now: () => new Date(START),
      log: () => {},
      onCommit: () => () => {},
      sentPointers: new SentPointers(),
    });
    expect(supervisor.status()).toEqual({
      state: "off",
      generation: null,
      reason: null,
      stateSince: new Date(START).toISOString(),
      bucketProblem: null,
      lagMs: 0,
      lastConfirmedUploadAt: null,
    });
  });
});

describe("abortableSleep", () => {
  it("waits, ends early when aborted, and returns at once when already aborted", async () => {
    const started = performance.now();
    await abortableSleep(30, new AbortController().signal);
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
    const controller = new AbortController();
    const long = abortableSleep(60_000, controller.signal);
    controller.abort();
    await long;
    await abortableSleep(60_000, controller.signal);
  });
});

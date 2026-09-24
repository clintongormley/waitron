import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimGeneration, generationPrefix, markerKey } from "./generations.js";
import { generationName } from "./names.js";
import { readPointer, writePointer, type SignedPointer } from "./pointer.js";
import type { BucketConfig } from "./s3-store.js";
import { FakeLitestream } from "./testing/fake-litestream.js";
import { SwitchableStore } from "./testing/switchable-store.js";
import {
  PRUNE_EVERY_MS,
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
 */
class ManualClock {
  #t: number;
  #sleeping: { at: number; ms: number; wake: () => void }[] = [];
  readonly slept: number[] = [];

  constructor(start: string) {
    this.#t = Date.parse(start);
  }

  readonly now = (): Date => new Date(this.#t);

  readonly sleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      const entry = { at: this.#t + ms, ms, wake: () => resolve() };
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

  async next(): Promise<number> {
    await this.asleep();
    this.#sleeping.sort((a, b) => a.at - b.at);
    const entry = this.#sleeping.shift()!;
    this.#t = Math.max(this.#t, entry.at);
    this.slept.push(entry.ms);
    entry.wake();
    return entry.ms;
  }

  /** Wakes sleepers one at a time until `done()` holds. */
  async until(done: () => boolean, limit = 100): Promise<void> {
    for (let i = 0; i <= limit; i += 1) {
      await this.asleep(300).catch(() => undefined);
      if (done()) return;
      if (i < limit) await this.next();
    }
    throw new Error(`not reached after ${limit} wakes`);
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!();
});

const fullCopyOf = (generation: string) =>
  `${generationPrefix(VENUE, generation)}0000/0000000000000001-0000000000000001.ltx`;
const markerOf = (generation: string) => markerKey(VENUE, generation);

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
}

async function harness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const clock = new ManualClock(START);
  const store = new SwitchableStore(clock.now, events);
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
  const logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];
  const deps: SupervisorDeps = {
    litestreamBin: "litestream",
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
      wal = 0;
      return { reclaimed: result };
    },
    walBytes: async () => {
      if (walFails) throw new Error("the side file could not be measured");
      return wal;
    },
    walLimitBytes: LIMIT,
    now: clock.now,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    spawn: litestream.spawn,
    store,
    sleep: clock.sleep,
    ...(options.readCommandLine === undefined ? {} : { readCommandLine: options.readCommandLine }),
  };
  const supervisor = new StreamSupervisor(deps);
  cleanups.push(async () => {
    await supervisor.stop();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    supervisor,
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
    failWal: () => {
      walFails = true;
    },
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

  it("treats its own pointer write as done when only the answer was lost", async () => {
    const h = await harness();
    h.store.loseAnswerTo = (key) => key.endsWith("current.json");
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
    h.store.loseAnswerTo = (key) => key.endsWith("opened.json");
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
  // settles at one minute — never in a tight loop — and nothing else waits on it. (Naming the
  // refusal once, as `backup.stream_bucket_unusable`, needs the bucket reads Task 7 adds.)
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
    h.store.objects.set(fullCopyOf(name), {
      body: new Uint8Array(),
      etag: `"${name}"`,
      lastModified: new Date(at),
    });

  it("prunes an old generation from the streaming tick, at most once a day, and never the live one", async () => {
    const h = await streaming();
    const old = generationName(1, "node-old", new Date(Date.parse(START) - 9 * DAY));
    oldGeneration(h, old, Date.parse(START) - 8 * DAY);
    // Eight days on, the live generation's own objects are as old as the window too.
    h.clock.advance(8 * DAY);
    await h.clock.next(); // the streaming tick
    await vi.waitFor(() => expect(h.store.objects.has(fullCopyOf(old))).toBe(false));
    expect(h.store.objects.has(fullCopyOf(h.generation))).toBe(true);
    expect(h.store.objects.has(markerOf(h.generation))).toBe(true);
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
    expect(h.store.objects.has(fullCopyOf(older))).toBe(true);
    h.clock.advance(PRUNE_EVERY_MS);
    await h.clock.next();
    await vi.waitFor(() => expect(h.store.objects.has(fullCopyOf(older))).toBe(false));
    expect(h.store.objects.has(fullCopyOf(h.generation))).toBe(true);
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
  it("records its child's PID beside the configuration, and removes the record when stopped", async () => {
    const h = await streaming({ pid: 424_242 });
    expect(await readFile(join(h.directory, "stream", "litestream.pid"), "utf8")).toBe("424242\n");
    await h.supervisor.stop();
    expect(existsSync(join(h.directory, "stream", "litestream.pid"))).toBe(false);
  });

  it("stops a leftover whose PID and command line are this box's Litestream, before starting its own", async () => {
    const h = await harness();
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    // `sleep 30; :` keeps the shell from replacing itself with sleep, so its argv stays readable.
    const leftover = spawn(
      "/bin/sh",
      [
        "-c",
        "sleep 30; :",
        "litestream",
        "replicate",
        "-config",
        join(configDir, "litestream.yml"),
      ],
      { stdio: "ignore" },
    );
    const gone = new Promise((resolve) => leftover.on("exit", resolve));
    writeFileSync(join(configDir, "litestream.pid"), `${leftover.pid}\n`);
    await h.supervisor.start();
    await gone;
    await h.clock.until(() => h.litestream.running() !== undefined);
    expect(h.logs.some((line) => line.event === "stream.leftover_stopped")).toBe(true);
  }, 15_000);

  it("kills a leftover that ignores the polite signal, after the grace", async () => {
    const h = await harness();
    const configDir = join(h.directory, "stream");
    mkdirSync(configDir, { recursive: true });
    const leftover = spawn(
      "/bin/sh",
      [
        "-c",
        "trap '' TERM; echo ready; sleep 10; :",
        "litestream",
        "replicate",
        "-config",
        join(configDir, "litestream.yml"),
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    // Signalled before its trap is set, the shell would die of the polite signal.
    await new Promise((resolve) => leftover.stdout.once("data", resolve));
    const gone = new Promise<NodeJS.Signals | null>((resolve) =>
      leftover.on("exit", (_code, signal) => resolve(signal)),
    );
    writeFileSync(join(configDir, "litestream.pid"), `${leftover.pid}\n`);
    await h.supervisor.start();
    expect(await gone).toBe("SIGKILL");
    await h.clock.until(() => h.litestream.running() !== undefined);
  }, 15_000);

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
    });
    expect(supervisor.status()).toEqual({
      state: "off",
      generation: null,
      reason: null,
      stateSince: new Date(START).toISOString(),
      bucketProblem: null,
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

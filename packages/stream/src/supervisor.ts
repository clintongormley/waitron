import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hasCode, isAppError } from "@waitron/shared";
import { isPreconditionFailure } from "./conditional.js";
import "./errors.js";
import { CommitLog, computeLag } from "./freshness.js";
import { claimGeneration, generationPrefix, markerKey, pruneGenerations } from "./generations.js";
import {
  LITESTREAM_VERSION,
  litestreamConfig,
  litestreamEnv,
  litestreamMetaDir,
  replicaUrl,
} from "./litestream.js";
import {
  readCommandLine,
  spawnLitestream,
  type ChildHandle,
  type SpawnFn,
} from "./litestream-process.js";
import { generationName } from "./names.js";
import type { ListedObject, ObjectStore } from "./object-store.js";
import {
  pointerMessage,
  readPointer,
  writePointer,
  type SignedPointer,
  type StreamPointer,
} from "./pointer.js";
import { probeBucket } from "./probe.js";
import { createS3ObjectStore, type BucketConfig } from "./s3-store.js";

export type StreamLog = (
  level: "info" | "warn" | "error",
  event: string,
  fields?: Record<string, unknown>,
) => void;

export type StreamState = "off" | "opening" | "streaming" | "paused" | "refused";

export interface StreamStatus {
  state: StreamState;
  /** The generation this box is writing, or opening; null before one is claimed. */
  generation: string | null;
  /** Why the state is what it is, as a short tag (`side_file_limit`, `pointer_changed`, …). */
  reason: string | null;
  /** When `state` last changed, by this box's clock. */
  stateSince: string;
  /** Set while the bucket refuses this box's key or fails the safe-write check; its reason. */
  bucketProblem: { reason: string; since: string } | null;
  /**
   * How long the oldest commit not yet seen in the bucket has waited; 0 when nothing waits.
   * Computed whatever the state: a supervisor that stopped by itself still counts the commits it
   * hears, and only `stop()` ends the hearing.
   */
  lagMs: number;
  /** The newest file seen in the live generation, by the bucket's clock. */
  lastConfirmedUploadAt: string | null;
}

/** What the server's readers take: a supervisor's status, or off when there is none. */
export type StreamView = StreamStatus | { state: "off" };

type StreamCore = Omit<StreamStatus, "lagMs" | "lastConfirmedUploadAt">;

/** Everything the supervisor needs; it opens no database and reads no settings itself. */
export interface SupervisorDeps {
  litestreamBin: string;
  /** Absolute path of `venue.db`. */
  venueDbPath: string;
  /** A directory the supervisor may write Litestream's configuration into. */
  configDir: string;
  bucket: BucketConfig;
  venueId: string;
  nodeId: string;
  /** The membership term this box holds: written into every generation name and the pointer. */
  term: number;
  /** Signs `message` with this node's membership key; the base64 signature. */
  sign(message: string): Promise<string>;
  /** Folds the side file back into `venue.db`; `reclaimed` is false while something still reads it. */
  foldBack(): Promise<{ reclaimed: boolean }>;
  /** The side file's size in bytes, 0 when there is none. */
  walBytes(): Promise<number>;
  walLimitBytes: number;
  now(): Date;
  /**
   * Milliseconds from a clock that correcting the time of day does not move; default
   * {@link steadyMs}. Freshness is measured on it.
   */
  monotonic?: () => number;
  log: StreamLog;
  spawn?: SpawnFn;
  store?: ObjectStore;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Default {@link STOP_WAIT_MS}. */
  stopWaitMs?: number;
  /** Reads a PID's command line; default {@link readCommandLine}. */
  readCommandLine?: (pid: number) => Promise<string | null>;
  /** Subscribes to the venue database's commits; returns the unsubscribe. */
  onCommit(listener: (committedAt: Date) => void): () => void;
}

/** How often, while streaming, the side file is measured. */
export const TICK_MS = 60_000;
/**
 * How often, while opening, the bucket is asked whether the first full copy has landed, and the side
 * file is measured.
 */
export const OPEN_POLL_MS = 2_000;
/** How long an opening that failed waits before trying again. */
export const OPEN_RETRY_MS = 30_000;
/** Waits before each restart of a Litestream that exited; the last one repeats. */
export const RESTART_BACKOFF_MS: readonly number[] = [
  1_000, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000,
];
/** A Litestream that ran this long before exiting starts its backoff from the beginning again. */
export const HEALTHY_RUN_MS = 60_000;
/** How long `litestream version` may take. */
const VERSION_TIMEOUT_MS = 10_000;
/** How long `stop()` waits for a run blocked on a bucket call before leaving it behind. */
const STOP_WAIT_MS = 1_000;
/** How often old generations are pruned, at most. */
export const PRUNE_EVERY_MS = 24 * 60 * 60_000;
/** A generation untouched for this long, and not the live one, is deleted: the week of history (spec §4.4). */
export const PRUNE_WINDOW_MS = 168 * 60 * 60_000;
/** Level 0's retention as the configuration sets it (`l0-retention: 5m`, `./litestream.ts`). */
export const L0_RETENTION_MS = 5 * 60_000;
/** How often, while streaming, the bucket's safe-write check is repeated. */
const PROBE_EVERY_MS = 24 * 60 * 60_000;
/**
 * How often a bucket that failed a read, or has a problem named, is checked again, and how often
 * a bucket that stays unreadable is logged.
 */
const CLASSIFY_EVERY_MS = 10 * 60_000;
/** A read of the bucket unanswered this long is given up on, and the next tick starts another. */
const READ_DEADLINE_MS = 5 * 60_000;
/** Beside the configuration: the PID of the Litestream this supervisor started. */
const PID_FILE = "litestream.pid";
const CONFIG_FILE = "litestream.yml";
/** How long a leftover Litestream has between SIGTERM and SIGKILL. */
const LEFTOVER_GRACE_MS = 5_000;

/**
 * The side file size at which Litestream is stopped and the file folded back (spec §4.5): below the
 * largest side file anything here has been measured trading against.
 */
export const DEFAULT_WAL_LIMIT_BYTES = 256 * 1024 * 1024;

/**
 * Litestream's exit as one word from a fixed list. Its output can carry the bucket, the endpoint and
 * the access key id, and the recovery page shows the log's tail unauthenticated
 * (`apps/server/src/recovery-surface.ts`), so the output itself is never logged.
 */
export function exitCategory(code: number | null, output: string): string {
  if (/no space left on device/i.test(output)) return "disk_full";
  if (/access denied|AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|\b403\b/i.test(output)) {
    return "bucket_refused";
  }
  if (/no such host|connection refused|i\/o timeout|context deadline exceeded/i.test(output)) {
    return "bucket_unreachable";
  }
  if (code === null) return "signal";
  return "other";
}

/** False when there is no such process (or it is not ours to signal). */
const sendSignal = (pid: number, signal: NodeJS.Signals | 0): boolean => {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
};

/**
 * A file whose range starts at transaction 1, at any level, is a full copy (LTX's `IsSnapshot`), and
 * a restore follows the chain on from it. Keys are `<level as 4 hex digits>/<min>-<max>.ltx` under
 * the generation.
 */
const FULL_COPY = /^[0-9a-f]{4}\/0{15}1-[0-9a-f]{16}\.ltx$/;

const replicateArgs = (configPath: string): string[] => ["replicate", "-config", configPath];

const codeOf = (error: unknown): string => (isAppError(error) ? error.code : "unknown");

/**
 * `process.hrtime`'s clock in milliseconds. Node's documentation for it: "These times are relative
 * to an arbitrary time in the past, and not related to the time of day and therefore not subject to
 * clock drift" (`doc/api/process.md`, v26.x).
 */
export const steadyMs = (): number => Number(process.hrtime.bigint()) / 1e6;

const newestOf = (objects: readonly ListedObject[]): Date | null =>
  objects.reduce<Date | null>(
    (newest, object) =>
      newest === null || object.lastModified > newest ? object.lastModified : newest,
    null,
  );
const later = (a: Date | null, b: Date | null): Date | null =>
  a === null ? b : b === null || a > b ? a : b;

/** A sleep that ends early, and quietly, when `signal` aborts. */
export async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

interface Keeper {
  stop(): Promise<void>;
}

/**
 * Streams `venue.db` into a generation this box opened, and keeps it streaming.
 *
 * Opening (spec §4.4): claim the generation with a create-only marker, start Litestream into it,
 * wait until a full copy is visible in the bucket, then move `current.json` only if it is unchanged
 * since it was read at the start. A pointer that changed is another box writing this venue: the
 * supervisor stops and reads `refused`. Nothing on the sale path waits for any of it: `start()`
 * returns once the work is scheduled.
 *
 * It restarts an exited Litestream with a backoff. From the moment Litestream starts, the side file
 * is measured on a timer whatever the bucket is doing; at the limit Litestream is stopped, the file
 * folded back and the bucket waited for (spec §4.5). The SAME generation then resumes from
 * Litestream's kept local state, unless its first full copy had not landed, when the next attempt
 * opens a new one.
 *
 * The run checks its signal after every wait and throws once stopped, so a bucket call that answers
 * after `stop()` gave up on it starts nothing.
 */
export class StreamSupervisor {
  readonly #deps: SupervisorDeps;
  readonly #store: ObjectStore;
  readonly #spawn: SpawnFn;
  readonly #sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly #stopWaitMs: number;
  readonly #monotonic: () => number;
  #status: StreamCore;
  #controller: AbortController | undefined;
  #run: Promise<void> = Promise.resolve();
  #keeper: Keeper | undefined;
  /** Settles once every Litestream a pause, a failure or stop() began stopping has exited. */
  #retiring: Promise<void> = Promise.resolve();
  #versionExit: Promise<unknown> = Promise.resolve();
  #env: Readonly<Record<string, string>> = {};
  #lastPruneAt = Number.NEGATIVE_INFINITY;
  #pruning = false;
  readonly #commits = new CommitLog();
  /** Set by `start()`, which `stop()` requires before it does anything. */
  #unsubscribe!: () => void;
  /** The newest file seen in the live generation, by the bucket's clock. */
  #newestUploadAt: Date | null = null;
  /** The bucket's clock minus {@link SupervisorDeps.monotonic}'s reading. */
  #skewMs = 0;
  #lastProbeAt = 0;
  #lastClassifyAt = Number.NEGATIVE_INFINITY;
  /** When a bucket that cannot be read was last logged; null while reads succeed. */
  #unreadableLoggedAt: number | null = null;

  constructor(deps: SupervisorDeps) {
    this.#deps = deps;
    this.#store = deps.store ?? createS3ObjectStore(deps.bucket);
    this.#spawn = deps.spawn ?? spawnLitestream;
    this.#sleep = deps.sleep ?? abortableSleep;
    this.#stopWaitMs = deps.stopWaitMs ?? STOP_WAIT_MS;
    this.#monotonic = deps.monotonic ?? steadyMs;
    this.#status = {
      state: "off",
      generation: null,
      reason: null,
      stateSince: deps.now().toISOString(),
      bucketProblem: null,
    };
  }

  status(): StreamStatus {
    return {
      ...this.#status,
      lagMs: this.#lagWith(this.#newestUploadAt).lagMs,
      lastConfirmedUploadAt: this.#newestUploadAt?.toISOString() ?? null,
    };
  }

  /** Schedules the work and returns: nothing here waits for the bucket. */
  async start(): Promise<void> {
    if (this.#controller !== undefined) return;
    // The store calls this as soon as the commit is made, so the steady clock's reading here is the
    // commit's time on that clock; the wall-clock time handed in could since have been corrected.
    this.#unsubscribe = this.#deps.onCommit(() => this.#commits.record(this.#monotonic()));
    const controller = new AbortController();
    this.#controller = controller;
    this.#run = this.#main(controller.signal).catch(async (error: unknown) => {
      if (!controller.signal.aborted) await this.#fail(error);
    });
  }

  /** Ends the run and Litestream with it; the status keeps `supervisor_failed` as its reason. */
  async #fail(error: unknown): Promise<void> {
    this.#deps.log("error", "stream.supervisor_failed", { errorCode: codeOf(error) });
    this.#controller?.abort();
    await this.#stopChild();
    this.#set("off", "supervisor_failed");
  }

  /**
   * Stops Litestream and the run. A run blocked on a bucket call that never answers is left behind
   * after a short wait.
   */
  async stop(): Promise<void> {
    const controller = this.#controller;
    if (controller === undefined) return;
    controller.abort();
    this.#unsubscribe();
    await this.#stopChild();
    await Promise.race([this.#run, delay(this.#stopWaitMs, undefined, { ref: false })]);
    await this.#stopChild();
    await this.#versionExit;
    this.#set("off", "stopped");
  }

  async #main(signal: AbortSignal): Promise<void> {
    await this.#stopLeftover();
    signal.throwIfAborted();
    if (!this.#configurationIsSafe()) return;
    if (!(await this.#binaryIsPinned(signal))) return;
    const generation = await this.#open(signal);
    if (generation === null) return;
    await this.#stream(generation, signal);
  }

  /**
   * Every check on what reaches Litestream, made once before anything touches the bucket: they
   * depend only on the settings, so a refusal is final, where retrying it would claim a new, empty
   * generation on every attempt. A generation name is always one key segment, so a sample name
   * stands for every one this run opens.
   */
  #configurationIsSafe(): boolean {
    const { bucket, venueDbPath, venueId, nodeId, term } = this.#deps;
    try {
      this.#env = litestreamEnv(bucket);
      const sample = generationName(term, nodeId, this.#deps.now());
      litestreamConfig({ dbPath: venueDbPath, replicaUrl: replicaUrl(bucket, venueId, sample) });
      return true;
    } catch (error) {
      const field =
        isAppError(error) &&
        (hasCode(error, "backup.stream_config_unsafe") ||
          hasCode(error, "backup.stream_name_invalid"))
          ? error.params.field
          : undefined;
      this.#deps.log("error", "stream.config_unsafe", { errorCode: codeOf(error), field });
      this.#refuse("config_unsafe");
      return false;
    }
  }

  async #binaryIsPinned(signal: AbortSignal): Promise<boolean> {
    const probe = this.#spawn(this.#deps.litestreamBin, ["version"], {});
    this.#versionExit = probe.exited;
    const timeout = new AbortController();
    const code = await Promise.race([
      probe.exited,
      this.#sleep(VERSION_TIMEOUT_MS, AbortSignal.any([signal, timeout.signal])).then(
        () => "timeout" as const,
      ),
    ]);
    timeout.abort();
    if (code === "timeout") probe.kill();
    signal.throwIfAborted();
    const version = probe.output().trim();
    if (code === 0 && version === LITESTREAM_VERSION) return true;
    // A fixed reason only, never the binary's own words.
    this.#deps.log("error", "stream.litestream_unavailable", {
      exitCode: code,
      reason: code === "timeout" ? "timeout" : code === 0 ? "version_mismatch" : "not_runnable",
    });
    this.#set("off", "litestream_unavailable");
    return false;
  }

  /** Opens a generation and moves the pointer to it; null when refused. */
  async #open(signal: AbortSignal): Promise<string | null> {
    const { venueId, nodeId, term } = this.#deps;
    for (;;) {
      signal.throwIfAborted();
      this.#set("opening", null, null);
      let moving: Promise<unknown> = Promise.resolve();
      try {
        const probe = await probeBucket(this.#store);
        signal.throwIfAborted();
        if (!probe.ok) {
          this.#noteBucketProblem(probe.reason);
          await this.#sleep(OPEN_RETRY_MS, signal);
          continue;
        }
        this.#noteBucketProblem(null);
        this.#lastProbeAt = this.#monotonic();
        const previous = await readPointer(this.#store, venueId);
        signal.throwIfAborted();
        if (previous !== null && previous.pointer.body.term > term) {
          this.#refuse("pointer_newer_term");
          return null;
        }
        const generation = generationName(term, nodeId, this.#deps.now());
        const claimStarted = this.#instant();
        try {
          await claimGeneration(this.#store, venueId, generation);
        } catch (error) {
          if (!isPreconditionFailure(error)) throw error;
          await this.#sleep(1_000, signal);
          continue;
        }
        const claimEnded = this.#instant();
        signal.throwIfAborted();
        this.#newestUploadAt = null;
        await this.#measureSkew(generation, claimStarted, claimEnded);
        await this.#startChild(generation, true, signal);
        this.#set("opening", null, generation);
        const overLimit = await this.#fullCopyOrLimit(generation, signal);
        if (overLimit !== null) {
          // No full copy and the pointer never moved: the next attempt opens a new generation.
          await this.#pause(generation, overLimit, signal);
          continue;
        }
        const body: StreamPointer = {
          venueId,
          term,
          nodeId,
          generation,
          writtenAt: this.#deps.now().toISOString(),
        };
        const signature = await this.#unlessStopped(signal, this.#deps.sign(pointerMessage(body)));
        const pointer: SignedPointer = { body, signature };
        const moved = await this.#watchingLimit(
          generation,
          (within) => (moving = this.#movePointer(pointer, previous?.etag ?? null, within)),
          signal,
        );
        if (!moved) {
          await this.#stopChild();
          this.#refuse("pointer_changed");
          return null;
        }
        signal.throwIfAborted();
        this.#set("streaming", null, generation);
        this.#deps.log("info", "stream.streaming", { generation });
        return generation;
      } catch (error) {
        if (signal.aborted) throw error;
        this.#deps.log("warn", "stream.open_failed", { errorCode: codeOf(error) });
        await this.#stopChild();
        // A pointer write already sent cannot be called back. Landing after the next attempt reads
        // the pointer, it would make that attempt's own write be refused as another box's.
        await moving.catch(() => undefined);
        await this.#sleep(OPEN_RETRY_MS, signal);
      }
    }
  }

  /**
   * Null once the first full copy is in the bucket; the side file's size if it reached the limit
   * first. The wait on the bucket is left behind at the limit: it only reads.
   */
  async #fullCopyOrLimit(generation: string, signal: AbortSignal): Promise<number | null> {
    const attempt = new AbortController();
    const within = AbortSignal.any([signal, attempt.signal]);
    try {
      return await Promise.race([
        this.#waitForFullCopy(generation, within).then(() => null),
        this.#untilOverLimit(OPEN_POLL_MS, within),
      ]);
    } finally {
      attempt.abort();
    }
  }

  async #waitForFullCopy(generation: string, signal: AbortSignal): Promise<void> {
    const prefix = generationPrefix(this.#deps.venueId, generation);
    for (;;) {
      let listed: ListedObject[] = [];
      try {
        listed = await this.#store.list(prefix);
      } catch (error) {
        this.#deps.log("warn", "stream.list_failed", { errorCode: codeOf(error) });
      }
      signal.throwIfAborted();
      if (listed.some((object) => FULL_COPY.test(object.key.slice(prefix.length)))) {
        this.#newestUploadAt = later(this.#newestUploadAt, newestOf(listed));
        return;
      }
      await this.#unlessStopped(signal, this.#sleep(OPEN_POLL_MS, signal));
    }
  }

  /**
   * Replaces `current.json` only if it is unchanged since `previousEtag` was read; false when
   * refused. `writePointer` already counts a refusal of this box's own landed write as success, so a
   * refusal here is another box.
   */
  async #movePointer(
    pointer: SignedPointer,
    previousEtag: string | null,
    signal: AbortSignal,
  ): Promise<boolean> {
    for (;;) {
      signal.throwIfAborted();
      try {
        await writePointer(this.#store, this.#deps.venueId, pointer, previousEtag);
        return true;
      } catch (error) {
        signal.throwIfAborted();
        if (isPreconditionFailure(error)) return false;
        this.#deps.log("warn", "stream.pointer_write_failed", { errorCode: codeOf(error) });
      }
      await this.#sleep(OPEN_RETRY_MS, signal);
    }
  }

  /**
   * `work`'s answer. `work` must not start or stop Litestream: at the limit, this pauses and resumes
   * the generation while `work` carries on. `work` is aborted if this throws.
   */
  async #watchingLimit<T>(
    generation: string,
    work: (signal: AbortSignal) => Promise<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const attempt = new AbortController();
    const within = AbortSignal.any([signal, attempt.signal]);
    const done = work(within).then((value) => ({ value }));
    try {
      for (;;) {
        const watch = new AbortController();
        const outcome = await Promise.race([
          done,
          this.#untilOverLimit(OPEN_POLL_MS, AbortSignal.any([within, watch.signal])),
        ]).finally(() => watch.abort());
        signal.throwIfAborted();
        if (typeof outcome !== "number") return outcome.value;
        await this.#pauseAndResume(generation, outcome, signal);
      }
    } finally {
      attempt.abort();
    }
  }

  async #stream(generation: string, signal: AbortSignal): Promise<void> {
    let reading: { since: number } | undefined;
    // Not awaited, like the prune: a bucket that never answers must not hold the tick. One read of
    // the bucket at a time, until it has gone unanswered past the deadline.
    const readBucket = () => {
      const now = this.#monotonic();
      if (reading !== undefined && now - reading.since < READ_DEADLINE_MS) return;
      if (reading !== undefined) this.#noteUnreadable("timeout");
      const mine = { since: now };
      reading = mine;
      void this.#readBucket(generation, signal, () => reading === mine).finally(() => {
        if (reading === mine) reading = undefined;
      });
    };
    for (;;) {
      const walBytes = await this.#untilOverLimit(TICK_MS, signal, () => {
        this.#pruneDaily(generation);
        readBucket();
      });
      await this.#pauseAndResume(generation, walBytes, signal);
    }
  }

  /**
   * Reads the live generation's newest file (spec §7) and forgets the commits it covers, then
   * checks the bucket when that is due: after a failed read, or with a problem named, at most every
   * ten minutes; otherwise daily. Nothing is changed or checked once the run has stopped, or once a
   * newer read has replaced this one: its answer may be older than the newer read's.
   */
  async #readBucket(
    generation: string,
    signal: AbortSignal,
    isCurrent: () => boolean,
  ): Promise<void> {
    const read = await this.#newestUpload(generation);
    if (signal.aborted || !isCurrent()) return;
    if (read.ok) {
      this.#unreadableLoggedAt = null;
      this.#newestUploadAt = read.newest;
    } else {
      this.#noteUnreadable(read.errorCode);
    }
    this.#commits.settle(this.#lagWith(this.#newestUploadAt).coveredUpTo);
    const now = this.#monotonic();
    if (!read.ok || this.#status.bucketProblem !== null) {
      await this.#classifyBucket(false, signal);
    } else if (now - this.#lastProbeAt >= PROBE_EVERY_MS) {
      this.#lastProbeAt = now;
      await this.#classifyBucket(true, signal);
    }
  }

  /**
   * Level 0 each time; level 1 as well once a commit has waited longer than level 0 keeps a file,
   * since it may have been compacted and tidied between two reads.
   */
  async #newestUpload(
    generation: string,
  ): Promise<{ ok: true; newest: Date | null } | { ok: false; errorCode: string }> {
    try {
      const prefix = generationPrefix(this.#deps.venueId, generation);
      let newest = later(this.#newestUploadAt, newestOf(await this.#store.list(`${prefix}0000/`)));
      if (this.#lagWith(newest).lagMs > L0_RETENTION_MS) {
        newest = later(newest, newestOf(await this.#store.list(`${prefix}0001/`)));
      }
      return { ok: true, newest };
    } catch (error) {
      return { ok: false, errorCode: codeOf(error) };
    }
  }

  #noteUnreadable(errorCode: string): void {
    const now = this.#monotonic();
    if (this.#unreadableLoggedAt !== null && now - this.#unreadableLoggedAt < CLASSIFY_EVERY_MS) {
      return;
    }
    this.#unreadableLoggedAt = now;
    this.#deps.log("warn", "stream.freshness_unreadable", { errorCode });
  }

  #lagWith(newestUploadAt: Date | null): { lagMs: number; coveredUpTo: number | null } {
    return computeLag({
      pending: this.#commits.pending(),
      newestUploadAt,
      skewMs: this.#skewMs,
      now: this.#monotonic(),
    });
  }

  #instant(): { wall: number; steady: number } {
    return { wall: this.#deps.now().getTime(), steady: this.#monotonic() };
  }

  /**
   * The bucket's clock minus the steady clock, from the marker this box has just written: its
   * `lastModified` against the middle of the write. When the marker cannot be read, this box's
   * time of day at the write stands in for the bucket's.
   */
  async #measureSkew(
    generation: string,
    started: { wall: number; steady: number },
    ended: { wall: number; steady: number },
  ): Promise<void> {
    const steady = (started.steady + ended.steady) / 2;
    this.#skewMs = (started.wall + ended.wall) / 2 - steady;
    const key = markerKey(this.#deps.venueId, generation);
    try {
      const marker = (await this.#store.list(key)).find((object) => object.key === key);
      if (marker !== undefined) this.#skewMs = marker.lastModified.getTime() - steady;
    } catch (error) {
      this.#deps.log("warn", "stream.freshness_unreadable", { errorCode: codeOf(error) });
    }
  }

  /**
   * A bucket that answers with a refusal is unusable (its key, or its safe write); one that gives no
   * answer at all is unreachable, which the lag already shows.
   */
  async #classifyBucket(force: boolean, signal: AbortSignal): Promise<void> {
    const now = this.#monotonic();
    if (!force && now - this.#lastClassifyAt < CLASSIFY_EVERY_MS) return;
    this.#lastClassifyAt = now;
    try {
      const probe = await probeBucket(this.#store);
      if (signal.aborted) return;
      this.#noteBucketProblem(probe.ok ? null : probe.reason);
    } catch (error) {
      this.#deps.log("warn", "stream.bucket_unreachable", { errorCode: codeOf(error) });
    }
  }

  /**
   * Measures the side file every `everyMs` until it reaches the limit, whatever the bucket is doing,
   * and answers the size measured.
   */
  async #untilOverLimit(
    everyMs: number,
    signal: AbortSignal,
    eachTick: () => void = () => {},
  ): Promise<number> {
    for (;;) {
      await this.#sleep(everyMs, signal);
      signal.throwIfAborted();
      eachTick();
      const walBytes = await this.#sideFileBytes(signal);
      if (walBytes >= this.#deps.walLimitBytes) return walBytes;
    }
  }

  /** Restarts Litestream into the same generation, from its kept local state, after the pause. */
  async #pauseAndResume(generation: string, walBytes: number, signal: AbortSignal): Promise<void> {
    const state = this.#status.state;
    await this.#pause(generation, walBytes, signal);
    await this.#startChild(generation, false, signal);
    this.#set(state, null, generation);
    this.#deps.log("info", "stream.resumed", { generation });
  }

  /**
   * Stops Litestream and folds the side file back, retrying each tick while it is still over the
   * limit, then waits for the bucket. Restarting Litestream over a side file a reader still holds
   * would only grow it again. Each kind of fold-back trouble is logged once per pause.
   */
  async #pause(generation: string, walBytes: number, signal: AbortSignal): Promise<void> {
    const limitBytes = this.#deps.walLimitBytes;
    this.#deps.log("warn", "stream.paused", { generation, walBytes, limitBytes });
    this.#set("paused", "side_file_limit", generation);
    await this.#stopChild();
    const noted = new Set<string>();
    let bytes = walBytes;
    for (;;) {
      if (bytes >= limitBytes) {
        await this.#unlessStopped(signal, this.#foldBack(noted));
        bytes = await this.#sideFileBytes(signal);
      }
      if (
        bytes < limitBytes &&
        (await this.#unlessStopped(signal, this.#bucketAnswers(generation)))
      ) {
        return;
      }
      await this.#unlessStopped(signal, this.#sleep(TICK_MS, signal));
      bytes = await this.#sideFileBytes(signal);
    }
  }

  #sideFileBytes(signal: AbortSignal): Promise<number> {
    return this.#unlessStopped(signal, this.#deps.walBytes());
  }

  /** `work`'s answer, unless the run was stopped while it was awaited. */
  async #unlessStopped<T>(signal: AbortSignal, work: Promise<T>): Promise<T> {
    const value = await work;
    signal.throwIfAborted();
    return value;
  }

  /**
   * Deletes this venue's generations older than a week, never `live`, at most once a day. Litestream
   * tidies only the generation it writes (spec §4.4). Not awaited: a bucket that never answers must
   * not hold the tick, which is where the side-file limit is checked. One prune at a time.
   */
  #pruneDaily(live: string): void {
    const now = this.#deps.now();
    if (this.#pruning || now.getTime() - this.#lastPruneAt < PRUNE_EVERY_MS) return;
    this.#lastPruneAt = now.getTime();
    this.#pruning = true;
    void pruneGenerations(this.#store, this.#deps.venueId, live, now, PRUNE_WINDOW_MS)
      .then((deleted) => {
        if (deleted.length > 0) {
          this.#deps.log("info", "stream.generations_pruned", { count: deleted.length });
        }
      })
      .catch((error: unknown) => {
        this.#deps.log("warn", "stream.prune_failed", { errorCode: codeOf(error) });
      })
      .finally(() => {
        this.#pruning = false;
      });
  }

  /**
   * Stops a Litestream a server that died left running: the PID recorded beside the configuration,
   * and only when that PID's command line is exactly the one this supervisor starts Litestream with,
   * since the PID may since belong to anything.
   */
  async #stopLeftover(): Promise<void> {
    const pidPath = join(this.#deps.configDir, PID_FILE);
    let pid: number;
    try {
      pid = Number.parseInt(await readFile(pidPath, "utf8"), 10);
    } catch {
      return;
    }
    await rm(pidPath, { force: true });
    if (!Number.isSafeInteger(pid) || pid <= 1) return;
    // Compared as the text `readCommandLine` gives, the arguments joined by spaces, against the
    // binary as configured: an argument holding a space cannot be told from two arguments, and the
    // same binary started by another path does not match.
    const ours = [
      this.#deps.litestreamBin,
      ...replicateArgs(join(this.#deps.configDir, CONFIG_FILE)),
    ].join(" ");
    const isOurs = async () =>
      (await (this.#deps.readCommandLine ?? readCommandLine)(pid)) === ours;
    if (!(await isOurs())) return;
    if (!sendSignal(pid, "SIGTERM")) return;
    this.#deps.log("warn", "stream.leftover_stopped", { pid });
    // Not cut short by stop(): the PID record is already removed, so no later start would find it.
    const grace = new AbortController().signal;
    for (let waited = 0; waited < LEFTOVER_GRACE_MS && sendSignal(pid, 0); waited += 100) {
      await this.#sleep(100, grace);
    }
    // The PID may have been reused during the grace: signal it only if it is still ours.
    if (await isOurs()) sendSignal(pid, "SIGKILL");
  }

  /** Logs each event in `noted` once only. */
  async #foldBack(noted: Set<string>): Promise<void> {
    const note = (level: "warn" | "error", event: string, fields: Record<string, unknown>) => {
      if (noted.has(event)) return;
      noted.add(event);
      this.#deps.log(level, event, fields);
    };
    try {
      const { reclaimed } = await this.#deps.foldBack();
      if (!reclaimed) note("warn", "stream.fold_back_busy", {});
    } catch (error) {
      note("error", "stream.fold_back_failed", { errorCode: codeOf(error) });
    }
  }

  async #bucketAnswers(generation: string): Promise<boolean> {
    try {
      await this.#store.list(`${generationPrefix(this.#deps.venueId, generation)}0000/`);
      return true;
    } catch {
      return false;
    }
  }

  /** Writes the configuration and starts Litestream; a new generation starts from no local state. */
  async #startChild(generation: string, fresh: boolean, signal: AbortSignal): Promise<void> {
    const { bucket, configDir, venueDbPath, venueId } = this.#deps;
    await mkdir(configDir, { recursive: true, mode: 0o700 });
    const configPath = join(configDir, CONFIG_FILE);
    await writeFile(
      configPath,
      litestreamConfig({
        dbPath: venueDbPath,
        replicaUrl: replicaUrl(bucket, venueId, generation),
      }),
      { mode: 0o600 },
    );
    // Litestream's own record of what it has uploaded describes the PREVIOUS generation; left in
    // place, it fills the new one from that position onwards and no full copy is ever written there.
    if (fresh) await rm(litestreamMetaDir(venueDbPath), { recursive: true, force: true });
    signal.throwIfAborted();
    this.#keeper = this.#keep(configPath);
  }

  #keep(configPath: string): Keeper {
    const wake = new AbortController();
    const pidPath = join(this.#deps.configDir, PID_FILE);
    let current: ChildHandle | undefined;
    const loop = (async () => {
      let attempt = 0;
      while (!wake.signal.aborted) {
        const startedAt = this.#deps.now().getTime();
        current = this.#spawn(this.#deps.litestreamBin, replicateArgs(configPath), this.#env);
        if (current.pid !== undefined) await this.#recordPid(pidPath, current.pid);
        const code = await current.exited;
        if (wake.signal.aborted) return;
        if (this.#deps.now().getTime() - startedAt >= HEALTHY_RUN_MS) attempt = 0;
        const delay = RESTART_BACKOFF_MS[Math.min(attempt, RESTART_BACKOFF_MS.length - 1)]!;
        attempt += 1;
        this.#deps.log("warn", "stream.litestream_exited", {
          exitCode: code,
          category: exitCategory(code, current.output()),
          restartInMs: delay,
        });
        await this.#sleep(delay, wake.signal);
      }
    })().catch((error: unknown) => {
      // Not awaited: failing stops this keeper, and its stop() waits for this loop.
      void this.#fail(error);
    });
    return {
      stop: async () => {
        wake.abort();
        current?.kill();
        await current?.exited;
        await loop;
        await rm(pidPath, { force: true }).catch((error: unknown) => {
          this.#deps.log("warn", "stream.pid_record_failed", { errorCode: codeOf(error) });
        });
      },
    };
  }

  /** A record that cannot be written costs only the leftover sweep after a crash. */
  async #recordPid(pidPath: string, pid: number): Promise<void> {
    try {
      await writeFile(pidPath, `${pid}\n`, { mode: 0o600 });
    } catch (error) {
      this.#deps.log("warn", "stream.pid_record_failed", { errorCode: codeOf(error) });
    }
  }

  async #stopChild(): Promise<void> {
    const keeper = this.#keeper;
    this.#keeper = undefined;
    if (keeper !== undefined) {
      this.#retiring = Promise.all([this.#retiring, keeper.stop()]).then(() => undefined);
    }
    await this.#retiring;
  }

  #set(state: StreamState, reason: string | null, generation = this.#status.generation): void {
    const stateSince =
      state === this.#status.state ? this.#status.stateSince : this.#deps.now().toISOString();
    this.#status = { ...this.#status, state, reason, generation, stateSince };
  }

  #refuse(reason: string): void {
    this.#deps.log("error", "stream.refused", { reason });
    this.#set("refused", reason);
  }

  #noteBucketProblem(reason: string | null): void {
    const current = this.#status.bucketProblem;
    if (reason === null) {
      if (current !== null) this.#status = { ...this.#status, bucketProblem: null };
      return;
    }
    if (current?.reason === reason) return;
    this.#deps.log("warn", "stream.bucket_unusable", { reason });
    this.#status = {
      ...this.#status,
      bucketProblem: { reason, since: this.#deps.now().toISOString() },
    };
  }
}

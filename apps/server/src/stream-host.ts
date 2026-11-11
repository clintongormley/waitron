import type { ServiceDefinition } from "./job-runner.js";
import { STREAM_DIR } from "@waitron/store";
import { isDeepStrictEqual } from "node:util";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { nodeSigningPublicKey, tryGetCredential, type KeyRing } from "@waitron/credentials";
import {
  readNodeMembership,
  withTransaction,
  type Database,
  type NodeDatabase,
  type Transaction,
} from "@waitron/db";
import { signBytes, verifyEndorsement } from "@waitron/membership";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { VENUE_FILE, WAL_SUFFIX } from "@waitron/store";
import {
  DEFAULT_WAL_LIMIT_BYTES,
  createS3ObjectStore,
  readPointer,
  verifyPointer,
  SentPointers,
  StreamSupervisor,
  type BucketConfig,
  type ObjectStore,
  type SpawnFn,
  type StreamNotStarted,
  type StreamView,
} from "@waitron/stream";
import { boundObjectStore } from "./bounded-store.js";
import type { Logger } from "./logger.js";
import { credentialField } from "./credentials.js";
import { readNodeIdentityKey } from "./node-identity.js";
import type { SealedStateOutcome } from "./sealed-state.js";
import { deriveStreamKey } from "./stream-key.js";
import "./errors.js";

/** The vault purpose holding the owner's bucket. */
export const STREAM_PURPOSE = "backup.stream";

/** The reason a copy set up here reads off while a restore's first start is unfinished. */
export const FIRST_START_PENDING = "first_start_pending";

/** How the vault stores an absent optional field: it refuses empty strings. */
const ABSENT = "-";

export interface StreamSettings {
  venueId: string;
  bucket: BucketConfig;
}

/** What `putCredential` stores for `settings`: the inverse of {@link readStreamSettings}. */
export function streamSettingsPayload(settings: StreamSettings): Record<string, string> {
  const { bucket } = settings;
  if (bucket.prefix === ABSENT) throw new AppError("backup.request_invalid", { field: "prefix" });
  return {
    venueId: settings.venueId,
    endpoint: bucket.endpoint ?? ABSENT,
    region: bucket.region,
    bucket: bucket.bucket,
    prefix: bucket.prefix === "" ? ABSENT : bucket.prefix,
    accessKeyId: bucket.accessKeyId,
    secretAccessKey: bucket.secretAccessKey,
  };
}

export async function readStreamSettings(
  db: Database,
  ring: KeyRing,
): Promise<StreamSettings | null> {
  return withTransaction(db, (tx) => readStreamSettingsIn(tx, ring));
}

export async function readStreamSettingsIn(
  tx: Transaction,
  ring: KeyRing,
): Promise<StreamSettings | null> {
  const value = await tryGetCredential(tx, ring, { purpose: STREAM_PURPOSE });
  if (value === null) return null;
  const field = (
    name:
      "venueId" | "endpoint" | "region" | "bucket" | "prefix" | "accessKeyId" | "secretAccessKey",
  ) => credentialField(value, STREAM_PURPOSE, name);
  const endpoint = field("endpoint");
  const prefix = field("prefix");
  return {
    venueId: field("venueId"),
    bucket: {
      endpoint: endpoint === ABSENT ? undefined : endpoint,
      region: field("region"),
      bucket: field("bucket"),
      prefix: prefix === ABSENT ? "" : prefix,
      accessKeyId: field("accessKeyId"),
      secretAccessKey: field("secretAccessKey"),
    },
  };
}

export interface NewerBucketMain {
  successorNodeId: string;
  membershipTerm: number;
  contactUrl: string;
}

export async function readNewerBucketMain(
  deps: Pick<StreamHostDeps, "db" | "node" | "ring" | "nodeId" | "store">,
  signal?: AbortSignal,
  openStore: typeof createS3ObjectStore = createS3ObjectStore,
): Promise<NewerBucketMain | null> {
  try {
    const settings = await readStreamSettings(deps.db, deps.ring);
    if (settings === null) return null;
    const stored = await readPointer(
      boundObjectStore(deps.store ?? openStore(settings.bucket), 15_000),
      settings.venueId,
      { signal },
    );
    if (stored === null) return null;
    const { pointer } = stored;
    const held = await readNodeMembership(deps.db);
    if (held === null) return null;
    if (pointer.body.nodeId === deps.nodeId || pointer.body.term <= held.body.term) return null;
    const member = held.body.nodes.find(
      (n) => n.nodeId === pointer.body.nodeId && n.standing !== "evicted",
    );
    if (member === undefined) return null;
    const own = nodeSigningPublicKey(await readNodeIdentityKey(deps.node, deps.ring, deps.nodeId));
    const endorsed = held.endorsements.find(
      (e) =>
        e.nodeId === member.nodeId &&
        e.endorsedBy === deps.nodeId &&
        verifyEndorsement(e, own) &&
        verifyPointer(pointer, e.publicKey),
    );
    if (endorsed === undefined) return null;
    return {
      successorNodeId: member.nodeId,
      membershipTerm: pointer.body.term,
      contactUrl: member.contactUrl,
    };
  } catch {
    // An unavailable or unverified bucket cannot establish that another main exists.
    return null;
  }
}

export interface StreamHostDeps {
  db: Database;
  node: NodeDatabase;
  ring: KeyRing;
  nodeId: string;
  venueDir: string;
  stateDir: string;
  litestreamBin: string;
  log: Logger;
  now: () => Date;
  /** Read at each start, so a promotion is followed. */
  isPrimary: () => boolean;
  readRecoveryKey: () => Promise<string | undefined>;
  refreshSealedState: () => Promise<SealedStateOutcome>;
  /** False while a restored box's first start is unfinished (`rebuild-first-start.ts`). Read at
   * each start, so a reload after a settings save is held too. Default: always true. */
  mayStream?: () => boolean;
  /** Test seams; production leaves them unset. */
  spawn?: SpawnFn;
  store?: ObjectStore;
  walLimitBytes?: number;
  mainCheckIntervalMs?: number;
}

/**
 * The one owner of the live copy's supervisor in this process. `start()` and `reload()` never throw
 * for a bucket or vault problem: a copy that cannot start is logged and reads off. The old
 * supervisor stops before the next starts.
 */
export class StreamHost {
  readonly #deps: StreamHostDeps;
  #supervisor: StreamSupervisor | undefined;
  /** Set when the settings are stored but no supervisor could start, so the status can say why. */
  #notStarted: StreamNotStarted | undefined;
  #reloading = false;
  #reloadCount = 0;
  #stopped = false;
  #observerAbort: AbortController | undefined;
  #observer: Promise<void> | undefined;
  #pointerStore: { bucket: BucketConfig; store: ObjectStore } | undefined;
  #retiring: Promise<void> = Promise.resolve();
  /** A stopped supervisor's pointer write can still land after the next one reads the pointer. */
  readonly #sentPointers = new SentPointers();

  constructor(deps: StreamHostDeps) {
    this.#deps = deps;
  }

  observeNewerMain(
    stop: (evidence: NewerBucketMain) => Promise<unknown>,
    intervalMs = this.#deps.mainCheckIntervalMs ?? 15_000,
  ): void {
    if (this.#stopped || this.#observer !== undefined) return;
    const abort = new AbortController();
    this.#observerAbort = abort;
    this.#observer = (async () => {
      while (!abort.signal.aborted) {
        const evidence = await readNewerBucketMain(this.#deps, abort.signal, (bucket) => {
          if (
            this.#pointerStore === undefined ||
            !isDeepStrictEqual(this.#pointerStore.bucket, bucket)
          )
            this.#pointerStore = { bucket, store: createS3ObjectStore(bucket) };
          return this.#pointerStore.store;
        });
        if (abort.signal.aborted) return;
        if (evidence !== null) {
          try {
            await stop(evidence);
            return;
          } catch (error) {
            if (codeOf(error) === "handover.restriction_conflict") return;
            this.#deps.log("error", "stream.main_stop_failed", { errorCode: codeOf(error) });
          }
        }
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            abort.signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, intervalMs);
          abort.signal.addEventListener("abort", done, { once: true });
        });
      }
    })();
  }

  async start(): Promise<void> {
    if (this.#reloading) return;
    await this.#start();
  }

  async #start(): Promise<void> {
    const reloadCount = this.#reloadCount;
    if (this.#stopped || this.#supervisor !== undefined) return;
    this.#notStarted = undefined;
    const { db, ring, log } = this.#deps;
    if (!this.#deps.isPrimary()) {
      log("info", "stream.not_primary", {});
      return;
    }
    try {
      const settings = await readStreamSettings(db, ring);
      if (settings === null) {
        log("info", "stream.not_configured", {});
        return;
      }
      if (this.#deps.mayStream?.() === false) {
        log("warn", "stream.first_start_pending", {});
        this.#notStartedFor(FIRST_START_PENDING);
        return;
      }
      const membership = await readNodeMembership(db);
      if (membership === null) {
        log("warn", "stream.no_membership", {});
        this.#notStartedFor("no_membership");
        return;
      }
      if ((await this.#deps.refreshSealedState()) !== "sealed") {
        this.#notStartedFor("reseal_required");
        return;
      }
      const recoveryKey = await this.#deps.readRecoveryKey();
      if (recoveryKey === undefined) {
        this.#notStartedFor("reseal_required");
        return;
      }
      // A supervisor still stopping may still have Litestream running; and a stop() or an
      // overlapping start() may land while this waits.
      await this.#retiring;
      if (this.#stopped || this.#supervisor !== undefined || this.#reloadCount !== reloadCount)
        return;
      const venueDbPath = join(this.#deps.venueDir, VENUE_FILE);
      const supervisor = new StreamSupervisor({
        litestreamBin: this.#deps.litestreamBin,
        venueDbPath,
        configDir: join(this.#deps.stateDir, STREAM_DIR),
        bucket: settings.bucket,
        streamKey: deriveStreamKey(recoveryKey, settings.venueId),
        venueId: settings.venueId,
        nodeId: this.#deps.nodeId,
        term: membership.body.term,
        sign: async (message) =>
          signBytes(message, await readNodeIdentityKey(this.#deps.node, ring, this.#deps.nodeId)),
        foldBack: () => db.checkpointTruncate(),
        walBytes: () => fileBytes(`${venueDbPath}${WAL_SUFFIX}`),
        walLimitBytes: this.#deps.walLimitBytes ?? DEFAULT_WAL_LIMIT_BYTES,
        now: this.#deps.now,
        log,
        spawn: this.#deps.spawn,
        store: this.#deps.store,
        onCommit: (listener) => db.onCommit(listener),
        sentPointers: this.#sentPointers,
      });
      this.#supervisor = supervisor;
      await supervisor.start();
    } catch (error) {
      log("error", "stream.start_failed", { errorCode: codeOf(error) });
      this.#notStartedFor("start_failed");
    }
  }

  #notStartedFor(reason: string): void {
    this.#notStarted = { state: "off", reason, stateSince: this.#deps.now().toISOString() };
  }

  /**
   * A shutdown: stops the copy for good; a later `start()` or `reload()` starts nothing. Resolves
   * only once every supervisor this host started has stopped, including one a reload is still
   * stopping, because the caller closes the store next.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#observerAbort?.abort();
    await this.#observer;
    await this.#retire();
    this.#deps.log("info", "stream.stopped", {});
  }

  async suspend(): Promise<void> {
    await this.#retire();
    this.#notStarted = undefined;
  }

  /** Stops the running supervisor, if any; resolves once every stop begun so far has finished. */
  #retire(): Promise<void> {
    const supervisor = this.#supervisor;
    this.#supervisor = undefined;
    if (supervisor !== undefined) {
      this.#retiring = Promise.all([this.#retiring, supervisor.stop()]).then(() => undefined);
    }
    return this.#retiring;
  }

  /**
   * Stop before a key write so the old generation retains secrets its recovery pack opens.
   * A failed write still restarts under the effective key. The reload gate covers both steps.
   */
  async reload(write?: () => Promise<void>): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    this.#reloadCount += 1;
    try {
      await this.#retire();
      try {
        await write?.();
      } finally {
        await this.#start();
      }
    } finally {
      this.#reloading = false;
    }
  }

  status(): StreamView {
    return this.#supervisor?.status() ?? this.#notStarted ?? { state: "off" };
  }
}

async function fileBytes(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

export function streamService(host: StreamHost, isPrimary: () => boolean): ServiceDefinition {
  return {
    name: "stream",
    applies: isPrimary,
    start: () => host.start(),
    suspend: () => host.suspend(),
    stop: () => host.stop(),
    describe: () => {
      const status = host.status();
      return {
        running: status.state !== "off",
        reason: status.reason ?? (status.state === "off" ? "not_configured" : null),
      };
    },
  };
}

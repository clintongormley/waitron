import { stat } from "node:fs/promises";
import { join } from "node:path";
import { tryGetCredential, type KeyRing } from "@waitron/credentials";
import { readNodeMembership, withTransaction, type Database } from "@waitron/db";
import { signBytes } from "@waitron/membership";
import { codeOf } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import {
  DEFAULT_WAL_LIMIT_BYTES,
  StreamSupervisor,
  type BucketConfig,
  type ObjectStore,
  type SpawnFn,
  type StreamNotStarted,
  type StreamView,
} from "@waitron/stream";
import type { Logger } from "./logger.js";
import { readNodeIdentityKey } from "./node-identity.js";
import "./errors.js";

/** The vault purpose holding the owner's bucket. */
export const STREAM_PURPOSE = "backup.stream";

/** How the vault stores an absent optional field: it refuses empty strings. */
const ABSENT = "-";

export interface StreamSettings {
  venueId: string;
  bucket: BucketConfig;
}

/** What `putCredential` stores for `settings`: the inverse of {@link readStreamSettings}. */
export function streamSettingsPayload(settings: StreamSettings): Record<string, string> {
  const { bucket } = settings;
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
  const value = await withTransaction(db, (tx) =>
    tryGetCredential(tx, ring, { purpose: STREAM_PURPOSE }),
  );
  if (value === null) return null;
  return {
    venueId: value.venueId,
    bucket: {
      endpoint: value.endpoint === ABSENT ? undefined : value.endpoint,
      region: value.region,
      bucket: value.bucket,
      prefix: value.prefix === ABSENT ? "" : value.prefix,
      accessKeyId: value.accessKeyId,
      secretAccessKey: value.secretAccessKey,
    },
  };
}

export interface StreamHostDeps {
  db: Database;
  ring: KeyRing;
  nodeId: string;
  venueDir: string;
  stateDir: string;
  litestreamBin: string;
  log: Logger;
  now: () => Date;
  /** Read at each start, so a promotion is followed. */
  isPrimary: () => boolean;
  /** Test seams; production leaves them unset. */
  spawn?: SpawnFn;
  store?: ObjectStore;
  walLimitBytes?: number;
}

/**
 * The one owner of the live copy's supervisor in this process: reads the bucket settings, builds
 * the supervisor on the primary, rebuilds it when the settings change, and stops it. `start()` and
 * `reload()` never throw for a bucket or vault problem: a copy that cannot start is logged and reads
 * off, and the till is untouched. The only bucket wait on their path is a stopping supervisor's
 * (`StreamSupervisor.stop()`), which both wait for before starting the next. At most one supervisor
 * runs, and the old one has stopped before the next starts.
 */
export class StreamHost {
  readonly #deps: StreamHostDeps;
  #supervisor: StreamSupervisor | undefined;
  /** Set when the settings are stored but no supervisor could start, so the alerts can say so. */
  #notStarted: StreamNotStarted | undefined;
  #reloading = false;
  #stopped = false;
  #retiring: Promise<void> = Promise.resolve();

  constructor(deps: StreamHostDeps) {
    this.#deps = deps;
  }

  async start(): Promise<void> {
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
      const membership = await readNodeMembership(db);
      if (membership === null) {
        log("warn", "stream.no_membership", {});
        this.#notStartedFor("no_membership");
        return;
      }
      // A supervisor still stopping may still have Litestream running; and a stop() or an
      // overlapping start() may land while this waits.
      await this.#retiring;
      if (this.#stopped || this.#supervisor !== undefined) return;
      const venueDbPath = join(this.#deps.venueDir, "venue.db");
      const supervisor = new StreamSupervisor({
        litestreamBin: this.#deps.litestreamBin,
        venueDbPath,
        configDir: join(this.#deps.stateDir, "stream"),
        bucket: settings.bucket,
        venueId: settings.venueId,
        nodeId: this.#deps.nodeId,
        term: membership.body.term,
        sign: async (message) => signBytes(message, await readNodeIdentityKey(db, ring)),
        foldBack: () => db.checkpointTruncate(),
        walBytes: () => fileBytes(`${venueDbPath}-wal`),
        walLimitBytes: this.#deps.walLimitBytes ?? DEFAULT_WAL_LIMIT_BYTES,
        now: this.#deps.now,
        log,
        spawn: this.#deps.spawn,
        store: this.#deps.store,
        onCommit: (listener) => db.onCommit(listener),
      });
      this.#supervisor = supervisor;
      await supervisor.start();
    } catch (error) {
      // Absent settings read as null (`tryGetCredential`, packages/credentials/src/store.ts), so a
      // throw here comes from stored settings, from a later step, or from the database failing to
      // answer.
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
    await this.#retire();
    this.#deps.log("info", "stream.stopped", {});
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
   * After the settings change: stops the running supervisor, then starts one on whatever the vault
   * now holds — none, if the settings were removed. A second call while one runs is refused rather
   * than interleaved.
   */
  async reload(): Promise<void> {
    if (this.#reloading) throw new AppError("backup.reload_in_progress", {});
    this.#reloading = true;
    try {
      await this.#retire();
      await this.start();
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

import type { Logger } from "./logger.js";
import type { VenueLock, VenueHolder } from "@waitron/store";
import type { Hono } from "hono";
import type { Statfs } from "./free-bytes.js";
import type { RecoveryServeOptions } from "./recovery-listener.js";
import type { RecoveryState } from "./recovery-state.js";
import type { StagedResetDeps } from "./reset-request.js";
import type { StagedRestoreDeps } from "./restore-request.js";
import type { ShutdownTarget } from "./run-server.js";
import type { SetupClockSet } from "./setup-clock-set.js";
import type { PreviousStop } from "./stop-mark.js";

export interface EntryDeps {
  /** The arguments the process was started with, after the script's own path. */
  args: readonly string[];
  /** The process environment, before the box's own env files are merged under it. */
  baseEnv: NodeJS.ProcessEnv;
  stateDir: string;
  /** Resolved by the caller, because the entrypoint never runs `loadConfig`: a box reaches recovery
   *  precisely when its configuration is what is broken. */
  venueDir: string;
  runStagedRestore?: (deps: StagedRestoreDeps) => Promise<boolean>;
  runStagedReset?: (deps: StagedResetDeps) => Promise<boolean>;
  /** Defaults to the shared `assertNotAhead`, never a no-op: it is a guard, and a no-op default
   *  is lost silently by any caller that forgets the dependency. */
  assertNotAhead?: (venueDir: string, migrationsRoot: string) => Promise<void>;
  /** Defaults to the real `clearReplacedDatabases` (restore-file-placement.ts), never a no-op, for the same reason. */
  clearReplacedDatabases?: (venueDir: string, log: Logger) => Promise<void>;
  clearRestoreSecretFiles?: (stateDir: string, log: Logger) => Promise<void>;
  /** Defaults to the real `lockVenueDatabase`, never a no-op: the clearing is safe only while the
   *  folder is held. */
  lockVenue?: (venueDir: string) => Promise<VenueLock>;
  /**
   * The installer's channel — the container's stdout (`docker logs`). Its no-op default, unlike
   * `assertNotAhead`'s, is safe because it is diagnostic output, not a guard: omitting it changes
   * no outcome.
   */
  reportFailure?: (text: string) => void;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  readRecoveryState: (stateDir: string) => Promise<RecoveryState>;
  writeRecoveryState: (stateDir: string, state: RecoveryState) => Promise<void>;
  /** Held around every change to `recovery.json`; defaults to the real cross-process lock. */
  withRecoveryLock?: <T>(stateDir: string, body: () => Promise<T>) => Promise<T>;
  /** Reads the holder file beside `venue.lock`; defaults to the real reader. */
  readVenueHolder?: (venueDir: string) => VenueHolder | null;
  now?: () => Date;
  startServer: (
    env: NodeJS.ProcessEnv,
    base?: NodeJS.ProcessEnv,
    stop?: { previousStop: PreviousStop },
  ) => Promise<StartedEntryServer>;
  serveRecovery: (app: Hono, opts: RecoveryServeOptions) => Promise<unknown>;
  /** Serves the page a restore's start shows while it waits to confirm its time. */
  serveStartClockWaiting: (
    app: Hono,
    opts: RecoveryServeOptions,
  ) => Promise<{ close(): Promise<void> }>;
  /** Whether the box's internet time service answers synchronised; absent, the host's answer. */
  timeServiceSynchronised?: () => Promise<boolean>;
  /** The waiting page's clock setter; absent, the restore page's (`createSetupClockSet`). */
  startClockSetter?: () => SetupClockSet;
  /** Also installed while a restore's start waits to confirm its time, and taken off through
   *  the answer before the server's go on; an answer that is not a function takes nothing off. */
  installShutdownHandlers: (server: ShutdownTarget) => (() => void) | void;
  /** Runs `onStayedUp` once the process has survived `ms` — see the counter rule in `runEntry`. */
  scheduleStayedUp: (ms: number, onStayedUp: () => void) => void;
  log: Logger;
  /** Where the recovery page reads its log tail from, and where each start records itself. */
  logDir?: string;
  /**
   * Where the migration sets live. Never `null`: null means "resolve from the bundle's own
   * directory", which fails a real container's first boot with `migrations.set_missing`. `runEntry`
   * hands this one value to both the staged restore and the ahead check.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
  /** Below this many free bytes the start deletes the files it no longer needs; defaults to
   *  `START_FREE_SPACE_FLOOR`. */
  freeSpaceFloor?: number;
  /** Reads a folder's filesystem; defaults to the real `statfs`. */
  statfs?: Statfs;
  /** The spare file's size; defaults to `SPARE_SPACE_BYTES`, and `0` keeps none. */
  spareBytes?: number;
}
/** What a start hands back; `fullyStarted` is present when it answers before its start finishes. */
export interface StartedEntryServer {
  markRestart?: () => Promise<void>;
  close(): Promise<void>;
  fullyStarted?: Promise<void>;
}

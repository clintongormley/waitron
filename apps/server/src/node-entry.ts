import { realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { AppError, isAppError, MAX_CAUSE_DEPTH } from "@waitron/shared";
import { codeOf } from "@waitron/server-kit";
import { openVenueDatabase } from "@waitron/db";
import { manifestSets } from "@waitron/migrations";
// Aliased: this module exports its own `assertNotAhead` — the wrapper that opens the venue
// directory — and `EntryDeps` has a field of the same name.
import { assertNotAhead as assertDatabaseNotAhead } from "@waitron/provisioning";
import {
  BOX_HOSTNAME,
  DEFAULT_MIGRATIONS_ROOT,
  DEFAULT_STATE_ROOT,
  startLandingListener,
  startServer,
  type LandingListenerConfig,
} from "./boot.js";
import { loadBoxEnv } from "./box-env.js";
import { listBoxIpv4, parseBoxAddresses } from "./box-reach.js";
import {
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_LANDING_PORT,
  DEFAULT_HTTP_PORT,
  MAX_HTTP_PORT,
  resolveConfigDir,
} from "./config.js";
import { isUnset } from "./env-value.js";
import { createLogger, type Logger } from "./logger.js";
import {
  FRESH,
  afterFailure,
  readRecoveryState,
  writeRecoveryState,
  type RecoveryState,
} from "./recovery-state.js";
import { BOOT_INCOMPLETE, recoveryApp } from "./recovery-surface.js";
import { installShutdownHandlers } from "./run-server.js";
import { buildServeOptions, type TlsFiles } from "./tls.js";
import { mintedBoxLeaf } from "./box-secrets.js";
import { mountDiscovery } from "./discovery-api.js";
import { runStagedRestore, type StagedRestoreDeps } from "./restore-request.js";
import { loadCloudOrigin } from "./cloud-client.js";
import { createCloudRecoveryClient } from "./cloud-recovery.js";
import { classifyBootFailure } from "./boot-failure.js";
import { redactSecrets } from "./redact-secrets.js";
import "./errors.js";

/** How long a boot must survive before its failure counter is cleared (spec §9.2). */
const STAYED_UP_MS = 120_000;

/**
 * The box's own leaf for the recovery page, or `undefined` when it has never minted one — the same
 * `mintedBoxLeaf` fallback the setup branch and the trading branches use, so all three present the
 * one leaf an already-trusting phone accepts. Kept as a named re-export because spec §9.3's "recovery
 * falls back to plain HTTP" limit is a fact about THIS surface, and `serveRecovery` below reads it.
 */
export function recoveryTlsFiles(stateDir: string): TlsFiles | undefined {
  return mintedBoxLeaf(stateDir);
}

export interface RecoveryServeOptions {
  stateDir: string;
  port: number;
  log: Logger;
  /** The plain-HTTP trust/landing listener's config, when recovery should serve the trust page beside
   * the HTTPS page (built by `landingConfigFrom` in the recovery path). Omitted → no landing listener,
   * which is how the direct-bind tests keep to one socket. */
  landing?: LandingListenerConfig;
  /** Injected for tests; defaults to the real `startLandingListener`. */
  startLanding?: (
    config: LandingListenerConfig,
    log: Logger,
  ) => { close(): Promise<void> } | undefined;
}

/**
 * Bind the recovery page on the box's own HTTPS port, presented with the box's existing leaf so an
 * already-trusting phone reaches it at the same URL with no new trust step. Beside it, serve the same
 * plain-HTTP trust/landing page trading mode does (when `opts.landing` is given): a phone that does
 * NOT yet trust the box's self-signed leaf hits the browser's cert interstitial before any recovery JS
 * runs, so it needs the plain-HTTP page to fetch the CA and its trust steps.
 *
 * Resolves when the socket is actually bound (`serve`'s `listeningListener`, not source order —
 * `serve()` returns before the bind, as `boot.ts`'s `startListening` records), and rejects if the
 * bind fails: the caller lets that escape, so a port it cannot take exits non-zero and Docker
 * restarts into the same decision rather than leaving a silent, page-less container up.
 */
export function serveRecovery(
  app: Hono,
  opts: RecoveryServeOptions,
): Promise<ReturnType<typeof serve>> {
  return new Promise((resolve, reject) => {
    const tls = recoveryTlsFiles(opts.stateDir);
    const surface = new Hono();
    mountDiscovery(
      surface,
      {
        stateDir: opts.stateDir,
        hostname: BOX_HOSTNAME,
        port: opts.port,
        secure: tls !== undefined,
        listIpv4: () => opts.landing?.boxAddresses ?? listBoxIpv4(),
        discoveryEnabled: false,
      },
      opts.log,
    );
    surface.route("/", app);
    const server = serve(
      buildServeOptions({ fetch: surface.fetch, port: opts.port }, tls),
      (info) => {
        opts.log("warn", "recovery.listening", { port: info.port, tls: tls !== undefined });
        // Best-effort, exactly as in trading mode: `startLandingListener` swallows its own bind failure
        // and returns undefined when there is nothing to serve (no minted leaf, or the port disabled),
        // so a missing or unbindable landing page never takes the recovery page down. Started only after
        // the HTTPS bind succeeds so the two do not race for the same port.
        const startLanding = opts.startLanding ?? startLandingListener;
        const landing = opts.landing ? startLanding(opts.landing, opts.log) : undefined;
        if (landing !== undefined) {
          // The recovery server outlives everything until the process exits (production never closes it),
          // so this fires only on a deliberate teardown — a test, or a future shutdown path.
          server.on("close", () => void landing.close().catch(() => {}));
        }
        resolve(server);
      },
    );
    server.on("error", (error: NodeJS.ErrnoException) => {
      reject(new AppError("server.listen_failed", { port: opts.port, code: error.code ?? "" }));
    });
  });
}

/**
 * The plain-HTTP trust/landing listener's config for the recovery path, built from throw-free env
 * reads (recovery never runs `loadConfig` — a broken config is what lands a box here). `tls` is always
 * undefined: recovery presents the box's OWN minted leaf (`recoveryTlsFiles`), never an operator cert,
 * so the trust page is warranted exactly when a minted leaf exists — the check `startLandingListener`
 * then makes.
 */
function landingConfigFrom(
  env: NodeJS.ProcessEnv,
  stateDir: string,
  httpPort: number,
): LandingListenerConfig {
  let boxAddresses: string[] | undefined;
  try {
    boxAddresses = parseBoxAddresses(env.WAITRON_BOX_ADDRESSES);
  } catch {
    // A malformed WAITRON_BOX_ADDRESSES must not crash recovery; fall back to enumerating interfaces.
    boxAddresses = undefined;
  }
  const raw = env.WAITRON_HTTP_LANDING_PORT;
  // `0` disables the listener (kept, unlike httpPort); an unset or out-of-range value takes the
  // default rather than throwing, mirroring `httpPortFrom`.
  const landingPort = isUnset(raw) ? DEFAULT_HTTP_LANDING_PORT : Number.parseInt(raw, 10);
  return {
    landingPort:
      Number.isInteger(landingPort) && landingPort >= 0 && landingPort <= MAX_HTTP_PORT
        ? landingPort
        : DEFAULT_HTTP_LANDING_PORT,
    httpHost: isUnset(env.WAITRON_HTTP_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_HTTP_HOST,
    stateDir,
    httpPort,
    boxAddresses,
    tls: undefined,
  };
}

export interface EntryDeps {
  /** The arguments the process was started with, after the script's own path. */
  args: readonly string[];
  /** The process environment, before the box's own env files are merged under it. */
  baseEnv: NodeJS.ProcessEnv;
  stateDir: string;
  /** The directory holding `venue.db` and `node.db`: the same value `config.venueDir` resolves for
   *  the server (`config.ts`). Resolved by the CALLER, because the entrypoint never runs
   *  `loadConfig` — a box reaches recovery precisely when its configuration is what is broken. */
  venueDir: string;
  /** Executes a staged restore before loadBoxEnv/startServer opens the venue files. */
  runStagedRestore?: (deps: StagedRestoreDeps) => Promise<boolean>;
  /** Refuses a database migrated by a different image. Injected so `runEntry` stays unit-testable;
   *  it defaults to the real `assertNotAhead` BELOW in this file, as `runStagedRestore` above
   *  defaults to the real one — because it is a GUARD. A no-op default is lost by any caller that
   *  forgets the dependency, and lost silently: nothing throws and nothing logs. (`reportFailure`
   *  below does default to a no-op; its own doc says why that one is different.) */
  assertNotAhead?: (venueDir: string, migrationsRoot: string) => Promise<void>;
  /**
   * The INSTALLER's channel — the container's stdout, which is `docker logs`, never the
   * `waitron.log` the recovery page tails. It is the one place the caught error's own words may
   * appear, and only after `redactSecrets`. Injected so the failure path is unit-covered; a test
   * that omits it gets the no-op below and asserts nothing about it.
   *
   * It keeps that no-op default, unlike `assertNotAhead` above, because it is diagnostic OUTPUT and
   * not a guard: omitting it loses detail from `docker logs` and changes no outcome — the boot still
   * throws, `main` at the bottom of this file still writes the structured `server.boot_failed` line,
   * and the recovery page still shows the classified code. `main` is `runEntry`'s only non-test
   * caller and wires the real stdout write. A real-stdout default would instead print a stack for
   * every unit test that exercises a failing boot without supplying it: replacing the no-op with a
   * marker write printed it twelve times from `node-entry.test.ts` alone (measured 2026-09-11).
   */
  reportFailure?: (text: string) => void;
  loadBoxEnv: (base: NodeJS.ProcessEnv, stateDir: string) => Promise<NodeJS.ProcessEnv>;
  readRecoveryState: (stateDir: string) => Promise<RecoveryState>;
  writeRecoveryState: (stateDir: string, state: RecoveryState) => Promise<void>;
  startServer: (
    env: NodeJS.ProcessEnv,
    base?: NodeJS.ProcessEnv,
  ) => Promise<{ close(): Promise<void> }>;
  serveRecovery: (app: Hono, opts: RecoveryServeOptions) => Promise<unknown>;
  installShutdownHandlers: (server: { close(): Promise<void> }) => void;
  /** Runs `onStayedUp` once the process has survived `ms` — see the counter rule in `runEntry`. */
  scheduleStayedUp: (ms: number, onStayedUp: () => void) => void;
  log: Logger;
  /** Where the recovery page reads its log tail from; defaults to `config.ts`'s own default. */
  logDir?: string;
  /**
   * Where the migration sets live. Typed `string`, never `string | null`: null means "resolve from
   * the bundle's own directory", which is exactly the value that fails a real container's first
   * boot with `migrations.set_missing`.
   *
   * ONE folder, stated once here: the default is the same expression `startServer` passes, and
   * `runEntry` hands this same value to BOTH of its own migration-set readers, so the staged
   * restore, the ahead check and the server it starts can never read three different folders.
   */
  migrationsRoot?: string;
  exit?: (code: number) => void;
}

/**
 * `WAITRON_HTTP_PORT`, or `config.ts`'s own default — resolved here rather than through
 * `loadConfig`, because a box reaches recovery precisely when its configuration may be what is
 * broken and a config that throws would take the page down with it. The bounds are `config.ts`'s
 * too, imported not copied: an out-of-range value reaches `listen` as a raw `ERR_SOCKET_BAD_PORT`,
 * and a box whose `WAITRON_HTTP_PORT` is `999999` is exactly a box that fails `loadConfig` three
 * times and lands here. Zero is out of range for the same reason the rest are: to `listen` it means
 * "any free port", which puts the page somewhere the operator cannot find it.
 */
function httpPortFrom(env: NodeJS.ProcessEnv): number {
  const port = Number.parseInt(env.WAITRON_HTTP_PORT ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= MAX_HTTP_PORT ? port : DEFAULT_HTTP_PORT;
}

/* v8 ignore start -- the real process binding; every test supplies its own `exit` instead */
const DEFAULT_EXIT = (code: number): void => process.exit(code);
/* v8 ignore stop */

/**
 * Persist the escalation state, REPORTING a write failure rather than letting it become the
 * outcome. Used everywhere the write is not the point of the moment: on the failure path the boot's
 * own error is what an operator needs, in the stayed-up callback a floating rejection would kill a
 * HEALTHY server two minutes after it booted, and in the retry a failed reset just means the page
 * comes back after the restart. The one write that is NOT routed through here is the pre-boot
 * counter, which is allowed to throw: a state volume that cannot be written is a box that can never
 * escalate, and the server would fail on the same volume moments later anyway.
 */
async function persistState(deps: EntryDeps, next: RecoveryState): Promise<void> {
  try {
    await deps.writeRecoveryState(deps.stateDir, next);
  } catch (error) {
    deps.log("warn", "recovery.state_write_failed", { errorCode: codeOf(error) });
  }
}

/** An `AppError`'s params as one line, or a placeholder when they will not serialise. */
function paramsLine(params: unknown): string {
  try {
    return `params: ${JSON.stringify(params)}`;
  } catch {
    return "params: (not serialisable)";
  }
}

/**
 * What the installer's channel gets for a failed boot: the outer error's name, message and stack,
 * then every wrapped `cause` below it by name and message, and an `AppError`'s params at whichever
 * level carries them — all through `redactSecrets`, because this is the one place the caught error's
 * own words may appear (spec §4.4) and it is `docker logs`, never the page.
 *
 * The chain is walked because the outer error is often not the whole reason — but it is NO LONGER
 * the query layer that makes it so. Measured on this tree, through `withTransaction` + `tx.execute`:
 * `select absent_column` arrives as a plain `Error` whose own message is
 * `no such column: absent_column`, with `cause` undefined. The wrapper the PostgreSQL driver added
 * — an outer `Failed query: …` with the real message in `cause` alone — is gone, so on this engine
 * the outer error IS the driver's words. What still nests is ours: an `AppError` raised over a
 * caught cause, and a boot path that re-throws one around another. Walking the chain costs nothing
 * when there is one level and is what reports the reason when there are several. Params travel for
 * the same reason: `migrations.incomplete`'s counts and
 * `provisioning.database_ahead`'s hashes ARE the diagnosis, and the code alone was already in the
 * structured `server.boot_failed` line.
 *
 * Only the outer stack is included. A stack per level triples the output for the frames of a driver
 * the installer cannot act on; the names and messages are what name the fault.
 *
 * Its own loop, but not its own bound: `MAX_CAUSE_DEPTH` is imported from `@waitron/shared`'s
 * `cause-chain.ts`.
 * `firstCodeInCauseChain` itself cannot serve here — it returns the FIRST accepted code and stops,
 * while this keeps every level.
 */
function failureDetail(error: unknown): string {
  const lines: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    const prefix = depth === 0 ? "" : "caused by: ";
    if (current instanceof Error) {
      lines.push(`${prefix}${current.name}: ${current.message}`);
      if (depth === 0) lines.push(current.stack ?? "(no stack)");
      if (isAppError(current)) lines.push(paramsLine(current.params));
    } else {
      lines.push(`${prefix}non-error thrown: ${String(current)}`);
    }
    if (typeof current !== "object" || current === null) break;
    const cause: unknown = (current as { cause?: unknown }).cause;
    if (cause === undefined || cause === current) break;
    current = cause;
  }
  return redactSecrets(lines.join("\n"));
}

/** What the installer's channel gets for a start given arguments: the code, the first argument, how
 *  many followed, and the form that runs an operator command instead. The first argument is printed
 *  because it normally names the command, which tells the operator what to correct, though it too
 *  can carry a secret `redactSecrets` does not mask; the later ones are not printed. */
function argumentsRefused(args: readonly string[]): string {
  const more = args.length - 1;
  const rest = more === 0 ? "" : ` and ${more} more argument${more === 1 ? "" : "s"}, not shown`;
  return redactSecrets(
    [
      `server.entry_arguments_refused: this program takes no arguments, and was given: ${args[0]}${rest}`,
      "To run an operator command, override the entrypoint:",
      "  docker compose run --rm --entrypoint node app /app/<command>.js <arguments>",
    ].join("\n"),
  );
}

/**
 * Refuse a venue database carrying migrations this image does not ship: open the directory, compare
 * each set's journal against the migration files under `migrationsRoot`, close. The default for
 * `EntryDeps.assertNotAhead`, so it is the shape `runStagedRestore` already sets — the real
 * implementation, never a no-op that a caller could lose the guard to by forgetting the dependency.
 *
 * Judging a database NOTHING has migrated yet is safe because the comparison runs in one direction
 * only: `unknownHashes` (`packages/provisioning/src/schema-ahead.ts`) reports hashes the DATABASE
 * carries and the image has no file for, so a journal that is a strict subset of the image's — an
 * ordinary upgrade — is not refused. Both directions are pinned by the `assertNotAhead` cases in
 * `node-entry.test.ts`.
 *
 * The other half, which a first boot depends on: a set whose journal TABLE does not exist is
 * SKIPPED, not an error, so a virgin venue directory passes. `journalHashes` asks `sqlite_master`
 * for the table rather than catching a refusal (`packages/migrations/src/journal-hashes.ts`); it
 * caught PostgreSQL's `42P01` until 2026-09-22, which on this engine made every first boot throw.
 * Pinned by "a VIRGIN venue directory passes the ahead check" below.
 *
 * `migrationsRoot` is a parameter rather than a closure over the entrypoint's own, so this can BE
 * that default: the one folder both halves read is `EntryDeps.migrationsRoot`, which `runEntry`
 * passes in.
 *
 * Closed in a `finally`: this open exists only for the check, and `startServer` opens the same
 * directory for the life of the process.
 */
export async function assertNotAhead(venueDir: string, migrationsRoot: string): Promise<void> {
  const store = await openVenueDatabase(venueDir);
  try {
    await assertDatabaseNotAhead(store.venue, manifestSets(), migrationsRoot);
  } finally {
    await store.close();
  }
}

/**
 * One container start: decide the level, bring the venue directory into shape, hand the server its
 * environment, and start it — or serve the recovery page instead.
 *
 * FOUR orderings carry the whole design, and each is invisible in production if it is wrong:
 *
 * 1. The level is read FIRST, before anything opens the venue database. A database-side failure is
 *    exactly what puts a box in recovery, so deciding after the restore and the ahead check would
 *    make the page unreachable in most of the cases it exists for (spec §9.3).
 * 2. The failure counter is written BEFORE the boot's FIRST step, never only in a failure handler
 *    and never only around `startServer`: a boot that HANGS never throws, so a counter written
 *    later covers none of the steps before it, and a box that cannot boot restart-loops without
 *    ever reaching the page that exists for exactly that case. Pinned by "counts a boot that HANGS
 *    in the staged restore" and "increments the counter BEFORE the server starts".
 * 3. It CLEARS only from the stayed-up callback — `startServer` resolved AND the process then
 *    survived `STAYED_UP_MS`. Clearing on "started" alone is a measurement where pass and fail look
 *    alike: a module throwing five seconds in would reset the counter on every attempt.
 * 4. The ahead check runs AFTER `runStagedRestore`, which replaces the venue files, and BEFORE
 *    `startServer`, which migrates and then queries the schema. It runs against a database nothing
 *    has migrated yet — `startServer` owns the migration now (`boot.ts`) — and what makes that safe
 *    is the one-directional comparison this file's `assertNotAhead` documents. Pinned by "checks
 *    the VENUE DIRECTORY for an ahead database before the server starts".
 *
 * `startServer` resolving is the signal rather than a healthy `/health` probe because `/health` is
 * 503 on a setup box by design, so a health-gated reset would drive every unprovisioned box into
 * recovery.
 */
export async function runEntry(deps: EntryDeps): Promise<void> {
  // `docker compose run app <command>` appends `<command>` here. Booting instead would start a
  // second server, and with the app stopped for a restore nothing holds the venue folder to refuse
  // it. Before the level is read, so a box at the recovery level refuses too, and before the
  // counter is written, so a mistyped command is not a failed start.
  if (deps.args.length > 0) {
    (deps.reportFailure ?? (() => {}))(argumentsRefused(deps.args));
    throw new AppError("server.entry_arguments_refused", {});
  }

  const state = await deps.readRecoveryState(deps.stateDir);
  const logDir = deps.logDir ?? join(deps.stateDir, "logs");
  const exit = deps.exit ?? DEFAULT_EXIT;

  if (state.level === "recovery") {
    // The page's log tail is the SERVER's rotating file (`<logDir>/waitron.log`). A box escalated
    // before the server ever started — a staged-restore or ahead-check failure — therefore
    // shows its `lastErrorCode` above an empty tail, because the entrypoint's own log goes to stdout
    // (`docker logs`) and nothing writes that file until `startServer` gets far enough. Stated, not
    // fixed: a second sink in the entrypoint is more moving parts on the one path that must not
    // fail, and the code plus `docker logs` carry the same information.
    deps.log("warn", "recovery.serving", {
      failures: state.failures,
      lastErrorCode: state.lastErrorCode,
    });
    const httpPort = httpPortFrom(deps.baseEnv);
    await deps.serveRecovery(
      recoveryApp({
        state,
        logDir,
        // The level argument is not written: `readRecoveryState` DERIVES the level from the count,
        // so a zero count IS "normal" and a hand-written level could not pin a box either way. The
        // exit is the whole retry — Docker's restart policy performs the restart (spec §9.3).
        onRetry: async () => {
          await persistState(deps, FRESH);
          exit(0);
        },
      }),
      {
        stateDir: deps.stateDir,
        port: httpPort,
        log: deps.log,
        landing: landingConfigFrom(deps.baseEnv, deps.stateDir, httpPort),
      },
    );
    return;
  }

  // The counter covers the WHOLE attempt, so it is written before the first step that can fail.
  // Consequence, accepted: an attempt CUT SHORT counts too — three power-cycles during a long cold
  // restore land a box on the page, where the retry button clears it. A counter that only counted
  // completed failures could not count the boot that hangs, which is the case it exists for.
  await deps.writeRecoveryState(deps.stateDir, afterFailure(state, BOOT_INCOMPLETE, new Date()));

  let server: { close(): Promise<void> };
  try {
    // Resolved once, so the two steps below and the server cannot read different folders.
    const migrationsRoot = deps.migrationsRoot ?? DEFAULT_MIGRATIONS_ROOT;

    const recoveryOrigin = loadCloudOrigin(deps.baseEnv);
    await (deps.runStagedRestore ?? runStagedRestore)({
      stateDir: deps.stateDir,
      venueDir: deps.venueDir,
      migrationsRoot,
      log: deps.log,
      onManagedCloudRestored: async (binding) => {
        if (recoveryOrigin)
          await createCloudRecoveryClient({
            stateDir: deps.stateDir,
            origin: recoveryOrigin,
            environment: "preproduction",
          }).markRestored(binding);
      },
    });

    // AFTER the restore, which replaces the venue files, and BEFORE the server opens them: only the
    // ahead direction is unrecoverable, and naming it here is the whole point — drizzle applies and
    // reports nothing for an ahead journal, so the mismatch would otherwise surface as an
    // unclassified driver error in whatever query first touched the changed schema (spec §4.2).
    await (deps.assertNotAhead ?? assertNotAhead)(deps.venueDir, migrationsRoot);

    const env = await deps.loadBoxEnv(deps.baseEnv, deps.stateDir);
    // The RAW base env goes alongside the merged `env`: boot re-reads the box-env files off disk on
    // every backup reload (so the wizard's `backup.env` takes effect without a restart) and needs the
    // unmerged base to tell a file-sourced value from an env-sourced one (spec §3.2 provenance).
    server = await deps.startServer(env, deps.baseEnv);
    if (recoveryOrigin) {
      void createCloudRecoveryClient({
        stateDir: deps.stateDir,
        origin: recoveryOrigin,
        environment: "preproduction",
      })
        .reportRestored()
        .catch(() => {});
    }
  } catch (error) {
    // The installer's channel first, so the real reason survives even if the state write fails.
    (deps.reportFailure ?? (() => {}))(failureDetail(error));
    const code = classifyBootFailure(error);
    // Another process holds the venue folder, usually the running server with this start a second
    // copy beside it, so the count read above goes back. The cost: a folder held by something stuck
    // never reaches the page. Otherwise the same count as the pre-boot write — one attempt is one
    // failure, not two — now carrying the classified code. Rethrown: exits non-zero.
    await persistState(
      deps,
      code === "provisioning.database_in_use" ? state : afterFailure(state, code, new Date()),
    );
    throw error;
  }

  deps.installShutdownHandlers(server);
  deps.scheduleStayedUp(STAYED_UP_MS, () => void persistState(deps, FRESH));
}

/* v8 ignore start -- the real process wiring: `process.env`, a timer and `process.exit`. Every
   decision lives in `runEntry` above, which takes each of these as a dependency; this half is
   exercised by a container boot, not by a unit test — the shape `bin-recovery.ts` and
   `run-server.ts`'s `DEFAULT_DEPS` both use. */
function bootThisProcess(): Promise<void> {
  // A snapshot of `process.env` at start-up; `runEntry` passes it on as the unmerged base env.
  const env = { ...process.env };
  const stateDir = resolveConfigDir(env.WAITRON_STATE_DIR, DEFAULT_STATE_ROOT);
  // `config.ts`'s own expression for `venueDir` (`config.ts:746`), repeated rather than reached
  // through `loadConfig`: the entrypoint never loads the config, because a broken config is what
  // lands a box here. `restore-command.ts` repeats it for the same reason.
  const venueDir = resolveConfigDir(env.WAITRON_VENUE_DIR, join(stateDir, "venue"));
  // `config.ts`'s own fallback, verbatim (it stores this one unresolved). The one-folder rule is
  // stated on `EntryDeps.migrationsRoot`.
  const migrationsRoot = isUnset(env.WAITRON_MIGRATIONS_DIR)
    ? DEFAULT_MIGRATIONS_ROOT
    : env.WAITRON_MIGRATIONS_DIR;
  const log = createLogger(
    (line) => void process.stdout.write(line),
    () => new Date(),
  );
  return runEntry({
    args: process.argv.slice(2),
    baseEnv: env,
    stateDir,
    venueDir,
    logDir: isUnset(env.WAITRON_LOG_DIR) ? join(stateDir, "logs") : env.WAITRON_LOG_DIR,
    migrationsRoot,
    runStagedRestore,
    reportFailure: (text) => void process.stdout.write(`${text}\n`),
    loadBoxEnv,
    readRecoveryState,
    writeRecoveryState,
    startServer,
    serveRecovery,
    installShutdownHandlers,
    // `unref` so the timer alone never holds the process open: the listener the server bound is
    // what keeps it alive, and a process that dies before the threshold has not stayed up.
    scheduleStayedUp: (ms, onStayedUp) => void setTimeout(onStayedUp, ms).unref(),
    log,
    exit: DEFAULT_EXIT,
  }).catch((error: unknown) => {
    // `classifyBootFailure`, never the caught value: a driver failure's message can embed a path or
    // a credential, and an unhandled rejection would print the whole stack. The scrubbed text has
    // already gone to stdout from `runEntry`'s catch; this line stays structured.
    log("error", "server.boot_failed", { errorCode: classifyBootFailure(error) });
    process.exit(1);
  });
}

/**
 * Run ONLY when this file is the process's own entry point (`node /app/node-entry.js`), never when
 * it is imported — its own unit test imports it for `runEntry` and for `assertNotAhead`, and an
 * unguarded call here would open the venue database and start a server from inside the test runner.
 * `realpathSync` because a symlinked bin resolves to a different path than `import.meta.url`. The
 * import direction is what a test can measure, and `node-entry.test.ts` measures it: it imports
 * this module and nothing boots.
 */
if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await bootThisProcess();
}
/* v8 ignore stop */

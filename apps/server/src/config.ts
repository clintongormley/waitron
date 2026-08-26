import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { DEFAULTS } from "@waitron/scheduler";
import { loadTillConfig } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

export type DeploymentEnvironment = "production" | "preproduction";

export interface SchedulerConfig {
  horizonDays: number;
  maxPeriodsPerTick: number;
  maxAttempts: number;
  backoffBaseMs: number;
  staleAfterMs: number;
}

export interface ServerConfig {
  databaseUrl: string;
  /**
   * The connection Drizzle's migrator runs over. Defaults to `databaseUrl` — same variable, same
   * role — so a deployment that only sets `DATABASE_URL` keeps today's single-role behaviour.
   * Set separately when `DATABASE_URL` is the least-privileged, non-superuser deployment role
   * spec §10 requires: that role cannot run `CREATE SCHEMA IF NOT EXISTS "public"` or
   * `CREATE TABLE IF NOT EXISTS` (Postgres checks the privilege before the `IF NOT EXISTS` even
   * against an already-migrated database — `apps/server/README.md` has the confirmed grant list),
   * so migrations need a role of their own. Read by `@waitron/migrations`'s `applyMigrations` and,
   * before that, by `boot.ts`'s own deployment-stamp probe (`boot.ts:103`) — both run before the
   * long-lived pool below is ever opened.
   */
  migrationsDatabaseUrl: string;
  environment: DeploymentEnvironment;
  httpPort: number;
  /** Defaults to loopback. `/health` (spec §9) is deliberately unauthenticated, which is fine on a
   * loopback listener and less fine on every interface — the body is operational metadata, not a
   * secret, but there is no reason to serve it beyond the host `apps/server` runs on by default. */
  httpHost: string;
  minTickMs: number;
  maxTickMs: number;
  /** How long after a skipped tenant or pair either duty reports work due again. ONE value for
   * BOTH duties: they are independently defaulted in their own packages (no invariant ties them),
   * and this host deliberately presents a single operator-visible skip cadence. */
  skipRetryMs: number;
  /** Undefined means "let the neutral layer apply its own seven days" — not zero. */
  settlementLagMs: number | undefined;
  migrationsRoot: string;
  /**
   * The local directory product images are stored in — the upload route (a later slice) writes
   * `<sha256hex>.<ext>` files here and the public `/media/:filename` serve route reads them back.
   * Resolved to an ABSOLUTE path at load (`resolve`): the serve route joins an untrusted filename
   * onto it, so it must be a settled absolute base, not a relative one whose meaning shifts with the
   * process's cwd. Defaults to a boot-computed `defaultMediaRoot` threaded into `loadConfig` exactly
   * as `defaultMigrationsRoot` is (see `boot.ts`); `WAITRON_MEDIA_DIR` overrides it, and deployment
   * (#9) sets it explicitly. An unset OR EMPTY value falls back to the default via `isUnset` — never
   * `resolve("")`, which is cwd (the "empty value is a valid value" trap, CLAUDE.md §3). `boot.ts`
   * ensures the directory exists once at startup (`mkdirSync(mediaDir, { recursive: true })`).
   */
  mediaDir: string;
  /**
   * The PEM files that make this host serve HTTPS. BOTH-or-NEITHER (loadConfig refuses a
   * half-configured pair): absent means plain HTTP for loopback dev, present means TLS. This task
   * only makes the process TLS-CAPABLE — production local-CA trust and LAN binding are deployment
   * (#9). `boot.ts` also derives the session cookie's `Secure` attribute from whether this is set
   * (`secureCookies: config.tls !== undefined`): a cookie marked `Secure` is never sent back over
   * plain HTTP, so it must track the transport the host actually serves.
   */
  tls?: { certFile: string; keyFile: string };
  /** WHICH till this process is — the fiscal identity provisioning stamped into the environment,
   * resolved once here via `loadTillConfig`. `Omit<…, "orderFlow">`: the pay-timing mode is a
   * per-LOCATION column, not an env var, so `boot.ts` reads it via `readOrderFlow` and spreads it in
   * to form the full `TillConfig` handed to the till API (see `till-config.ts`'s `orderFlow` note). */
  till: Omit<TillConfig, "orderFlow">;
  /** The WebAuthn Relying Party ID the dashboard's passkey ceremonies are bound to — the registrable
   * domain the browser scopes credentials to (e.g. `dashboard.example.com`, no scheme or port). A
   * passkey is bound to its RP ID at registration and only offered back on that same RP ID, so this
   * is deployment config, never a hardcoded constant in `@waitron/identity` (spec §4c). Threaded
   * through `boot.ts` into `ManagementApiDeps.rpId`. Defaults to `localhost` for loopback dev/tests;
   * REQUIRED in production (`loadConfig` throws `server.config_missing` if unset). */
  managementRpId: string;
  /** The exact origin the dashboard is served from (scheme + host + optional port, e.g.
   * `https://dashboard.example.com`) — what `@simplewebauthn/server` verifies each ceremony's
   * `response` against as `expectedOrigin`. Distinct from `managementRpId`: the RP ID is the bare
   * domain, the origin carries scheme and port and must match the served URL byte-for-byte or
   * verification fails. Threaded into `ManagementApiDeps.origin`. Defaults to the Vite dev server's
   * `http://localhost:5191` for dev/tests; REQUIRED in production (same guard as `managementRpId`). */
  managementOrigin: string;
  scheduler: SchedulerConfig;
}

/** A liveness floor, not a performance knob: `drain`'s hourly duty must not be lengthened by a
 * quiet ledger, so no sleep may exceed this however far away the next due time looks. Exported
 * for `health.ts`'s `DUTY_BUDGET_MS`: drain's staleness budget must exceed the longest sleep this
 * value can produce, and importing the SAME constant is what keeps that true by construction
 * rather than by two independently-chosen literals that happen to agree — which is how they
 * disagreed before (both were one hour, so an idle host flipped 503 once an hour by construction). */
export const DEFAULT_MAX_TICK_MS = 60 * 60 * 1000;
/** Stops a hot loop when a duty reports `now` — `runDue`'s `deferred > 0` branch (capped work is
 * genuinely runnable immediately, `packages/scheduler/src/run.ts`), and a whole-duty throw
 * (`pass.ts`'s `attempt` catch, which deliberately still reports `now` — it has no other honest
 * answer). Neither duty reports `now` for merely SKIPPED work any more — see `skipRetryMs` above,
 * and `drain` has no `deferred` concept at all. */
const DEFAULT_MIN_TICK_MS = 5_000;
/** The fast lane's idle interval when WAITRON_SYNC_FAST_TICK_MS is unset. A tight starting point that
 * governing §9 explicitly calls a TUNING TARGET, not a settled constant (spec §4d). No cross-guard
 * against minTickMs: a fast tick not tighter than the ordered tick is a mis-tuning, not a correctness
 * failure. */
const DEFAULT_SYNC_FAST_TICK_MS = 1000;
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_HTTP_HOST = "127.0.0.1";
/** The highest port TCP/`net.Server.listen` accepts. Without this bound, `positiveInt` alone lets
 * a value like `999999` reach `serve()` (`boot.ts`), which throws a raw, unformatted
 * `RangeError [ERR_SOCKET_BAD_PORT]` straight out of `startServer` — not the structured
 * `server.config_invalid` this file promises for every other bad input, and not what
 * `apps/server/README.md`'s "every value is validated once, at boot" line claims either. */
const MAX_HTTP_PORT = 65_535;
/** Loopback defaults for the passkey Relying Party, so dev and every test resolve a working RP ID +
 * origin without setting either variable. These apply in preproduction/dev ONLY: in production both
 * are REQUIRED (`requiredInProduction` below throws `server.config_missing` if either is unset), so a
 * real deployment can never silently ship the loopback default and bind passkeys to `localhost`. A
 * production deployment sets both to its served domain (`WAITRON_MANAGEMENT_RP_ID`) and URL
 * (`WAITRON_MANAGEMENT_ORIGIN`) — see the `ServerConfig` fields. The origin default is the dashboard
 * Vite dev server's port (slice 1c), so a browser served from it verifies against the same value this
 * host hands the ceremonies. */
const DEFAULT_MANAGEMENT_RP_ID = "localhost";
const DEFAULT_MANAGEMENT_ORIGIN = "http://localhost:5191";

type Env = Record<string, string | undefined>;

/**
 * An env var is "unset" if it is absent OR the empty string — an operator's `VAR=` in an env file
 * (as opposed to omitting the line entirely) must fall back to the same default as no line at
 * all, not be rejected as an invalid value for whatever type that variable holds. Every fallback
 * and default below goes through this, so the rule lives in exactly one place.
 *
 * `required` uses it too, for the same rule read the other way round: a variable with no usable
 * value is missing, and `VAR=` must be reported as missing rather than accepted as the empty
 * string. Leaving that one site hand-inlined would have made this the second definition of "unset"
 * in the file rather than the only one.
 */
function isUnset(raw: string | undefined): raw is undefined | "" {
  return raw === undefined || raw === "";
}

function required(env: Env, variable: string): string {
  const value = env[variable];
  if (isUnset(value)) {
    throw new AppError("server.config_missing", { variable });
  }
  return value;
}

/**
 * A variable that is OPTIONAL in preproduction/dev — falling back to `devDefault`, a loopback value
 * safe only on localhost — but REQUIRED in production. Shipping the loopback default to a real
 * deployment is a silent misconfiguration that surfaces far downstream: a passkey RP ID / origin left
 * at `localhost` makes every login ceremony fail its origin check with an opaque 401, not a loud boot
 * error. So in production an unset OR empty value (`required`'s own `isUnset` rule) is
 * `server.config_missing`, naming the variable the operator must supply; everywhere else `devDefault`
 * applies via the same `isUnset` fallback the inline defaults in `loadConfig` use.
 */
function requiredInProduction(
  env: Env,
  variable: string,
  environment: DeploymentEnvironment,
  devDefault: string,
): string {
  if (environment === "production") return required(env, variable);
  const raw = env[variable];
  return isUnset(raw) ? devDefault : raw;
}

export interface SyncPeer {
  nodeId: string;
  url: string;
  token: string;
}
export interface SyncTransportConfig {
  /** The accepted INBOUND node tokens — the set a peer's Bearer is validated against. From
   * WAITRON_SYNC_NODE_TOKEN (comma-separated, ≥1 non-blank member). A set of one is the pre-rotation
   * case; ≥2 is the overlap window that rolls the secret with no synchronized restart (spec §2). */
  nodeTokens: string[];
  databaseUrl: string;
  peers: SyncPeer[];
  /** The fast lane's idle interval (ms) — the tighter tick the payments lane polls at, beside the
   * ordered lane's config.minTickMs. From WAITRON_SYNC_FAST_TICK_MS, default 1000 (spec §4d). Lives on
   * the sync config because it is meaningless without sync enabled, like nodeTokens/peers. */
  fastMinIdleMs: number;
}

/** Parses a comma-separated accepted-token SET. `required` fails closed on unset/empty (a blank
 * secret must never mean "no auth", CLAUDE.md §3); a blank MEMBER (a stray `a,,b`) is a hard
 * config_invalid so an empty token can never enter the accepted set. */
function tokenSet(env: Env, variable: string): string[] {
  const tokens = required(env, variable)
    .split(",")
    .map((t) => t.trim());
  if (tokens.some((t) => t.length === 0)) {
    throw new AppError("server.config_invalid", { variable, reason: "blank_token_in_set" });
  }
  return tokens;
}

/**
 * Sync is enabled iff `WAITRON_SYNC_PEERS` is set (a non-empty JSON array of `{ nodeId, url, token }`).
 * Then the node token and the sync database URL (a LOGIN role that is a member of `app_user` AND
 * `sync_tailer` — the app-role pool cannot read `sync_log`) are required, and a blank token or peer
 * field fails closed (the empty-value trap, CLAUDE.md §3): a blank secret must never mean "no auth".
 * The sync NODE ID is `config.till.nodeId`, deliberately NOT a second `WAITRON_SYNC_NODE_ID` variable
 * — two variables that must agree is the drift the one-source-of-truth rule forbids (design deviation,
 * flagged to the owner). Absent peers → `undefined` → no sync is mounted, so a host that sets no sync
 * env (every existing boot) is unaffected.
 */
export function loadSyncConfig(env: Env): SyncTransportConfig | undefined {
  const rawPeers = env.WAITRON_SYNC_PEERS;
  if (isUnset(rawPeers)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPeers);
  } catch {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SYNC_PEERS",
      reason: "not_json",
    });
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SYNC_PEERS",
      reason: "empty_or_not_array",
    });
  }
  const peers = parsed.map((p): SyncPeer => {
    const peer = p as Partial<SyncPeer>;
    if (isUnset(peer.nodeId) || isUnset(peer.url) || isUnset(peer.token)) {
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_SYNC_PEERS",
        reason: "peer_field_blank",
      });
    }
    return { nodeId: peer.nodeId, url: peer.url, token: peer.token };
  });
  return {
    nodeTokens: tokenSet(env, "WAITRON_SYNC_NODE_TOKEN"),
    databaseUrl: required(env, "WAITRON_SYNC_DATABASE_URL"),
    peers,
    fastMinIdleMs: positiveInt(env, "WAITRON_SYNC_FAST_TICK_MS", DEFAULT_SYNC_FAST_TICK_MS),
  };
}

/**
 * The shared parse+validate step behind both `positiveInt` and `optionalPositiveInt` below:
 * `undefined` when the variable is unset, the parsed value otherwise, throwing
 * `server.config_invalid` for anything that is not a positive integer. Neither caller needs a
 * fallback to reach this far — that is each one's OWN concern, applied after this returns — so
 * this function does not take one, and cannot be asked to validate one it was never given.
 */
function parsePositiveInt(env: Env, variable: string): number | undefined {
  const raw = env[variable];
  if (isUnset(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError("server.config_invalid", { variable, reason: "not_a_positive_integer" });
  }
  return value;
}

function positiveInt(env: Env, variable: string, fallback: number): number {
  return parsePositiveInt(env, variable) ?? fallback;
}

function optionalPositiveInt(env: Env, variable: string): number | undefined {
  return parsePositiveInt(env, variable);
}

/**
 * Which environment this whole deployment belongs to — AEAT's endpoints, and the Stripe key mode
 * a tenant's credential must match. ONE setting, not one per provider: there is no legitimate
 * mixed pair. AEAT pre-production with a live Stripe key means taking real money without filing
 * it; AEAT production with a test key means filing invoices for money never taken.
 *
 * Exported so one-shot scripts that build their own backend resolve this the same way the host
 * does — the safe default below is not one for a caller to re-derive.
 */
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const raw = env.WAITRON_ENV;
  // The DEFAULT is preproduction and production must be typed out. Architecture §9: production
  // numbering can never be reused, even for a test invoice, so this is the one default in the file
  // whose mistake is irreversible.
  if (isUnset(raw)) return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ENV",
      reason: "not_a_deployment_environment",
    });
  }
  return raw;
}

export function loadConfig(
  env: Env,
  defaultMigrationsRoot: string,
  defaultMediaRoot: string,
): ServerConfig {
  const minTickMs = positiveInt(env, "WAITRON_MIN_TICK_MS", DEFAULT_MIN_TICK_MS);
  const maxTickMs = positiveInt(env, "WAITRON_MAX_TICK_MS", DEFAULT_MAX_TICK_MS);
  // Checked here rather than left to `clamp`, whose Math.min/Math.max composition would silently
  // resolve an impossible range to whichever bound happened to win.
  //
  // Both variables and both effective values ride in `params` (F6 of the 2026-07-27 pre-merge
  // review), not just the one this guard happens to key off: an operator who set only
  // `WAITRON_MAX_TICK_MS` below the default `WAITRON_MIN_TICK_MS` would otherwise get an error
  // naming a variable they never touched, with the one actually at fault unnamed. Same shape for
  // all three tick-cadence guards in this function.
  if (minTickMs > maxTickMs) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MIN_TICK_MS",
      value: minTickMs,
      otherVariable: "WAITRON_MAX_TICK_MS",
      otherValue: maxTickMs,
      reason: "above_max_tick",
    });
  }
  const skipRetryMs = positiveInt(env, "WAITRON_SKIP_RETRY_MS", DEFAULTS.skipRetryMs);
  // Checked here rather than left to `sleepMsFor`'s clamp (`loop.ts`): that clamp's
  // `Math.max(minTickMs, wait)` would silently round a too-low value back UP to `minTickMs`, which
  // reproduces exactly the failure this variable exists to remove — a skipped tenant (a certificate
  // only a human can provision, say) reporting its retry at the 5-second floor, forever, with no
  // error anywhere: not from `loadConfig`, not from the loop, not from `/health`. A boot failure is
  // loud and immediate; a silently-restored spin is neither. Strictly `<`, not `<=`: equal to
  // `minTickMs` IS the floor, so the clamp leaves it untouched and nothing the operator configured
  // is lost — only a value the clamp would actually RAISE is rejected.
  if (skipRetryMs < minTickMs) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SKIP_RETRY_MS",
      value: skipRetryMs,
      otherVariable: "WAITRON_MIN_TICK_MS",
      otherValue: minTickMs,
      reason: "below_min_tick",
    });
  }
  // F1 of the 2026-07-27 pre-merge review: the symmetric half of the guard above, closing a gap
  // the design doc once claimed did not exist. `sleepMsFor`'s `Math.min(maxTickMs, wait)` clamps a
  // too-HIGH `skipRetryMs` back DOWN — and when `maxTickMs` is itself at or below `minTickMs`
  // (an operator sets only `WAITRON_MAX_TICK_MS`, low), that clamped-down value can land BELOW
  // `minTickMs` too, restoring exactly the 5-second-forever spin this design removes, with every
  // OTHER guard in this file passing: `minTickMs > maxTickMs` is false when both equal `maxTickMs`
  // or below it via their own defaults, and `skipRetryMs < minTickMs` is false because the
  // (unclamped) configured `skipRetryMs` is still >= `minTickMs`. Only the clamp — which this
  // function does not apply, `sleepMsFor` does, at runtime — exposes the problem. Strictly `>`, not
  // `>=`: equal to `maxTickMs` is the clamp's own no-op boundary, so nothing configured is lost
  // there either.
  if (skipRetryMs > maxTickMs) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SKIP_RETRY_MS",
      value: skipRetryMs,
      otherVariable: "WAITRON_MAX_TICK_MS",
      otherValue: maxTickMs,
      reason: "above_max_tick",
    });
  }
  const httpPort = positiveInt(env, "WAITRON_HTTP_PORT", DEFAULT_HTTP_PORT);
  // `positiveInt` alone only rejects zero, negative and non-integer input — it has no notion of a
  // PORT's own upper bound, because none of its other callers (tick clamps, scheduler tunables)
  // have one. See `MAX_HTTP_PORT`'s own comment above for what reaching `serve()` unbounded does.
  if (httpPort > MAX_HTTP_PORT) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_HTTP_PORT",
      reason: "port_out_of_range",
    });
  }
  const migrationsDir = env.WAITRON_MIGRATIONS_DIR;
  const mediaDir = env.WAITRON_MEDIA_DIR;
  const databaseUrl = required(env, "DATABASE_URL");
  const migrationsDatabaseUrl = env.WAITRON_MIGRATIONS_DATABASE_URL;
  const httpHost = env.WAITRON_HTTP_HOST;
  // BOTH-or-NEITHER: a certificate with no private key cannot complete a TLS handshake, and a key
  // with no certificate has nothing to present — a half-configured pair is refused here rather than
  // silently falling back to plain HTTP, which an operator who set exactly one of the two would
  // never intend. `isUnset` (empty string == absent) is deliberate: `WAITRON_TLS_CERT_FILE=` beside
  // a real key is half-configured, the same `VAR=`-means-unset rule every other variable in this
  // file follows. The error names the MISSING variable — the one the operator still has to supply.
  const certFile = env.WAITRON_TLS_CERT_FILE;
  const keyFile = env.WAITRON_TLS_KEY_FILE;
  let tls: { certFile: string; keyFile: string } | undefined;
  if (!isUnset(certFile) && !isUnset(keyFile)) {
    tls = { certFile, keyFile };
  } else if (!isUnset(certFile) || !isUnset(keyFile)) {
    throw new AppError("server.config_invalid", {
      variable: isUnset(certFile) ? "WAITRON_TLS_CERT_FILE" : "WAITRON_TLS_KEY_FILE",
      reason: "tls_requires_cert_and_key",
    });
  }
  // Resolved once here so the return object and the production-required RP guard below read the same
  // value (rather than calling `deploymentEnvironment` three times inline). Placed AFTER the
  // DATABASE_URL and TLS checks so the boot faults still surface in this file's existing order — a bad
  // WAITRON_ENV throws `server.config_invalid` only once those two have passed, exactly as it did when
  // this was `environment: deploymentEnvironment(env)` inline in the return below.
  const environment = deploymentEnvironment(env);
  return {
    databaseUrl,
    migrationsDatabaseUrl: isUnset(migrationsDatabaseUrl) ? databaseUrl : migrationsDatabaseUrl,
    environment,
    httpPort,
    httpHost: isUnset(httpHost) ? DEFAULT_HTTP_HOST : httpHost,
    minTickMs,
    maxTickMs,
    skipRetryMs,
    settlementLagMs: optionalPositiveInt(env, "WAITRON_SETTLEMENT_LAG_MS"),
    migrationsRoot: isUnset(migrationsDir) ? defaultMigrationsRoot : migrationsDir,
    // `resolve` is applied ONLY to a genuinely-set value: an unset OR empty `WAITRON_MEDIA_DIR`
    // takes `defaultMediaRoot`, never `resolve("")` — which is cwd, the "empty value is a valid
    // value" trap (CLAUDE.md §3). Same `isUnset` fallback `migrationsRoot` above uses.
    mediaDir: isUnset(mediaDir) ? defaultMediaRoot : resolve(mediaDir),
    // Conditionally present, never present-but-undefined: an absent `tls` key is what "no TLS
    // configured" means downstream (`config.tls !== undefined` decides `secureCookies` and whether
    // `buildServeOptions` reads any files at all).
    ...(tls === undefined ? {} : { tls }),
    // The till's own fiscal identity, resolved the same way every other caller does — see
    // `till-config.ts`. Loaded AFTER `required(env, "DATABASE_URL")` above so a host missing both
    // still reports the DATABASE_URL fault first, matching this file's existing ordering.
    till: loadTillConfig(env),
    // The dashboard's passkey RP ID + origin: loopback defaults in preproduction/dev, but REQUIRED in
    // production so a real deployment can never silently bind passkeys to `localhost` (see
    // `requiredInProduction` and the `DEFAULT_MANAGEMENT_*` note). Same `isUnset` empty-string rule
    // `httpHost` above follows, applied inside the helper.
    managementRpId: requiredInProduction(
      env,
      "WAITRON_MANAGEMENT_RP_ID",
      environment,
      DEFAULT_MANAGEMENT_RP_ID,
    ),
    managementOrigin: requiredInProduction(
      env,
      "WAITRON_MANAGEMENT_ORIGIN",
      environment,
      DEFAULT_MANAGEMENT_ORIGIN,
    ),
    scheduler: {
      horizonDays: positiveInt(env, "WAITRON_SCHEDULER_HORIZON_DAYS", DEFAULTS.horizonDays),
      maxPeriodsPerTick: positiveInt(
        env,
        "WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK",
        DEFAULTS.maxPeriodsPerTick,
      ),
      maxAttempts: positiveInt(env, "WAITRON_SCHEDULER_MAX_ATTEMPTS", DEFAULTS.maxAttempts),
      backoffBaseMs: positiveInt(env, "WAITRON_SCHEDULER_BACKOFF_BASE_MS", DEFAULTS.backoffBaseMs),
      staleAfterMs: positiveInt(env, "WAITRON_SCHEDULER_STALE_AFTER_MS", DEFAULTS.staleAfterMs),
    },
  };
}

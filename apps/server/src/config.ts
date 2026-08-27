import { resolve } from "node:path";
import { AppError } from "@waitron/shared";
import { DEFAULTS } from "@waitron/scheduler";
import { tryLoadTillConfig } from "./till-config.js";
import type { TillConfig } from "./till-config.js";
import { isUnset } from "./env-value.js";
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
   * The persisted directory the box owns its self-signed cert PEMs and generated secrets under —
   * resolved to an ABSOLUTE path at load (`resolve`) exactly like `mediaDir`, so later slices (3, 4)
   * that materialise and read those files join onto a settled base, not one whose meaning shifts with
   * the process's cwd. `WAITRON_STATE_DIR` overrides the boot-computed `defaultStateRoot` threaded
   * into `loadConfig` (see `boot.ts`); an unset OR EMPTY value falls back to that default via
   * `isUnset` — never `resolve("")`, which is cwd (the "empty value is a valid value" trap,
   * CLAUDE.md §3). Deployment (#9) sets it to a durable, protected path (e.g. `/var/lib/waitron`);
   * the dev default lives beside the bundle and is gitignored, because it holds secrets.
   */
  stateDir: string;
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
   * resolved once here via `tryLoadTillConfig`. `Omit<…, "orderFlow">`: the pay-timing mode is a
   * per-LOCATION column, not an env var, so `boot.ts` reads it via `readOrderFlow` and spreads it in
   * to form the full `TillConfig` handed to the till API (see `till-config.ts`'s `orderFlow` note).
   *
   * OPTIONAL (slice 1b): an unprovisioned box has no venue, so the five `WAITRON_TILL_*_ID` are
   * absent and this is `undefined` — SETUP MODE. `tryLoadTillConfig` returns it undefined when NONE
   * of the five are set, the loaded identity when ALL are, and throws on a PARTIAL set (a
   * half-configured server is a bug, never a setup box). Boot branches on `config.till === undefined`
   * to enter setup mode, and otherwise narrows it once (an early return) before its trading-only
   * consumers. */
  till?: Omit<TillConfig, "orderFlow">;
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
  /**
   * The built `till` SPA directory this box serves at the origin root "/", or `undefined` to not
   * serve it (dev leaves it unset and uses the Vite dev server). When set, `boot.ts` mounts it as the
   * root catch-all — LAST, after every API route — so it never shadows `/api`, `/management-api`,
   * `/media`, `/health` or the sync routes. From `WAITRON_TILL_APP_DIR`; absent OR empty → undefined
   * (the `isUnset` rule every optional variable here follows), never `""` — an empty dir would make
   * boot's `join(dir, "index.html")` a relative path under cwd (the "empty value is a valid value"
   * trap, CLAUDE.md §3). Stored VERBATIM in config (not `resolve`d here): boot `existsSync`-checks it
   * and hands it to `mountSpa`, which normalises it once with `resolve` and serves every file from
   * that canonical base — so a relative or trailing-slash dir works. Deployment (#9) sets an absolute
   * path regardless.
   */
  tillAppDir?: string;
  /**
   * The built `dashboard` SPA directory this box serves at "/manage", or `undefined` to not serve it
   * (dev uses the Vite dev server). Mounted BEFORE the till root catch-all so `/manage/*` wins. From
   * `WAITRON_DASHBOARD_APP_DIR`; absent OR empty → undefined, stored verbatim — same rules as
   * `tillAppDir` above.
   */
  dashboardAppDir?: string;
  /**
   * The built `setup` wizard SPA directory this box serves at the origin root "/" while in SETUP MODE
   * (unprovisioned), or `undefined` to serve the inline placeholder shell instead (dev leaves it unset
   * and uses the Vite dev server). When set, `mountSetup` serves it as the setup surface's LAST
   * catch-all — after `/setup-api/*`, the discovery/CA/trust routes and `/health` — so it never shadows
   * them. Trading-mode only ever sees this via the `assertBuiltApp` fail-fast check; the MOUNT happens
   * only in the setup branch, so a provisioned box never serves it. From `WAITRON_SETUP_APP_DIR`; absent
   * OR empty → undefined, stored verbatim — same rules as `tillAppDir` above.
   */
  setupAppDir?: string;
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
/** The retention sweep's idle interval between prunes when WAITRON_SYNC_RETENTION_TICK_MS is unset
 * (spec §3.2). A minute is a deliberately relaxed cadence: the prune is a bounded background
 * housekeeping DELETE, not on any hot path, so it need not run tight. */
const DEFAULT_SYNC_RETENTION_TICK_MS = 60_000;
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

// `isUnset` (absent OR empty string is "unset") lives in `./env-value.js` so `config.ts` and
// `till-config.ts` share the ONE definition without an import cycle — see the note atop that module.
// `required` below reads the same rule the other way round: a variable with no usable value is
// missing, so `VAR=` is reported as missing rather than accepted as the empty string.

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
  databaseUrl: string;
  peers: SyncPeer[];
  /** The fast lane's idle interval (ms) — the tighter tick the payments lane polls at, beside the
   * ordered lane's config.minTickMs. From WAITRON_SYNC_FAST_TICK_MS, default 1000 (spec §4d). Lives on
   * the sync config because it is meaningless without sync enabled, like peers. */
  fastMinIdleMs: number;
  /** The retention sweep's idle interval (ms) between prunes — from WAITRON_SYNC_RETENTION_TICK_MS,
   * default 60000 (spec §3.2). Always present (defaulted), unlike retentionDatabaseUrl below, because
   * the sweep needs a cadence whenever it does run. */
  retentionTickMs: number;
  /** OPTIONAL: the connection string for a `sync_retention` LOGIN member — the dedicated whole-log,
   * cross-tenant role runRetentionSweep prunes `sync_log` and reports per-subscriber lag as
   * (packages/sync/drizzle/0001_sync_retention.sql; NOT app_user/sync_tailer, which cannot DELETE it).
   * Present ONLY when WAITRON_SYNC_RETENTION_DATABASE_URL is set; ABSENT (not present-but-undefined)
   * leaves the scheduled sweep OFF — sync still runs, the log just grows unpruned, which boot makes
   * loud via `sync.retention_unconfigured` (spec §3.2/§8: opt-in here, documented-required in prod). */
  retentionDatabaseUrl?: string;
  /** OPTIONAL: the lag threshold (in rows) past which the retention sweep emits the retention-variant
   * `sync.stream_stalled` for a subscriber — the operator alarm that INFORMS a manual eviction (spec
   * §3.2). From WAITRON_SYNC_LAG_ALARM_ROWS (a positive int). The alarm is OPT-IN, mirroring
   * retentionDatabaseUrl above: present ONLY when the variable is set; ABSENT (not
   * present-but-undefined) leaves the sweep prune-only — it still prunes every tick, it just never
   * alarms. A non-positive value is refused (`server.config_invalid`) — a threshold of 0/negative
   * rows is a misconfiguration, not "alarm on everything". Its default is a tuning target, not a
   * settled constant (spec §8), so there is no baked-in default: unset means the alarm is off. */
  lagAlarmRows?: number;
}

/**
 * Sync is enabled iff `WAITRON_SYNC_PEERS` is set (a non-empty JSON array of `{ nodeId, url, token }`).
 * Then the sync database URL (a LOGIN role that is a member of `app_user` AND `sync_tailer` — the
 * app-role pool cannot read `sync_log`) is required, and a blank URL or peer field fails closed (the
 * empty-value trap, CLAUDE.md §3): a blank secret must never mean "no auth". There is no shared
 * inbound node token any more: the SOURCE authenticates each peer against the `sync_peers` registry
 * (`sync-api.ts`, per-peer identity), so no shared inbound token is read here. The SUBSCRIBER
 * side is unchanged — each `WAITRON_SYNC_PEERS[].token` is the Bearer a node presents when it pulls
 * (`syncPullOnce`), now one a `waitron-sync-peer enrol` minted on the source it dials. The sync NODE
 * ID is `config.till.nodeId`, deliberately NOT a second `WAITRON_SYNC_NODE_ID` variable — two
 * variables that must agree is the drift the one-source-of-truth rule forbids (design deviation,
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
  // Parsed once here so the conditional spread below reads the same value the validation throws on:
  // undefined when unset/empty (alarm off), a positive int otherwise, throwing config_invalid for a
  // non-positive one.
  const lagAlarmRows = optionalPositiveInt(env, "WAITRON_SYNC_LAG_ALARM_ROWS");
  return {
    databaseUrl: required(env, "WAITRON_SYNC_DATABASE_URL"),
    peers,
    fastMinIdleMs: positiveInt(env, "WAITRON_SYNC_FAST_TICK_MS", DEFAULT_SYNC_FAST_TICK_MS),
    retentionTickMs: positiveInt(
      env,
      "WAITRON_SYNC_RETENTION_TICK_MS",
      DEFAULT_SYNC_RETENTION_TICK_MS,
    ),
    // The retention role is opt-in: an unset OR empty URL omits the field entirely (sweep off,
    // boot warns loud) rather than a present-but-undefined key or a broken empty connection string
    // — "an empty connection string is a valid connection string" (CLAUDE.md §3), so it must never
    // reach `createPostgresDb` as `""`.
    ...(isUnset(env.WAITRON_SYNC_RETENTION_DATABASE_URL)
      ? {}
      : { retentionDatabaseUrl: env.WAITRON_SYNC_RETENTION_DATABASE_URL }),
    // The lag alarm is opt-in too: `optionalPositiveInt` returns undefined for an unset/empty value
    // (field omitted → prune-only sweep) and THROWS `server.config_invalid` for a non-positive one, so
    // a blank never silently means "alarm on everything" and a present-but-undefined key never leaks
    // in (the same omit-when-unset shape as retentionDatabaseUrl above, CLAUDE.md §3).
    ...(lagAlarmRows === undefined ? {} : { lagAlarmRows }),
  };
}

export interface TunnelConfig {
  relayHost: string;
  relayPort: number;
  boxId: string;
  token: string;
  poolSize: number;
}

/** Standing outbound connections the box pre-dials to the relay when WAITRON_TUNNEL_POOL_SIZE is
 * unset. */
const DEFAULT_TUNNEL_POOL_SIZE = 4;

/**
 * The outbound cloud-mirror tunnel (sub-project B) is enabled iff `WAITRON_TUNNEL_RELAY_URL` is set
 * to a parseable url naming the relay's host and port. Then the box id and per-box token are
 * required, and a blank one fails closed (the same posture `loadSyncConfig` takes for a blank peer
 * field, CLAUDE.md §3): a blank token must never mean "no auth", and a blank box id names no box to
 * the relay. Absent OR empty relay url → `undefined` → no tunnel is dialed, exactly like
 * `loadSyncConfig`'s empty `WAITRON_SYNC_PEERS` off-switch, so a host that sets no tunnel env (every
 * existing boot) is unaffected. A PRESENT-but-unparseable relay url THROWS rather than silently
 * disabling the tunnel: "an empty connection string is a valid connection string" (CLAUDE.md §3) —
 * the empty value is off by returning `undefined` (never reaching a dialer as `""`), but a malformed
 * ADDRESS an operator actually supplied is a boot-time refusal, never a degenerate value handed on.
 */
export function loadTunnelConfig(env: Env): TunnelConfig | undefined {
  const rawUrl = env.WAITRON_TUNNEL_RELAY_URL;
  // Absent OR empty → tunnel off (undefined), via `isUnset` — the same off-switch `loadSyncConfig`
  // uses for an empty `WAITRON_SYNC_PEERS`. Returning undefined is how the empty value never reaches
  // a dialer as `""` (CLAUDE.md §3); a present-but-malformed url is failed closed just below.
  if (isUnset(rawUrl)) return undefined;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "not_a_url",
    });
  }
  // A url can parse yet name no host — `relay.example:9000` (no scheme) is read as scheme
  // `relay.example` + opaque path, so `.hostname` is `""`. A blank relayHost is exactly the `""` a
  // dialer must never see, so it fails closed as `not_a_url` too rather than being handed on.
  if (url.hostname === "") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "not_a_url",
    });
  }
  // A well-formed url can still fail to name a USABLE port, two ways, both yielding `relayPort: 0` —
  // the degenerate value the dialer must never see (you cannot connect to port 0): it OMITS the port
  // (`tcp://relay.example` → `.port` is `""`, `Number("")` is `0`) or it names port ZERO explicitly
  // (`tcp://relay.example:0` → `.port` is `"0"`). `Number(url.port) === 0` catches BOTH (a parsed
  // `url.port` is only ever `""` or a valid `"0".."65535"`, since `new URL` rejects an out-of-range or
  // non-numeric port), so both fail closed HERE at boot — the mirror image of the hostname guard above.
  // A dedicated `no_port` reason, not `not_a_url`: the url IS valid, it just lacks the usable port we
  // require, so "not a url" would mislead the operator (CLAUDE.md §1). Use a NON-SPECIAL scheme
  // (`tcp://`, which the mechanism expects): WHATWG `URL` strips a port equal to a SPECIAL scheme's
  // default, so `https://relay:443` parses to `.port === ""` and would be refused here — `tcp://relay:443`
  // keeps its port.
  if (Number(url.port) === 0) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "no_port",
    });
  }
  const boxId = env.WAITRON_TUNNEL_BOX_ID;
  if (isUnset(boxId)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TUNNEL_BOX_ID",
      reason: "field_blank",
    });
  }
  const token = env.WAITRON_TUNNEL_TOKEN;
  if (isUnset(token)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TUNNEL_TOKEN",
      reason: "field_blank",
    });
  }
  return {
    relayHost: url.hostname,
    relayPort: Number(url.port),
    boxId,
    token,
    poolSize: positiveInt(env, "WAITRON_TUNNEL_POOL_SIZE", DEFAULT_TUNNEL_POOL_SIZE),
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
  defaultStateRoot: string,
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
  const stateDir = env.WAITRON_STATE_DIR;
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
    // Same isUnset fallback + resolve-only-a-real-value shape mediaDir uses (CLAUDE.md §3): an unset
    // OR empty WAITRON_STATE_DIR takes `defaultStateRoot`, never `resolve("")` (which is cwd).
    stateDir: isUnset(stateDir) ? defaultStateRoot : resolve(stateDir),
    // Conditionally present, never present-but-undefined: an absent `tls` key is what "no TLS
    // configured" means downstream (`config.tls !== undefined` decides `secureCookies` and whether
    // `buildServeOptions` reads any files at all).
    ...(tls === undefined ? {} : { tls }),
    // The till's own fiscal identity, resolved the same way every other caller does — see
    // `till-config.ts`. Loaded AFTER `required(env, "DATABASE_URL")` above so a host missing both
    // still reports the DATABASE_URL fault first, matching this file's existing ordering.
    // `tryLoadTillConfig` (not `loadTillConfig`): NONE of the five ids set → undefined (setup mode),
    // ALL set → the loaded identity, a PARTIAL set → throws (a half-configured server is a bug).
    till: tryLoadTillConfig(env),
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
    // The built front-end dirs the box serves same-origin (slice 1a). Absent OR empty → undefined
    // (the same `isUnset` rule `settlementLagMs` above and every other optional here follow): dev
    // leaves them unset and uses the Vite dev servers, so `boot.ts` mounts nothing. Stored verbatim
    // — never `resolve("")`, which is cwd (the "empty value is a valid value" trap, CLAUDE.md §3);
    // boot `existsSync`-checks the dir and hands it to `mountSpa`, which normalises it once via
    // `resolve` when serving (so a relative or trailing-slash dir works).
    tillAppDir: isUnset(env.WAITRON_TILL_APP_DIR) ? undefined : env.WAITRON_TILL_APP_DIR,
    dashboardAppDir: isUnset(env.WAITRON_DASHBOARD_APP_DIR)
      ? undefined
      : env.WAITRON_DASHBOARD_APP_DIR,
    setupAppDir: isUnset(env.WAITRON_SETUP_APP_DIR) ? undefined : env.WAITRON_SETUP_APP_DIR,
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

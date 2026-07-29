import { AppError } from "@waitron/shared";
import { DEFAULTS } from "@waitron/scheduler";
import "./errors.js";

export type AeatEnvironment = "production" | "preproduction";

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
   * so migrations need a role of their own. `migrations.ts`'s `applyMigrations` is the only reader.
   */
  migrationsDatabaseUrl: string;
  aeatEnv: AeatEnvironment;
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
const DEFAULT_HTTP_PORT = 8080;
const DEFAULT_HTTP_HOST = "127.0.0.1";
/** The highest port TCP/`net.Server.listen` accepts. Without this bound, `positiveInt` alone lets
 * a value like `999999` reach `serve()` (`boot.ts`), which throws a raw, unformatted
 * `RangeError [ERR_SOCKET_BAD_PORT]` straight out of `startServer` — not the structured
 * `server.config_invalid` this file promises for every other bad input, and not what
 * `apps/server/README.md`'s "every value is validated once, at boot" line claims either. */
const MAX_HTTP_PORT = 65_535;

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

/** Exported so one-shot scripts that build their own backend resolve this the same way the host
 * does — the safe default below is not one for a caller to re-derive. */
export function aeatEnvironment(env: Env): AeatEnvironment {
  const raw = env.WAITRON_AEAT_ENV;
  // The DEFAULT is preproduction and production must be typed out. Architecture §9: production
  // numbering can never be reused, even for a test invoice, so this is the one default in the file
  // whose mistake is irreversible.
  if (isUnset(raw)) return "preproduction";
  if (raw !== "production" && raw !== "preproduction") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_AEAT_ENV",
      reason: "not_an_aeat_environment",
    });
  }
  return raw;
}

export function loadConfig(env: Env, defaultMigrationsRoot: string): ServerConfig {
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
  const databaseUrl = required(env, "DATABASE_URL");
  const migrationsDatabaseUrl = env.WAITRON_MIGRATIONS_DATABASE_URL;
  const httpHost = env.WAITRON_HTTP_HOST;
  return {
    databaseUrl,
    migrationsDatabaseUrl: isUnset(migrationsDatabaseUrl) ? databaseUrl : migrationsDatabaseUrl,
    aeatEnv: aeatEnvironment(env),
    httpPort,
    httpHost: isUnset(httpHost) ? DEFAULT_HTTP_HOST : httpHost,
    minTickMs,
    maxTickMs,
    skipRetryMs,
    settlementLagMs: optionalPositiveInt(env, "WAITRON_SETTLEMENT_LAG_MS"),
    migrationsRoot: isUnset(migrationsDir) ? defaultMigrationsRoot : migrationsDir,
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

import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { DEFAULTS } from "@waitron/scheduler";
import { isAppError } from "@waitron/shared";
import { deploymentEnvironment, loadConfig } from "./config.js";

// Distinct per field so a mis-wired till mapping fails the assertions below rather than passing by
// coincidence — every id is the same 8-4-4-4-12 shape but a different value, matching
// till-config.test.ts's own convention.
const TILL_ENV = {
  WAITRON_TILL_TENANT_ID: "11111111-1111-4111-8111-111111111111",
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// `loadConfig` now resolves the till identity via `loadTillConfig`, so the till vars are required for
// a successful load. Every happy-path case here spreads them; the `requires DATABASE_URL` case does
// NOT, deliberately, because that guard fires before the till is ever read (see the test).
const MIN_ENV = { DATABASE_URL: "postgres://u@h/d", ...TILL_ENV };
const ROOT = "/opt/waitron/drizzle";

const EXPECTED_TILL = {
  tenantId: TILL_ENV.WAITRON_TILL_TENANT_ID,
  tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
  nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
  seriesId: TILL_ENV.WAITRON_TILL_SERIES_ID,
  locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
  locale: "es-ES",
  invoiceLocales: ["es-ES"],
};

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loadConfig", () => {
  it("defaults every optional value, and defaults the deployment environment to preproduction", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config).toEqual({
      databaseUrl: "postgres://u@h/d",
      // Defaults to DATABASE_URL — same variable, same role — so a deployment that never sets
      // WAITRON_MIGRATIONS_DATABASE_URL keeps a single connection string for both jobs, matching
      // this package's behaviour before the split.
      migrationsDatabaseUrl: "postgres://u@h/d",
      // Production numbering can never be reused, so the safe environment is the default and
      // production must be typed out. This assertion is the guard on that.
      environment: "preproduction",
      httpPort: 8080,
      // /health is unauthenticated (spec §9); loopback-only is the safe default.
      httpHost: "127.0.0.1",
      minTickMs: 5_000,
      maxTickMs: 3_600_000,
      // ONE value for both `drain` and `runDue` — see the field's own doc comment in config.ts.
      // Asserted against the scheduler's own DEFAULTS rather than a hardcoded literal: this default
      // IS the scheduler's default, not a copy of it that happens to agree today.
      skipRetryMs: DEFAULTS.skipRetryMs,
      settlementLagMs: undefined,
      migrationsRoot: ROOT,
      // No WAITRON_TLS_* set, so the whole optional block is absent — not present-but-undefined.
      // `tls` is omitted from the returned object entirely (see loadConfig's conditional spread).
      till: EXPECTED_TILL,
      scheduler: {
        horizonDays: 30,
        maxPeriodsPerTick: 7,
        maxAttempts: 3,
        backoffBaseMs: 900_000,
        staleAfterMs: 3_600_000,
      },
    });
  });

  it("populates config.till from the WAITRON_TILL_* environment (the till's fiscal identity)", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config.till).toEqual(EXPECTED_TILL);
  });

  it("surfaces config.tls when BOTH cert and key files are set", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_TLS_CERT_FILE: "/etc/waitron/tls/cert.pem",
        WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem",
      },
      ROOT,
    );
    expect(config.tls).toEqual({
      certFile: "/etc/waitron/tls/cert.pem",
      keyFile: "/etc/waitron/tls/key.pem",
    });
  });

  it("leaves config.tls undefined when NEITHER cert nor key is set (plain HTTP loopback dev)", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config.tls).toBeUndefined();
  });

  // Both-or-neither: TLS with only the cert (no private key) cannot serve HTTPS, and only the key
  // (no certificate) is equally unusable — a half-configured pair is a boot-time refusal, not a
  // silent fall back to plain HTTP that an operator who set one variable would never expect.
  it.each([
    // Cert set, key missing -> the error names the MISSING variable, the one the operator must add.
    [{ WAITRON_TLS_CERT_FILE: "/etc/waitron/tls/cert.pem" }, "WAITRON_TLS_KEY_FILE"],
    // Key set, cert missing -> symmetric.
    [{ WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem" }, "WAITRON_TLS_CERT_FILE"],
  ])("rejects a half-configured TLS pair, naming the missing %o", async (extra, missing) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, ...extra }, ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: missing,
      reason: "tls_requires_cert_and_key",
    });
  });

  // Empty string is unset (config.ts's own `isUnset`), so `WAITRON_TLS_CERT_FILE=` alongside a real
  // key is still a half-configured pair, not a both-set one — the same `VAR=`-means-unset rule the
  // rest of the file applies.
  it("treats an empty WAITRON_TLS_CERT_FILE as unset, so a real key beside it is still half-configured", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          {
            ...MIN_ENV,
            WAITRON_TLS_CERT_FILE: "",
            WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem",
          },
          ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TLS_CERT_FILE",
      reason: "tls_requires_cert_and_key",
    });
  });

  it("requires DATABASE_URL", async () => {
    const error = await captureError(() => Promise.resolve(loadConfig({}, ROOT)));
    expect(codeOf(error)).toBe("server.config_missing");
    expect(isAppError(error) && error.params).toMatchObject({ variable: "DATABASE_URL" });
  });

  it("reads every override", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_MIGRATIONS_DATABASE_URL: "postgres://migrator@h/d",
        WAITRON_ENV: "production",
        WAITRON_HTTP_PORT: "9000",
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "90000",
        WAITRON_SKIP_RETRY_MS: "60000",
        WAITRON_SETTLEMENT_LAG_MS: "172800000",
        WAITRON_MIGRATIONS_DIR: "/srv/migrations",
        WAITRON_SCHEDULER_HORIZON_DAYS: "14",
        WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "3",
        WAITRON_SCHEDULER_MAX_ATTEMPTS: "5",
        WAITRON_SCHEDULER_BACKOFF_BASE_MS: "1000",
        WAITRON_SCHEDULER_STALE_AFTER_MS: "2000",
      },
      ROOT,
    );
    expect(config.migrationsDatabaseUrl).toBe("postgres://migrator@h/d");
    expect(config.environment).toBe("production");
    expect(config.httpPort).toBe(9000);
    expect(config.httpHost).toBe("0.0.0.0");
    expect(config.minTickMs).toBe(1000);
    expect(config.maxTickMs).toBe(90_000);
    expect(config.skipRetryMs).toBe(60_000);
    expect(config.settlementLagMs).toBe(172_800_000);
    expect(config.migrationsRoot).toBe("/srv/migrations");
    expect(config.scheduler).toEqual({
      horizonDays: 14,
      maxPeriodsPerTick: 3,
      maxAttempts: 5,
      backoffBaseMs: 1000,
      staleAfterMs: 2000,
    });
  });

  it("falls back to DATABASE_URL when WAITRON_MIGRATIONS_DATABASE_URL is set but empty", () => {
    // Mirrors WAITRON_MIGRATIONS_DIR's own empty-string-means-unset treatment elsewhere in this
    // file: an operator's deploy tooling that always sets the variable, empty when unused, must
    // not be forced to omit it entirely to get the default.
    const config = loadConfig({ ...MIN_ENV, WAITRON_MIGRATIONS_DATABASE_URL: "" }, ROOT);
    expect(config.migrationsDatabaseUrl).toBe(config.databaseUrl);
  });

  it("accepts the highest real TCP port, 65535 — the boundary the rejection test just above it lives one past", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_HTTP_PORT: "65535" }, ROOT);
    expect(config.httpPort).toBe(65_535);
  });

  it.each([
    ["WAITRON_ENV", "sandbox", "not_a_deployment_environment"],
    ["WAITRON_HTTP_PORT", "http", "not_a_positive_integer"],
    ["WAITRON_HTTP_PORT", "0", "not_a_positive_integer"],
    // Item 13 of the 2026-07-27 pre-merge review: `positiveInt` alone accepts any positive
    // integer, including one no real TCP port can ever be — `serve()` (`boot.ts`) would otherwise
    // throw a raw `RangeError [ERR_SOCKET_BAD_PORT]` instead of this file's own promised
    // `server.config_invalid`. 65536 is the first value past the real ceiling (65535).
    ["WAITRON_HTTP_PORT", "65536", "port_out_of_range"],
    ["WAITRON_MIN_TICK_MS", "-1", "not_a_positive_integer"],
    ["WAITRON_SKIP_RETRY_MS", "nope", "not_a_positive_integer"],
    ["WAITRON_SCHEDULER_MAX_ATTEMPTS", "1.5", "not_a_positive_integer"],
  ])("rejects %s=%s", async (variable, value, reason) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, [variable]: value }, ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // The variable NAME and a reason CODE — never the value, which is arbitrary operator input and
    // could be a mistyped secret.
    expect(isAppError(error) && error.params).toEqual({ variable, reason });
  });

  it("rejects a minTick above maxTick, which would make the clamp unsatisfiable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_MAX_TICK_MS: "5000" }, ROOT),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // Both variables and both effective values, not just the one the guard happens to key off (F6
    // of the 2026-07-27 pre-merge review): an operator staring at this error must be able to tell
    // which of the two they actually set, whichever one that was.
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MIN_TICK_MS",
      value: 10_000,
      otherVariable: "WAITRON_MAX_TICK_MS",
      otherValue: 5_000,
      reason: "above_max_tick",
    });
  });

  it("rejects a skipRetryMs below minTickMs, which sleepMsFor's clamp would otherwise silently round back up to the floor", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_SKIP_RETRY_MS: "9999" },
          ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // F6: an operator who set only WAITRON_MIN_TICK_MS must still see it named — not just
    // WAITRON_SKIP_RETRY_MS, which here is the untouched default.
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_SKIP_RETRY_MS",
      value: 9_999,
      otherVariable: "WAITRON_MIN_TICK_MS",
      otherValue: 10_000,
      reason: "below_min_tick",
    });
  });

  it("accepts a skipRetryMs exactly equal to minTickMs — the boundary the rejection above lives one below", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_SKIP_RETRY_MS: "10000" },
      ROOT,
    );
    expect(config.minTickMs).toBe(10_000);
    expect(config.skipRetryMs).toBe(10_000);
  });

  it("boots with the shipped defaults (skipRetryMs 300000, minTickMs 5000) — the new guard must not reject them", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config.minTickMs).toBe(5_000);
    expect(config.skipRetryMs).toBe(DEFAULTS.skipRetryMs);
  });

  // F1 of the 2026-07-27 pre-merge review: `WAITRON_MAX_TICK_MS` alone silently capped
  // `WAITRON_SKIP_RETRY_MS` — `sleepMsFor`'s `Math.min(maxTickMs, …)` would round a too-high
  // configured interval back DOWN, below `minTickMs` in the concrete case (operator sets only
  // `WAITRON_MAX_TICK_MS=5000`, `minTickMs` and `skipRetryMs` both default to their shipped
  // values), silently restoring the 5-second-forever spin this whole design exists to remove, with
  // every OTHER guard in this file passing. This guard closes that gap symmetrically with the
  // below-the-floor one above.
  it("rejects a skipRetryMs above maxTickMs, which sleepMsFor's clamp would otherwise silently round back down past the floor", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MAX_TICK_MS: "5000", WAITRON_SKIP_RETRY_MS: "300000" },
          ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // Same reason string the minTickMs > maxTickMs guard already uses — not a near-synonym — and
    // the same both-variables-both-values shape as the other two tick-cadence guards.
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_SKIP_RETRY_MS",
      value: 300_000,
      otherVariable: "WAITRON_MAX_TICK_MS",
      otherValue: 5_000,
      reason: "above_max_tick",
    });
  });

  it("accepts a skipRetryMs exactly equal to maxTickMs — the boundary the rejection above lives one above", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MAX_TICK_MS: "300000", WAITRON_SKIP_RETRY_MS: "300000" },
      ROOT,
    );
    expect(config.maxTickMs).toBe(300_000);
    expect(config.skipRetryMs).toBe(300_000);
  });

  it("accepts a skipRetryMs comfortably below maxTickMs", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MAX_TICK_MS: "120000", WAITRON_SKIP_RETRY_MS: "60000" },
      ROOT,
    );
    expect(config.maxTickMs).toBe(120_000);
    expect(config.skipRetryMs).toBe(60_000);
  });
});

describe("deploymentEnvironment", () => {
  it("defaults to preproduction when unset, so production is never reached by omission", () => {
    expect(deploymentEnvironment({})).toBe("preproduction");
    expect(deploymentEnvironment({ WAITRON_ENV: "" })).toBe("preproduction");
  });

  it("refuses a value that is neither environment, naming the variable", async () => {
    // `Promise.resolve(...)`, not a bare arrow returning `deploymentEnvironment(...)` directly:
    // `deploymentEnvironment` throws synchronously rather than returning a rejected promise, and
    // `captureError` is typed `() => Promise<unknown>` — the same wrapping every other
    // synchronous-throw case in this file already uses (see `loadConfig`'s callers above).
    const error = await captureError(() =>
      Promise.resolve(deploymentEnvironment({ WAITRON_ENV: "staging" })),
    );
    expect(error).toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_ENV", reason: "not_a_deployment_environment" },
    });
  });
});

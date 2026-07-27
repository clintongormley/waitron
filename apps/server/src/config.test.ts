import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { isAppError } from "@waitron/shared";
import { loadConfig } from "./config.js";

const MIN_ENV = { DATABASE_URL: "postgres://u@h/d" };
const ROOT = "/opt/waitron/drizzle";

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loadConfig", () => {
  it("defaults every optional value, and defaults AEAT to preproduction", () => {
    const config = loadConfig(MIN_ENV, ROOT);
    expect(config).toEqual({
      databaseUrl: "postgres://u@h/d",
      // Defaults to DATABASE_URL — same variable, same role — so a deployment that never sets
      // WAITRON_MIGRATIONS_DATABASE_URL keeps a single connection string for both jobs, matching
      // this package's behaviour before the split.
      migrationsDatabaseUrl: "postgres://u@h/d",
      // Production numbering can never be reused, so the safe environment is the default and
      // production must be typed out. This assertion is the guard on that.
      aeatEnv: "preproduction",
      httpPort: 8080,
      // /health is unauthenticated (spec §9); loopback-only is the safe default.
      httpHost: "127.0.0.1",
      minTickMs: 5_000,
      maxTickMs: 3_600_000,
      settlementLagMs: undefined,
      migrationsRoot: ROOT,
      scheduler: {
        horizonDays: 30,
        maxPeriodsPerTick: 7,
        maxAttempts: 3,
        backoffBaseMs: 900_000,
        staleAfterMs: 3_600_000,
      },
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
        WAITRON_AEAT_ENV: "production",
        WAITRON_HTTP_PORT: "9000",
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "60000",
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
    expect(config.aeatEnv).toBe("production");
    expect(config.httpPort).toBe(9000);
    expect(config.httpHost).toBe("0.0.0.0");
    expect(config.minTickMs).toBe(1000);
    expect(config.maxTickMs).toBe(60_000);
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
    ["WAITRON_AEAT_ENV", "sandbox", "not_an_aeat_environment"],
    ["WAITRON_HTTP_PORT", "http", "not_a_positive_integer"],
    ["WAITRON_HTTP_PORT", "0", "not_a_positive_integer"],
    // Item 13 of the 2026-07-27 pre-merge review: `positiveInt` alone accepts any positive
    // integer, including one no real TCP port can ever be — `serve()` (`boot.ts`) would otherwise
    // throw a raw `RangeError [ERR_SOCKET_BAD_PORT]` instead of this file's own promised
    // `server.config_invalid`. 65536 is the first value past the real ceiling (65535).
    ["WAITRON_HTTP_PORT", "65536", "port_out_of_range"],
    ["WAITRON_MIN_TICK_MS", "-1", "not_a_positive_integer"],
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
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MIN_TICK_MS",
      reason: "above_max_tick",
    });
  });
});

import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { DEFAULTS } from "@waitron/scheduler";
import { isAppError } from "@waitron/shared";
import { deploymentEnvironment, isDevMode, loadConfig, loadTunnelConfig } from "./config.js";

// Distinct per field so a mis-wired till mapping fails rather than passing by coincidence.
const TILL_ENV = {
  WAITRON_TILL_TILL_ID: "22222222-2222-4222-8222-222222222222",
  WAITRON_TILL_NODE_ID: "33333333-3333-4333-8333-333333333333",
  WAITRON_TILL_SERIES_ID: "44444444-4444-4444-8444-444444444444",
  WAITRON_TILL_LOCATION_ID: "55555555-5555-4555-8555-555555555555",
};

// A load with none of these set is setup mode, not a failure.
const MIN_ENV = { ...TILL_ENV };
const ROOT = "/opt/waitron/drizzle";
// A distinct protected state root exposes accidental migrations-root or cwd fallback.
const STATE_ROOT = "/opt/waitron/state";

const EXPECTED_TILL = {
  tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
  nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
  seriesId: TILL_ENV.WAITRON_TILL_SERIES_ID,
  locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
  locale: "es-ES",
  invoiceLocales: ["es-ES"],
  // No card fields: `toEqual` fails if one is materialised.
  tipsEnabled: false,
};

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loadConfig", () => {
  it("defaults every optional value, and defaults the deployment environment to preproduction", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config).toEqual({
      // Production numbering can never be reused, so production must be typed out.
      environment: "preproduction",
      // `true` only for the literal WAITRON_ENV=dev.
      devMode: false,
      onboardingIntent: undefined,
      fiscalTestSubmissions: false,
      paymentTestProviders: false,
      httpPort: 8080,
      landingPort: 80,
      // /health is unauthenticated, so loopback-only is the default.
      httpHost: "127.0.0.1",
      minTickMs: 5_000,
      maxTickMs: 3_600_000,
      // The scheduler's own default, not a copy that happens to agree.
      skipRetryMs: DEFAULTS.skipRetryMs,
      settlementLagMs: undefined,
      migrationsRoot: ROOT,
      litestreamBin: "litestream",
      // Unset state storage uses the boot-provided default, not cwd.
      stateDir: STATE_ROOT,
      venueDir: resolve(STATE_ROOT, "venue"),
      logDir: resolve(STATE_ROOT, "logs"),
      logMaxBytes: 10_000_000,
      logMaxFiles: 5,
      // `tls` is absent from the object, not present-but-undefined.
      till: EXPECTED_TILL,
      managementRpId: "localhost",
      managementOrigin: "http://localhost:5191",
      advertisedOrigin: "http://localhost:5191",
      tenantDomain: undefined,
      // No SPA is served: dev uses the Vite dev servers.
      tillAppDir: undefined,
      dashboardAppDir: undefined,
      setupAppDir: undefined,
      scheduler: {
        horizonDays: 30,
        maxPeriodsPerTick: 7,
        maxAttempts: 3,
        backoffBaseMs: 900_000,
        staleAfterMs: 3_600_000,
      },
    });
  });

  it("takes the Litestream binary from WAITRON_LITESTREAM_BIN, and an empty value as unset", () => {
    const cfg = (env: Record<string, string>) => loadConfig(env, ROOT, STATE_ROOT);
    expect(cfg({ ...MIN_ENV, WAITRON_LITESTREAM_BIN: "/opt/litestream" }).litestreamBin).toBe(
      "/opt/litestream",
    );
    expect(cfg({ ...MIN_ENV, WAITRON_LITESTREAM_BIN: "" }).litestreamBin).toBe("litestream");
  });

  it("landingPort defaults to 80 and 0 disables it", () => {
    const cfg = (env: Record<string, string>) => loadConfig(env, ROOT, STATE_ROOT);
    expect(cfg({ ...MIN_ENV }).landingPort).toBe(80);
    expect(cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "0" }).landingPort).toBe(0);
    expect(cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "8081" }).landingPort).toBe(8081);
  });

  it("rejects a WAITRON_HTTP_LANDING_PORT outside 0..65535", () => {
    const cfg = (env: Record<string, string>) => loadConfig(env, ROOT, STATE_ROOT);
    // 0 is the only non-positive value accepted; it means disabled.
    expect(() => cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "70000" })).toThrow();
    expect(() => cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "-1" })).toThrow();
    expect(() => cfg({ ...MIN_ENV, WAITRON_HTTP_LANDING_PORT: "notaport" })).toThrow();
  });

  it("populates config.till from the WAITRON_TILL_* environment (the till's fiscal identity)", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.till).toEqual(EXPECTED_TILL);
  });

  // Setup mode: an unprovisioned box has no till identity, and loading does not throw.
  it("leaves config.till undefined when the four WAITRON_TILL_*_ID are absent, else populates it", () => {
    const setup = loadConfig({}, ROOT, STATE_ROOT);
    expect(setup.till).toBeUndefined();

    const provisioned = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(provisioned.till).toEqual(EXPECTED_TILL);
  });

  it("surfaces config.tls when BOTH cert and key files are set", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_TLS_CERT_FILE: "/etc/waitron/tls/cert.pem",
        WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.tls).toEqual({
      certFile: "/etc/waitron/tls/cert.pem",
      keyFile: "/etc/waitron/tls/key.pem",
    });
  });

  it("leaves config.tls undefined when NEITHER cert nor key is set (plain HTTP loopback dev)", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.tls).toBeUndefined();
  });

  // A half-configured pair is refused at boot, never a silent fall back to plain HTTP.
  it.each([
    // [missing var, the other var supplied]; `missing` is first so the `%s` title prints it.
    ["WAITRON_TLS_KEY_FILE", { WAITRON_TLS_CERT_FILE: "/etc/waitron/tls/cert.pem" }],
    ["WAITRON_TLS_CERT_FILE", { WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem" }],
  ])("rejects a half-configured TLS pair, naming the missing %s", async (missing, extra) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, ...extra }, ROOT, STATE_ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: missing,
      reason: "tls_requires_cert_and_key",
    });
  });

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
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TLS_CERT_FILE",
      reason: "tls_requires_cert_and_key",
    });
  });

  it("reads every override", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_ENV: "production",
        WAITRON_HTTP_PORT: "9000",
        WAITRON_HTTP_HOST: "0.0.0.0",
        WAITRON_MIN_TICK_MS: "1000",
        WAITRON_MAX_TICK_MS: "90000",
        WAITRON_SKIP_RETRY_MS: "60000",
        WAITRON_SETTLEMENT_LAG_MS: "172800000",
        WAITRON_MIGRATIONS_DIR: "/srv/migrations",
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
        WAITRON_SCHEDULER_HORIZON_DAYS: "14",
        WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "3",
        WAITRON_SCHEDULER_MAX_ATTEMPTS: "5",
        WAITRON_SCHEDULER_BACKOFF_BASE_MS: "1000",
        WAITRON_SCHEDULER_STALE_AFTER_MS: "2000",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.environment).toBe("production");
    expect(config.httpPort).toBe(9000);
    expect(config.httpHost).toBe("0.0.0.0");
    expect(config.minTickMs).toBe(1000);
    expect(config.maxTickMs).toBe(90_000);
    expect(config.skipRetryMs).toBe(60_000);
    expect(config.settlementLagMs).toBe(172_800_000);
    expect(config.migrationsRoot).toBe("/srv/migrations");
    expect(config.managementRpId).toBe("dashboard.example.com");
    expect(config.managementOrigin).toBe("https://dashboard.example.com");
    expect(config.scheduler).toEqual({
      horizonDays: 14,
      maxPeriodsPerTick: 3,
      maxAttempts: 5,
      backoffBaseMs: 1000,
      staleAfterMs: 2000,
    });
  });

  it("refuses an HTTP management origin in production", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          {
            ...MIN_ENV,
            WAITRON_ENV: "production",
            WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
            WAITRON_MANAGEMENT_ORIGIN: "http://dashboard.example.com",
          },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MANAGEMENT_ORIGIN",
      reason: "https_required",
    });
  });

  it("derives the Google callback from the configured management origin", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
        WAITRON_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
        WAITRON_GOOGLE_CLIENT_SECRET: "secret",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.googleOidc).toEqual({
      clientId: "client.apps.googleusercontent.com",
      clientSecret: "secret",
      redirectUri: "https://dashboard.example.com/management-api/google/callback",
    });
  });

  it("accepts an absolute privacy notice URL for account surfaces", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_PRIVACY_NOTICE_URL: "https://restaurant.example/privacy" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.privacyNoticeUrl).toBe("https://restaurant.example/privacy");
  });

  it("refuses a partial Google login configuration", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com" },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_GOOGLE_CLIENT_SECRET",
      reason: "google_requires_client_id_and_secret",
    });
  });

  it("refuses a Google client secret configured without its client id, naming the id", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_GOOGLE_CLIENT_SECRET: "secret" }, ROOT, STATE_ROOT),
      ),
    );
    expect(isAppError(error) && error.code).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_GOOGLE_CLIENT_ID",
      reason: "google_requires_client_id_and_secret",
    });
  });

  it.each(["restaurant.example/privacy", "ftp://restaurant.example/privacy", "mailto:dpo@x.test"])(
    "refuses the privacy notice address %j, which is not an http(s) URL",
    async (url) => {
      const error = await captureError(() =>
        Promise.resolve(
          loadConfig({ ...MIN_ENV, WAITRON_PRIVACY_NOTICE_URL: url }, ROOT, STATE_ROOT),
        ),
      );
      expect(isAppError(error) && error.code).toBe("server.config_invalid");
      expect(isAppError(error) && error.params).toEqual({
        variable: "WAITRON_PRIVACY_NOTICE_URL",
        reason: "not_an_http_url",
      });
    },
  );

  it("accepts a plain http privacy notice URL", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_PRIVACY_NOTICE_URL: "http://restaurant.example/privacy" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.privacyNoticeUrl).toBe("http://restaurant.example/privacy");
  });

  // In production the loopback defaults would bind every passkey ceremony to `localhost`, failing
  // at sign-in rather than at boot.
  it.each([
    // [missing var, the other var supplied]; `missing` is first so the `%s` title prints it.
    ["WAITRON_MANAGEMENT_RP_ID", { WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com" }],
    ["WAITRON_MANAGEMENT_ORIGIN", { WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com" }],
  ])(
    "requires the passkey RP config in production, naming the missing %s",
    async (missing, extra) => {
      const error = await captureError(() =>
        Promise.resolve(
          loadConfig({ ...MIN_ENV, WAITRON_ENV: "production", ...extra }, ROOT, STATE_ROOT),
        ),
      );
      expect(codeOf(error)).toBe("server.config_missing");
      expect(isAppError(error) && error.params).toEqual({ variable: missing });
    },
  );

  it("treats an empty production WAITRON_MANAGEMENT_RP_ID as missing", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          {
            ...MIN_ENV,
            WAITRON_ENV: "production",
            WAITRON_MANAGEMENT_RP_ID: "",
            WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
          },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_missing");
    expect(isAppError(error) && error.params).toEqual({ variable: "WAITRON_MANAGEMENT_RP_ID" });
  });

  it("honours WAITRON_MANAGEMENT_RP_ID/ORIGIN in preproduction when they are set", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_MANAGEMENT_RP_ID: "staging.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://staging.example.com",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.environment).toBe("preproduction");
    expect(config.managementRpId).toBe("staging.example.com");
    expect(config.managementOrigin).toBe("https://staging.example.com");
  });

  // The management origin is deliberately NOT the loopback default, so "fell back to
  // managementOrigin" and "took DEFAULT_MANAGEMENT_ORIGIN" cannot print the same value.
  it("defaults advertisedOrigin to managementOrigin when WAITRON_ADVERTISED_ORIGIN is unset or empty", () => {
    const managed = { ...MIN_ENV, WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com" };
    const unset = loadConfig(managed, ROOT, STATE_ROOT);
    expect(unset.advertisedOrigin).toBe("https://dashboard.example.com");
    const empty = loadConfig({ ...managed, WAITRON_ADVERTISED_ORIGIN: "" }, ROOT, STATE_ROOT);
    expect(empty.advertisedOrigin).toBe("https://dashboard.example.com");
  });

  it("honours a configured bare WAITRON_ADVERTISED_ORIGIN", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_ADVERTISED_ORIGIN: "https://box.deli.waitron.app" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.advertisedOrigin).toBe("https://box.deli.waitron.app");
  });

  // Lower-cased for the case-insensitive host comparison `cookieDomainFor` makes.
  it("reads WAITRON_TENANT_DOMAIN into config.tenantDomain (lower-cased), else undefined", () => {
    expect(loadConfig(MIN_ENV, ROOT, STATE_ROOT).tenantDomain).toBeUndefined();
    expect(
      loadConfig({ ...MIN_ENV, WAITRON_TENANT_DOMAIN: "Deli.Waitron.App" }, ROOT, STATE_ROOT)
        .tenantDomain,
    ).toBe("deli.waitron.app");
    // Empty is unset: host-only, never a blank `Domain` on the Set-Cookie.
    expect(
      loadConfig({ ...MIN_ENV, WAITRON_TENANT_DOMAIN: "" }, ROOT, STATE_ROOT).tenantDomain,
    ).toBeUndefined();
  });

  it.each([
    "https://deli.waitron.app",
    "deli.waitron.app:8443",
    "deli.waitron.app/till",
    "deli waitron app",
  ])("refuses WAITRON_TENANT_DOMAIN=%s, which is not a bare domain", async (bad) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, WAITRON_TENANT_DOMAIN: bad }, ROOT, STATE_ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TENANT_DOMAIN",
      reason: "not_a_domain",
    });
  });

  it.each([
    // No scheme at all: `new URL` cannot parse it.
    "box.deli.waitron.app",
    // Parses, as the scheme `box.deli.waitron.app:` whose origin is "null"; refused by the
    // origin comparison, not the parse.
    "box.deli.waitron.app:8443",
    // A path: the parsed origin drops it, so it differs from the input.
    "https://box.deli.waitron.app/till",
    // A trailing slash is a path (`/`).
    "https://box.deli.waitron.app/",
    // Round-trips byte-for-byte, so only the explicit http(s) check refuses it.
    "ws://box.deli.waitron.app",
    // Not a URL in any reading.
    "not a url",
  ])("refuses WAITRON_ADVERTISED_ORIGIN=%s, which is not a bare origin", async (bad) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, WAITRON_ADVERTISED_ORIGIN: bad }, ROOT, STATE_ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_ADVERTISED_ORIGIN",
      reason: "not_an_origin",
    });
  });

  // WebAuthn compares a ceremony's `Origin` header to it byte-for-byte, so it is validated under
  // its own name whether or not the fallback is taken.
  it("refuses a WAITRON_MANAGEMENT_ORIGIN that is not a bare origin, naming that variable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com/" },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MANAGEMENT_ORIGIN",
      reason: "not_an_origin",
    });
  });

  it("refuses a malformed WAITRON_MANAGEMENT_ORIGIN even when WAITRON_ADVERTISED_ORIGIN is set and bare", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          {
            ...MIN_ENV,
            WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com/",
            WAITRON_ADVERTISED_ORIGIN: "https://box.deli.waitron.app",
          },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_MANAGEMENT_ORIGIN",
      reason: "not_an_origin",
    });
  });

  it("accepts the highest real TCP port, 65535 — the boundary the rejection test just above it lives one past", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_HTTP_PORT: "65535" }, ROOT, STATE_ROOT);
    expect(config.httpPort).toBe(65_535);
  });

  it.each([
    ["WAITRON_ENV", "sandbox", "not_a_deployment_environment"],
    ["WAITRON_HTTP_PORT", "http", "not_a_positive_integer"],
    ["WAITRON_HTTP_PORT", "0", "not_a_positive_integer"],
    // Otherwise `serve()` throws a raw `RangeError [ERR_SOCKET_BAD_PORT]`.
    ["WAITRON_HTTP_PORT", "65536", "port_out_of_range"],
    ["WAITRON_MIN_TICK_MS", "-1", "not_a_positive_integer"],
    ["WAITRON_SKIP_RETRY_MS", "nope", "not_a_positive_integer"],
    ["WAITRON_SCHEDULER_MAX_ATTEMPTS", "1.5", "not_a_positive_integer"],
  ])("rejects %s=%s", async (variable, value, reason) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, [variable]: value }, ROOT, STATE_ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // Never the value, which could be a mistyped secret.
    expect(isAppError(error) && error.params).toEqual({ variable, reason });
  });

  it("rejects a minTick above maxTick, which would make the clamp unsatisfiable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_MAX_TICK_MS: "5000" },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // Both variables and both values, so an operator can tell which of the two they set.
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
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // An operator who set only WAITRON_MIN_TICK_MS must still see it named.
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
      STATE_ROOT,
    );
    expect(config.minTickMs).toBe(10_000);
    expect(config.skipRetryMs).toBe(10_000);
  });

  it("boots with the shipped defaults (skipRetryMs 300000, minTickMs 5000) — the new guard must not reject them", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.minTickMs).toBe(5_000);
    expect(config.skipRetryMs).toBe(DEFAULTS.skipRetryMs);
  });

  it("rejects a skipRetryMs above maxTickMs, which sleepMsFor's clamp would otherwise silently round back down past the floor", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MAX_TICK_MS: "5000", WAITRON_SKIP_RETRY_MS: "300000" },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
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
      STATE_ROOT,
    );
    expect(config.maxTickMs).toBe(300_000);
    expect(config.skipRetryMs).toBe(300_000);
  });

  it("accepts a skipRetryMs comfortably below maxTickMs", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MAX_TICK_MS: "120000", WAITRON_SKIP_RETRY_MS: "60000" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.maxTickMs).toBe(120_000);
    expect(config.skipRetryMs).toBe(60_000);
  });

  it("defaults stateDir to the supplied default root when WAITRON_STATE_DIR is unset", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.stateDir).toBe(STATE_ROOT);
  });

  it("resolves WAITRON_STATE_DIR to an absolute path when set", () => {
    // The box writes its certificates and secrets under stateDir, so it must not shift with cwd.
    const config = loadConfig({ ...MIN_ENV, WAITRON_STATE_DIR: "some/state" }, ROOT, STATE_ROOT);
    expect(config.stateDir).toBe(resolve("some/state"));
    expect(isAbsolute(config.stateDir)).toBe(true);
  });

  // `resolve("")` is cwd, which would put the box's secrets wherever the process started.
  it("treats an empty WAITRON_STATE_DIR as unset, falling back to the default — never resolve('') / cwd", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_STATE_DIR: "" }, ROOT, STATE_ROOT);
    expect(config.stateDir).toBe(STATE_ROOT);
    expect(config.stateDir).not.toBe(resolve(""));
    expect(config.stateDir).not.toBe(process.cwd());
  });

  it("defaults logDir to join(stateDir, 'logs') and the rotation knobs to 10MB / 5 files", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.logDir).toBe(resolve(STATE_ROOT, "logs"));
    expect(config.logMaxBytes).toBe(10_000_000);
    expect(config.logMaxFiles).toBe(5);
  });

  it("derives the default logDir from a WAITRON_STATE_DIR override, not the boot default root", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_STATE_DIR: "/var/lib/waitron" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.logDir).toBe(resolve("/var/lib/waitron", "logs"));
  });

  it("reads WAITRON_LOG_DIR / WAITRON_LOG_MAX_BYTES / WAITRON_LOG_MAX_FILES overrides when set", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_LOG_DIR: "/srv/logs",
        WAITRON_LOG_MAX_BYTES: "2000000",
        WAITRON_LOG_MAX_FILES: "3",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.logDir).toBe("/srv/logs");
    expect(config.logMaxBytes).toBe(2_000_000);
    expect(config.logMaxFiles).toBe(3);
  });

  // Never `resolve("")`, which is cwd.
  it("treats an empty WAITRON_LOG_DIR as unset, falling back to join(stateDir, 'logs')", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_LOG_DIR: "" }, ROOT, STATE_ROOT);
    expect(config.logDir).toBe(resolve(STATE_ROOT, "logs"));
    expect(config.logDir).not.toBe(resolve(""));
    expect(config.logDir).not.toBe(process.cwd());
  });

  it("defaults venueDir to join(stateDir, 'venue')", () => {
    const config = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(config.venueDir).toBe(resolve(STATE_ROOT, "venue"));
  });

  it("derives the default venueDir from a WAITRON_STATE_DIR override, not the boot default root", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_STATE_DIR: "/var/lib/waitron" },
      ROOT,
      STATE_ROOT,
    );
    expect(config.venueDir).toBe(resolve("/var/lib/waitron", "venue"));
  });

  // The database files are opened by path, so a relative value must not shift with cwd.
  it("resolves a WAITRON_VENUE_DIR override to an absolute path", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_VENUE_DIR: "some/venue" }, ROOT, STATE_ROOT);
    expect(config.venueDir).toBe(resolve("some/venue"));
    expect(isAbsolute(config.venueDir)).toBe(true);
  });

  // Never `resolve("")`, which is cwd.
  it("treats an empty WAITRON_VENUE_DIR as unset, falling back to join(stateDir, 'venue')", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_VENUE_DIR: "" }, ROOT, STATE_ROOT);
    expect(config.venueDir).toBe(resolve(STATE_ROOT, "venue"));
    expect(config.venueDir).not.toBe(resolve(""));
    expect(config.venueDir).not.toBe(process.cwd());
  });

  // Stored verbatim: `mountSpa` resolves the path when serving. Unset mounts nothing, because dev
  // uses the Vite dev servers.
  it("reads WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR / WAITRON_SETUP_APP_DIR when set, else undefined", () => {
    const off = loadConfig(MIN_ENV, ROOT, STATE_ROOT);
    expect(off.tillAppDir).toBeUndefined();
    expect(off.dashboardAppDir).toBeUndefined();
    expect(off.setupAppDir).toBeUndefined();

    const on = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_TILL_APP_DIR: "/srv/till",
        WAITRON_DASHBOARD_APP_DIR: "/srv/dash",
        WAITRON_SETUP_APP_DIR: "/srv/setup",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(on.tillAppDir).toBe("/srv/till");
    expect(on.dashboardAppDir).toBe("/srv/dash");
    expect(on.setupAppDir).toBe("/srv/setup");
  });

  // `join("", "index.html")` would be a relative `index.html` under cwd.
  it("treats an empty WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR / WAITRON_SETUP_APP_DIR as unset (undefined, not '')", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_TILL_APP_DIR: "",
        WAITRON_DASHBOARD_APP_DIR: "",
        WAITRON_SETUP_APP_DIR: "",
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.tillAppDir).toBeUndefined();
    expect(config.dashboardAppDir).toBeUndefined();
    expect(config.setupAppDir).toBeUndefined();
  });

  it("carries WAITRON_BOX_ADDRESSES through to config", () => {
    const cfg = loadConfig({ ...MIN_ENV, WAITRON_BOX_ADDRESSES: "192.168.1.10" }, ROOT, STATE_ROOT);
    expect(cfg.boxAddresses).toEqual(["192.168.1.10"]);
  });

  it("leaves boxAddresses undefined when the variable is unset", () => {
    expect(loadConfig(MIN_ENV, ROOT, STATE_ROOT).boxAddresses).toBeUndefined();
  });
});

describe("deploymentEnvironment", () => {
  it("defaults to preproduction when unset, so production is never reached by omission", () => {
    expect(deploymentEnvironment({})).toBe("preproduction");
    expect(deploymentEnvironment({ WAITRON_ENV: "" })).toBe("preproduction");
  });

  it("refuses a value that is neither environment, naming the variable", async () => {
    const error = await captureError(() =>
      Promise.resolve(deploymentEnvironment({ WAITRON_ENV: "staging" })),
    );
    expect(error).toMatchObject({
      code: "server.config_invalid",
      params: { variable: "WAITRON_ENV", reason: "not_a_deployment_environment" },
    });
  });
});

describe("WAITRON_ENV=dev", () => {
  it("deploymentEnvironment maps dev to preproduction (fiscal-inert)", () => {
    expect(deploymentEnvironment({ WAITRON_ENV: "dev" })).toBe("preproduction");
  });
  it("isDevMode is true only for the literal dev", () => {
    expect(isDevMode({ WAITRON_ENV: "dev" })).toBe(true);
    expect(isDevMode({ WAITRON_ENV: "preproduction" })).toBe(false);
    expect(isDevMode({ WAITRON_ENV: "production" })).toBe(false);
    expect(isDevMode({})).toBe(false);
  });
  it("production and devMode are mutually exclusive for every input", () => {
    for (const raw of ["production", "preproduction", "dev", undefined]) {
      const env = { WAITRON_ENV: raw } as Record<string, string | undefined>;
      const isProd = deploymentEnvironment(env) === "production";
      expect(isProd && isDevMode(env)).toBe(false);
    }
  });
  it("an unknown value still throws server.config_invalid", () => {
    expect(() => deploymentEnvironment({ WAITRON_ENV: "staging" })).toThrow();
  });
});

describe("WAITRON_ONBOARDING_INTENT", () => {
  const productionRp = {
    WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
    WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
  };

  it.each([
    ["demo", "preproduction"],
    ["prepare", "preproduction"],
    ["live", "production"],
  ] as const)("accepts %s with its required fiscal environment", (intent, environment) => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        ...(environment === "production" ? productionRp : {}),
        WAITRON_ENV: environment,
        WAITRON_ONBOARDING_INTENT: intent,
      },
      ROOT,
      STATE_ROOT,
    );
    expect(config.onboardingIntent).toBe(intent);
  });

  it("accepts the live UI intent in dev while retaining preproduction external services", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_ENV: "dev", WAITRON_ONBOARDING_INTENT: "live" },
      ROOT,
      STATE_ROOT,
    );
    expect(config).toMatchObject({
      environment: "preproduction",
      devMode: true,
      onboardingIntent: "live",
    });
  });

  it.each([
    ["demo", "production"],
    ["prepare", "production"],
    ["live", "preproduction"],
  ] as const)("refuses %s with %s", async (intent, environment) => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          {
            ...MIN_ENV,
            ...(environment === "production" ? productionRp : {}),
            WAITRON_ENV: environment,
            WAITRON_ONBOARDING_INTENT: intent,
          },
          ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_ONBOARDING_INTENT",
      reason: "intent_environment_mismatch",
    });
  });

  it("refuses an unknown intent", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_ONBOARDING_INTENT: "training" }, ROOT, STATE_ROOT),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_ONBOARDING_INTENT",
      reason: "not_an_onboarding_intent",
    });
  });
});

describe("WAITRON_FISCAL_TEST_SUBMISSIONS", () => {
  it("is disabled by default and enabled only by the explicit 'enabled' value", () => {
    expect(loadConfig(MIN_ENV, ROOT, STATE_ROOT).fiscalTestSubmissions).toBe(false);
    expect(
      loadConfig({ ...MIN_ENV, WAITRON_FISCAL_TEST_SUBMISSIONS: "enabled" }, ROOT, STATE_ROOT)
        .fiscalTestSubmissions,
    ).toBe(true);
  });

  it("rejects an ambiguous value", () => {
    expect(() =>
      loadConfig({ ...MIN_ENV, WAITRON_FISCAL_TEST_SUBMISSIONS: "true" }, ROOT, STATE_ROOT),
    ).toThrowError(
      expect.objectContaining({
        code: "server.config_invalid",
        params: { variable: "WAITRON_FISCAL_TEST_SUBMISSIONS", reason: "not_enabled" },
      }),
    );
  });
});

describe("WAITRON_PAYMENT_TEST_PROVIDERS", () => {
  it("is disabled by default and enabled only by the explicit 'enabled' value", () => {
    expect(loadConfig(MIN_ENV, ROOT, STATE_ROOT).paymentTestProviders).toBe(false);
    expect(
      loadConfig({ ...MIN_ENV, WAITRON_PAYMENT_TEST_PROVIDERS: "enabled" }, ROOT, STATE_ROOT)
        .paymentTestProviders,
    ).toBe(true);
  });

  it("rejects an ambiguous value", () => {
    expect(() =>
      loadConfig({ ...MIN_ENV, WAITRON_PAYMENT_TEST_PROVIDERS: "true" }, ROOT, STATE_ROOT),
    ).toThrowError(
      expect.objectContaining({
        code: "server.config_invalid",
        params: { variable: "WAITRON_PAYMENT_TEST_PROVIDERS", reason: "not_enabled" },
      }),
    );
  });
});

describe("loadTunnelConfig", () => {
  const base = {
    WAITRON_TUNNEL_RELAY_URL: "tcp://relay.example:9000",
    WAITRON_TUNNEL_BOX_ID: "box-1",
    WAITRON_TUNNEL_TOKEN: "secret",
  };

  it("returns undefined when the relay url is unset (tunnel off)", () => {
    expect(loadTunnelConfig({})).toBeUndefined();
  });

  // Empty means off, not a refusal; a present-but-unparseable url is refused (below).
  it("returns undefined when the relay url is empty (tunnel off), never reaching a dialer as ''", () => {
    expect(loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "" })).toBeUndefined();
  });

  it("parses a full config with the default pool size", () => {
    expect(loadTunnelConfig(base)).toEqual({
      relayHost: "relay.example",
      relayPort: 9000,
      boxId: "box-1",
      token: "secret",
      poolSize: 4,
    });
  });

  it("reads WAITRON_TUNNEL_POOL_SIZE as the connection pool size", () => {
    expect(loadTunnelConfig({ ...base, WAITRON_TUNNEL_POOL_SIZE: "8" })!.poolSize).toBe(8);
  });

  it("refuses a present-but-unparseable relay url", async () => {
    const error = await captureError(() =>
      Promise.resolve(loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "not a url" })),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "not_a_url",
    });
  });

  // No scheme, so it parses as scheme + opaque path with hostname "", which a dialer must never see.
  it("refuses a relay url that parses but names no host", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "relay.example:9000" }),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "not_a_url",
    });
  });

  // `.port` is "", and `Number("")` is 0.
  it("refuses a relay url that omits the port", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "tcp://relay.example" }),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "no_port",
    });
  });

  // `.port` is "0", not "", so an empty-string check alone would let it through.
  it("refuses a relay url whose port is zero", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadTunnelConfig({ ...base, WAITRON_TUNNEL_RELAY_URL: "tcp://relay.example:0" }),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_RELAY_URL",
      reason: "no_port",
    });
  });

  // A blank token must never mean "no auth".
  it("refuses a blank box id when the relay url is set", async () => {
    const error = await captureError(() =>
      Promise.resolve(loadTunnelConfig({ ...base, WAITRON_TUNNEL_BOX_ID: "" })),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_BOX_ID",
      reason: "field_blank",
    });
  });

  it("refuses a blank token when the relay url is set", async () => {
    const error = await captureError(() =>
      Promise.resolve(loadTunnelConfig({ ...base, WAITRON_TUNNEL_TOKEN: "" })),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_TOKEN",
      reason: "field_blank",
    });
  });

  it("refuses a non-positive pool size", async () => {
    const error = await captureError(() =>
      Promise.resolve(loadTunnelConfig({ ...base, WAITRON_TUNNEL_POOL_SIZE: "0" })),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TUNNEL_POOL_SIZE",
      reason: "not_a_positive_integer",
    });
  });
});

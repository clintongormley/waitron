import { isAbsolute, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { captureError } from "@waitron/db";
import { DEFAULTS } from "@waitron/scheduler";
import { isAppError } from "@waitron/shared";
import {
  deploymentEnvironment,
  isDevMode,
  loadConfig,
  loadMirrorSyncConfig,
  loadSyncConfig,
  loadTunnelConfig,
} from "./config.js";

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
// The boot-computed default media root, threaded in exactly as ROOT (the migrations root) is — so
// an unset OR empty WAITRON_MEDIA_DIR resolves to this, never to `resolve("")` (which is cwd, the
// "empty value is a valid value" trap CLAUDE.md §3 warns about). Absolute on purpose, distinct from
// ROOT, so a mediaDir assertion cannot pass by picking up the migrations root by coincidence.
const MEDIA_ROOT = "/opt/waitron/media";
// The boot-computed default state root (the box's persisted self-signed cert PEMs + generated
// secrets), threaded in exactly as MEDIA_ROOT is — so an unset OR empty WAITRON_STATE_DIR resolves
// to this, never to `resolve("")` (which is cwd, the "empty value is a valid value" trap CLAUDE.md
// §3 warns about). Absolute on purpose, distinct from ROOT and MEDIA_ROOT so a stateDir assertion
// cannot pass by picking up another root by coincidence.
const STATE_ROOT = "/opt/waitron/state";

const EXPECTED_TILL = {
  tenantId: TILL_ENV.WAITRON_TILL_TENANT_ID,
  tillId: TILL_ENV.WAITRON_TILL_TILL_ID,
  nodeId: TILL_ENV.WAITRON_TILL_NODE_ID,
  seriesId: TILL_ENV.WAITRON_TILL_SERIES_ID,
  locationId: TILL_ENV.WAITRON_TILL_LOCATION_ID,
  locale: "es-ES",
  invoiceLocales: ["es-ES"],
  // MIN_ENV sets no WAITRON_TILL_CARD_* vars, so the integrated-terminal fields take their defaults:
  // no card provider and tips off (and NO stripeReaderId key — the terminal branch is the only one
  // that carries a reader). `toEqual` would fail if `loadTillConfig` materialised any of them.
  cardProvider: "none",
  tipsEnabled: false,
};

function codeOf(error: unknown): string {
  return isAppError(error) ? error.code : `not an AppError: ${String(error)}`;
}

describe("loadConfig", () => {
  it("defaults every optional value, and defaults the deployment environment to preproduction", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config).toEqual({
      databaseUrl: "postgres://u@h/d",
      // Defaults to DATABASE_URL — same variable, same role — so a deployment that never sets
      // WAITRON_MIGRATIONS_DATABASE_URL keeps a single connection string for both jobs, matching
      // this package's behaviour before the split.
      migrationsDatabaseUrl: "postgres://u@h/d",
      // No WAITRON_SYNC_DATABASE_URL set — OPTIONAL at setup boot (the primary provision path never
      // needs it), so it is present-but-undefined here, asserted explicitly the same way
      // settlementLagMs below is. An adopt REQUEST is where its absence is refused (boot's guard),
      // not setup boot.
      syncDatabaseUrl: undefined,
      // Production numbering can never be reused, so the safe environment is the default and
      // production must be typed out. This assertion is the guard on that.
      environment: "preproduction",
      // MIN_ENV sets no WAITRON_ENV, so this is not a dev host — the dev device switcher (SP-C) is
      // off. `devMode` is `true` only for the literal WAITRON_ENV=dev.
      devMode: false,
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
      // No WAITRON_MEDIA_DIR set, so mediaDir falls back to the boot-provided default (MEDIA_ROOT),
      // the same isUnset fallback migrationsRoot uses above — never resolve("") / cwd (CLAUDE.md §3).
      mediaDir: MEDIA_ROOT,
      // No WAITRON_STATE_DIR set, so stateDir falls back to the boot-provided default (STATE_ROOT),
      // the same isUnset fallback mediaDir uses above — never resolve("") / cwd (CLAUDE.md §3).
      stateDir: STATE_ROOT,
      // No WAITRON_LOG_DIR set, so logDir defaults to `join(stateDir, "logs")` — under whichever state
      // root won above (here STATE_ROOT). The rotation knobs take their bytes/files defaults.
      logDir: resolve(STATE_ROOT, "logs"),
      logMaxBytes: 10_000_000,
      logMaxFiles: 5,
      // No WAITRON_TLS_* set, so the whole optional block is absent — not present-but-undefined.
      // `tls` is omitted from the returned object entirely (see loadConfig's conditional spread).
      till: EXPECTED_TILL,
      // No WAITRON_MANAGEMENT_* set, so the passkey Relying Party falls back to loopback dev values.
      managementRpId: "localhost",
      managementOrigin: "http://localhost:5191",
      // No WAITRON_ADVERTISED_ORIGIN set, so the origin tills route on is the origin this box already
      // serves the dashboard from.
      advertisedOrigin: "http://localhost:5191",
      // No WAITRON_TENANT_DOMAIN set, so the device cookie stays host-only (no `Domain` attribute).
      // Present-but-undefined, asserted explicitly the same way settlementLagMs above is.
      tenantDomain: undefined,
      // No WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR / WAITRON_SETUP_APP_DIR set, so the box
      // serves none of the SPAs — dev uses the Vite dev servers. Present-but-undefined, asserted
      // explicitly the same way settlementLagMs above is, so this case pins that an unset app dir
      // defaults to undefined.
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

  it("populates config.till from the WAITRON_TILL_* environment (the till's fiscal identity)", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.till).toEqual(EXPECTED_TILL);
  });

  // Setup mode (slice 1b): an unprovisioned box has no venue, so the five WAITRON_TILL_*_ID are
  // absent — `loadConfig` then leaves `config.till` UNDEFINED and does NOT throw (boot branches on
  // that in a later slice-1b task). A provisioned box sets all five and `config.till` carries the
  // identity. DATABASE_URL stays required either way — its guard fires before the till is read, so a
  // setup box with no DATABASE_URL still reports the DATABASE_URL fault (the `requires DATABASE_URL`
  // case below covers that ordering).
  it("leaves config.till undefined when the five WAITRON_TILL_*_ID are absent, else populates it", () => {
    const setup = loadConfig({ DATABASE_URL: "postgres://u@h/d" }, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(setup.till).toBeUndefined();

    const provisioned = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
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
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.tls).toEqual({
      certFile: "/etc/waitron/tls/cert.pem",
      keyFile: "/etc/waitron/tls/key.pem",
    });
  });

  it("leaves config.tls undefined when NEITHER cert nor key is set (plain HTTP loopback dev)", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.tls).toBeUndefined();
  });

  // Both-or-neither: TLS with only the cert (no private key) cannot serve HTTPS, and only the key
  // (no certificate) is equally unusable — a half-configured pair is a boot-time refusal, not a
  // silent fall back to plain HTTP that an operator who set one variable would never expect.
  it.each([
    // [missing var, the other var supplied]. Cert set, key missing -> the error names the MISSING
    // variable, the one the operator must add. `missing` is first so the `%s` title prints it, not the
    // override object.
    ["WAITRON_TLS_KEY_FILE", { WAITRON_TLS_CERT_FILE: "/etc/waitron/tls/cert.pem" }],
    // Key set, cert missing -> symmetric.
    ["WAITRON_TLS_CERT_FILE", { WAITRON_TLS_KEY_FILE: "/etc/waitron/tls/key.pem" }],
  ])("rejects a half-configured TLS pair, naming the missing %s", async (missing, extra) => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({ ...MIN_ENV, ...extra }, ROOT, MEDIA_ROOT, STATE_ROOT)),
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
          MEDIA_ROOT,
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

  it("requires DATABASE_URL", async () => {
    const error = await captureError(() =>
      Promise.resolve(loadConfig({}, ROOT, MEDIA_ROOT, STATE_ROOT)),
    );
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
        WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com",
        WAITRON_SCHEDULER_HORIZON_DAYS: "14",
        WAITRON_SCHEDULER_MAX_PERIODS_PER_TICK: "3",
        WAITRON_SCHEDULER_MAX_ATTEMPTS: "5",
        WAITRON_SCHEDULER_BACKOFF_BASE_MS: "1000",
        WAITRON_SCHEDULER_STALE_AFTER_MS: "2000",
      },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
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

  // In PRODUCTION the passkey Relying Party ID and origin are REQUIRED, not defaulted: shipping the
  // loopback defaults to a real deployment binds every passkey ceremony to `localhost`, so a browser
  // served from the real domain fails its origin check with an opaque 401 at LOGIN time rather than a
  // loud boot failure. `loadConfig` throws `server.config_missing` naming the unset variable — the
  // same require-at-boot posture DATABASE_URL takes (the TLS pair is both-or-neither, a distinct shape
  // that throws `config_invalid`, so it is not the analogy here).
  it.each([
    // [missing var, the other var supplied]. RP ID omitted (origin supplied) -> the error names the
    // RP ID, the variable still to be set. `missing` is first so the `%s` title prints it, not the
    // override object.
    ["WAITRON_MANAGEMENT_RP_ID", { WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com" }],
    // Origin omitted (RP ID supplied) -> symmetric.
    ["WAITRON_MANAGEMENT_ORIGIN", { WAITRON_MANAGEMENT_RP_ID: "dashboard.example.com" }],
  ])(
    "requires the passkey RP config in production, naming the missing %s",
    async (missing, extra) => {
      const error = await captureError(() =>
        Promise.resolve(
          loadConfig(
            { ...MIN_ENV, WAITRON_ENV: "production", ...extra },
            ROOT,
            MEDIA_ROOT,
            STATE_ROOT,
          ),
        ),
      );
      expect(codeOf(error)).toBe("server.config_missing");
      expect(isAppError(error) && error.params).toEqual({ variable: missing });
    },
  );

  // Empty string is unset (config.ts's `isUnset`), so `WAITRON_MANAGEMENT_RP_ID=` in a production env
  // file is missing, not a blank RP ID that silently reaches the ceremonies — the same
  // `VAR=`-means-unset rule DATABASE_URL and the TLS pair follow.
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
          MEDIA_ROOT,
          STATE_ROOT,
        ),
      ),
    );
    expect(codeOf(error)).toBe("server.config_missing");
    expect(isAppError(error) && error.params).toEqual({ variable: "WAITRON_MANAGEMENT_RP_ID" });
  });

  // OUTSIDE production the two stay OPTIONAL: preproduction/dev keeps the loopback defaults when they
  // are unset (the `defaults every optional value` case above), and honours them when they ARE set —
  // this case, so a preproduction operator can still point the RP config at a non-loopback value
  // without it being required, rejected, or ignored.
  it("honours WAITRON_MANAGEMENT_RP_ID/ORIGIN in preproduction when they are set", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_MANAGEMENT_RP_ID: "staging.example.com",
        WAITRON_MANAGEMENT_ORIGIN: "https://staging.example.com",
      },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.environment).toBe("preproduction");
    expect(config.managementRpId).toBe("staging.example.com");
    expect(config.managementOrigin).toBe("https://staging.example.com");
  });

  // `advertisedOrigin` is what this node publishes as its `contactUrl` and what CORS treats as
  // "self", so a box that sets nothing must still advertise an origin a till can reach: the one it
  // already serves the dashboard from. The management origin here is deliberately NOT the loopback
  // default, so "fell back to managementOrigin" and "took DEFAULT_MANAGEMENT_ORIGIN" cannot both
  // print the same value.
  it("defaults advertisedOrigin to managementOrigin when WAITRON_ADVERTISED_ORIGIN is unset or empty", () => {
    const managed = { ...MIN_ENV, WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com" };
    const unset = loadConfig(managed, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(unset.advertisedOrigin).toBe("https://dashboard.example.com");
    // Empty string is unset (config.ts's `isUnset`), so `WAITRON_ADVERTISED_ORIGIN=` takes the same
    // fallback rather than putting a blank `contactUrl` into the membership document — the
    // `VAR=`-means-unset rule the rest of this file applies.
    const empty = loadConfig(
      { ...managed, WAITRON_ADVERTISED_ORIGIN: "" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(empty.advertisedOrigin).toBe("https://dashboard.example.com");
  });

  it("honours a configured bare WAITRON_ADVERTISED_ORIGIN", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_ADVERTISED_ORIGIN: "https://box.deli.waitron.app" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.advertisedOrigin).toBe("https://box.deli.waitron.app");
  });

  // WAITRON_TENANT_DOMAIN scopes the device cookie's `Domain` (§3.5; see ServerConfig.tenantDomain).
  // Unset OR empty → undefined (host-only cookies, loopback dev); a set value is lower-cased for the
  // case-insensitive host comparison `cookieDomainFor` makes.
  it("reads WAITRON_TENANT_DOMAIN into config.tenantDomain (lower-cased), else undefined", () => {
    expect(loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT).tenantDomain).toBeUndefined();
    expect(
      loadConfig(
        { ...MIN_ENV, WAITRON_TENANT_DOMAIN: "Deli.Waitron.App" },
        ROOT,
        MEDIA_ROOT,
        STATE_ROOT,
      ).tenantDomain,
    ).toBe("deli.waitron.app");
    // Empty string is unset (config.ts's own `isUnset`): `WAITRON_TENANT_DOMAIN=` is host-only, never
    // a blank `Domain` on the Set-Cookie (CLAUDE.md §3).
    expect(
      loadConfig({ ...MIN_ENV, WAITRON_TENANT_DOMAIN: "" }, ROOT, MEDIA_ROOT, STATE_ROOT)
        .tenantDomain,
    ).toBeUndefined();
  });

  // A cookie `Domain` attribute is a bare registrable domain — no scheme, no port, no path, no
  // whitespace. A value carrying `/`, `:` or whitespace is a URL, a host:port, or a typo, refused
  // loudly at boot rather than reaching a Set-Cookie `Domain` malformed. Reuses the shipped
  // `server.config_invalid` code (never renamed), with a `not_a_domain` reason.
  it.each([
    "https://deli.waitron.app",
    "deli.waitron.app:8443",
    "deli.waitron.app/till",
    "deli waitron app",
  ])("refuses WAITRON_TENANT_DOMAIN=%s, which is not a bare domain", async (bad) => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_TENANT_DOMAIN: bad }, ROOT, MEDIA_ROOT, STATE_ROOT),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_TENANT_DOMAIN",
      reason: "not_a_domain",
    });
  });

  // A `contactUrl` a till concatenates paths onto, and a CORS allow-list entry compared against a
  // browser's `Origin` header, are both bare http(s) origins — anything carrying a path, missing a
  // scheme, or carrying a scheme a till never fetches over is refused loudly at boot rather than
  // silently published to every till.
  it.each([
    // No scheme at all: `new URL` cannot parse it.
    "box.deli.waitron.app",
    // Host and port with no scheme: this DOES parse, as the non-special scheme
    // `box.deli.waitron.app:` whose origin is the literal string "null" — refused by the
    // origin comparison, never by the parse. The likeliest operator typo of the three.
    "box.deli.waitron.app:8443",
    // A path: the parsed origin drops it, so it differs from the input.
    "https://box.deli.waitron.app/till",
    // A trailing slash is a path (`/`): same mismatch, and the likeliest way to copy an origin out
    // of a browser's address bar wrong.
    "https://box.deli.waitron.app/",
    // A WHATWG special scheme that round-trips byte-for-byte, so only the explicit http(s) check
    // refuses it. A till fetches over http(s); a `ws://` contactUrl is unusable to it.
    "ws://box.deli.waitron.app",
    // Not a URL in any reading.
    "not a url",
  ])("refuses WAITRON_ADVERTISED_ORIGIN=%s, which is not a bare origin", async (bad) => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig({ ...MIN_ENV, WAITRON_ADVERTISED_ORIGIN: bad }, ROOT, MEDIA_ROOT, STATE_ROOT),
      ),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    expect(isAppError(error) && error.params).toEqual({
      variable: "WAITRON_ADVERTISED_ORIGIN",
      reason: "not_an_origin",
    });
  });

  // `managementOrigin` is itself a bare origin: WebAuthn compares a ceremony's `Origin` header to it
  // byte-for-byte, and it is what `advertisedOrigin` falls back to. So it is validated under its own
  // name, whether or not the fallback is taken.
  it("refuses a WAITRON_MANAGEMENT_ORIGIN that is not a bare origin, naming that variable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MANAGEMENT_ORIGIN: "https://dashboard.example.com/" },
          ROOT,
          MEDIA_ROOT,
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

  // The case above validates the value `advertisedOrigin` FELL BACK to; this one proves the check is
  // on `managementOrigin` in its own right, not on whatever ended up advertised — a bare
  // WAITRON_ADVERTISED_ORIGIN does not excuse a malformed management origin, because that value is
  // still the WebAuthn expected-origin the dashboard's ceremonies are compared against.
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
          MEDIA_ROOT,
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

  it("falls back to DATABASE_URL when WAITRON_MIGRATIONS_DATABASE_URL is set but empty", () => {
    // Mirrors WAITRON_MIGRATIONS_DIR's own empty-string-means-unset treatment elsewhere in this
    // file: an operator's deploy tooling that always sets the variable, empty when unused, must
    // not be forced to omit it entirely to get the default.
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MIGRATIONS_DATABASE_URL: "" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.migrationsDatabaseUrl).toBe(config.databaseUrl);
  });

  // WAITRON_SYNC_DATABASE_URL is the mirror's OWN least-privileged sync pool (a `sync_applier` role),
  // read back at mirror boot by `loadMirrorSyncConfig`. It is OPTIONAL at setup boot — the primary
  // provision path never needs it — so `loadConfig` reads it via `isUnset` (NOT `required`): present
  // when set, undefined when absent OR empty. Adopt is where an unset value is REFUSED (boot's guard,
  // Ruling 1), because that is the one interactive moment the operator can supply it.
  it("reads WAITRON_SYNC_DATABASE_URL into config.syncDatabaseUrl when set, and leaves it undefined when absent or empty", () => {
    const set = loadConfig(
      { ...MIN_ENV, WAITRON_SYNC_DATABASE_URL: "postgres://sync@h/d" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(set.syncDatabaseUrl).toBe("postgres://sync@h/d");

    // Absent → undefined.
    expect(loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT).syncDatabaseUrl).toBeUndefined();

    // Empty string is unset (config.ts's own `isUnset`), so `WAITRON_SYNC_DATABASE_URL=` is undefined,
    // never a blank connection string reaching a sync pool as `""` (CLAUDE.md §3).
    const empty = loadConfig(
      { ...MIN_ENV, WAITRON_SYNC_DATABASE_URL: "" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(empty.syncDatabaseUrl).toBeUndefined();
  });

  it("accepts the highest real TCP port, 65535 — the boundary the rejection test just above it lives one past", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_HTTP_PORT: "65535" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
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
      Promise.resolve(loadConfig({ ...MIN_ENV, [variable]: value }, ROOT, MEDIA_ROOT, STATE_ROOT)),
    );
    expect(codeOf(error)).toBe("server.config_invalid");
    // The variable NAME and a reason CODE — never the value, which is arbitrary operator input and
    // could be a mistyped secret.
    expect(isAppError(error) && error.params).toEqual({ variable, reason });
  });

  it("rejects a minTick above maxTick, which would make the clamp unsatisfiable", async () => {
    const error = await captureError(() =>
      Promise.resolve(
        loadConfig(
          { ...MIN_ENV, WAITRON_MIN_TICK_MS: "10000", WAITRON_MAX_TICK_MS: "5000" },
          ROOT,
          MEDIA_ROOT,
          STATE_ROOT,
        ),
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
          MEDIA_ROOT,
          STATE_ROOT,
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
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.minTickMs).toBe(10_000);
    expect(config.skipRetryMs).toBe(10_000);
  });

  it("boots with the shipped defaults (skipRetryMs 300000, minTickMs 5000) — the new guard must not reject them", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
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
          MEDIA_ROOT,
          STATE_ROOT,
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
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.maxTickMs).toBe(300_000);
    expect(config.skipRetryMs).toBe(300_000);
  });

  it("accepts a skipRetryMs comfortably below maxTickMs", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MAX_TICK_MS: "120000", WAITRON_SKIP_RETRY_MS: "60000" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.maxTickMs).toBe(120_000);
    expect(config.skipRetryMs).toBe(60_000);
  });

  it("resolves WAITRON_MEDIA_DIR to an absolute path", () => {
    // An absolute value survives resolve() unchanged — mediaDir is the store the upload/serve routes
    // (later tasks) join untrusted filenames onto, so it must be a settled absolute path, never a
    // relative one whose meaning shifts with the process's cwd.
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MEDIA_DIR: "/srv/waitron/product-images" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.mediaDir).toBe("/srv/waitron/product-images");
    expect(isAbsolute(config.mediaDir)).toBe(true);
  });

  it("resolves a relative WAITRON_MEDIA_DIR against cwd, so mediaDir is always absolute", () => {
    // A relative value is resolved (resolve(value)) rather than stored verbatim — this is the ONE
    // path where resolve() is applied, and it is applied only to a genuinely-set value, never to the
    // empty string (that case falls back below, not through resolve).
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_MEDIA_DIR: "media/uploads" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.mediaDir).toBe(resolve("media/uploads"));
    expect(isAbsolute(config.mediaDir)).toBe(true);
  });

  it("falls back to the boot-provided defaultMediaRoot when WAITRON_MEDIA_DIR is unset", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.mediaDir).toBe(MEDIA_ROOT);
  });

  // The load-bearing empty-value guard (CLAUDE.md §3): an operator's `WAITRON_MEDIA_DIR=` (set but
  // empty) must fall back to the default exactly as an unset one does — NEVER `resolve("")`, which is
  // cwd. A mediaDir silently pointing at cwd would have the upload route writing product images into,
  // and the serve route reading them from, whatever directory the process happened to start in.
  it("treats an empty WAITRON_MEDIA_DIR as unset, falling back to the default — never resolve('') / cwd", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_MEDIA_DIR: "" }, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.mediaDir).toBe(MEDIA_ROOT);
    // Prove the trap directly: the empty value did NOT resolve to cwd.
    expect(config.mediaDir).not.toBe(resolve(""));
    expect(config.mediaDir).not.toBe(process.cwd());
  });

  // stateDir is threaded exactly as mediaDir above: an unset WAITRON_STATE_DIR takes the
  // boot-computed default root, a genuinely-set value is resolve()d to an absolute path.
  it("defaults stateDir to the supplied default root when WAITRON_STATE_DIR is unset", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.stateDir).toBe(STATE_ROOT);
  });

  it("resolves WAITRON_STATE_DIR to an absolute path when set", () => {
    // A relative value is resolved (resolve(value)) rather than stored verbatim — stateDir is the
    // base the box materialises its cert PEMs + secrets under, so it must be a settled absolute path.
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_STATE_DIR: "some/state" },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.stateDir).toBe(resolve("some/state"));
    expect(isAbsolute(config.stateDir)).toBe(true);
  });

  // The load-bearing empty-value guard (CLAUDE.md §3): an operator's `WAITRON_STATE_DIR=` (set but
  // empty) must fall back to the default exactly as an unset one does — NEVER `resolve("")`, which is
  // cwd. A stateDir silently pointing at cwd would materialise the box's secrets in whatever
  // directory the process happened to start in.
  it("treats an empty WAITRON_STATE_DIR as unset, falling back to the default — never resolve('') / cwd", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_STATE_DIR: "" }, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.stateDir).toBe(STATE_ROOT);
    // Prove the trap directly: the empty value did NOT resolve to cwd.
    expect(config.stateDir).not.toBe(resolve(""));
    expect(config.stateDir).not.toBe(process.cwd());
  });

  // The rotating-log directory + rotation knobs (this task). logDir defaults to `join(stateDir, "logs")`
  // under whichever state root actually won, so it tracks a WAITRON_STATE_DIR override rather than the
  // boot default. The two knobs default to 10 MB / 5 files.
  it("defaults logDir to join(stateDir, 'logs') and the rotation knobs to 10MB / 5 files", () => {
    const config = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.logDir).toBe(resolve(STATE_ROOT, "logs"));
    expect(config.logMaxBytes).toBe(10_000_000);
    expect(config.logMaxFiles).toBe(5);
  });

  it("derives the default logDir from a WAITRON_STATE_DIR override, not the boot default root", () => {
    const config = loadConfig(
      { ...MIN_ENV, WAITRON_STATE_DIR: "/var/lib/waitron" },
      ROOT,
      MEDIA_ROOT,
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
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.logDir).toBe("/srv/logs");
    expect(config.logMaxBytes).toBe(2_000_000);
    expect(config.logMaxFiles).toBe(3);
  });

  // The load-bearing empty-value guard (CLAUDE.md §3): `WAITRON_LOG_DIR=` (set but empty) falls back to
  // the default exactly as an unset one does — NEVER `resolve("")` / cwd, which would scatter the box's
  // logs into whatever directory the process happened to start in.
  it("treats an empty WAITRON_LOG_DIR as unset, falling back to join(stateDir, 'logs')", () => {
    const config = loadConfig({ ...MIN_ENV, WAITRON_LOG_DIR: "" }, ROOT, MEDIA_ROOT, STATE_ROOT);
    expect(config.logDir).toBe(resolve(STATE_ROOT, "logs"));
    expect(config.logDir).not.toBe(resolve(""));
    expect(config.logDir).not.toBe(process.cwd());
  });

  // The built front-end directories the box serves same-origin (slice 1a/2c). All OPTIONAL: dev leaves
  // them unset and uses the Vite dev servers, so an unset value must be `undefined` (nothing mounts),
  // not a default path. Stored verbatim in config (no `resolve` here) — boot only ever
  // `existsSync(join(dir, "index.html"))`s and hands the string to `mountSpa`, which normalises it
  // once via `resolve` when serving; deployment (#9) sets an absolute path.
  it("reads WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR / WAITRON_SETUP_APP_DIR when set, else undefined", () => {
    const off = loadConfig(MIN_ENV, ROOT, MEDIA_ROOT, STATE_ROOT);
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
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(on.tillAppDir).toBe("/srv/till");
    expect(on.dashboardAppDir).toBe("/srv/dash");
    expect(on.setupAppDir).toBe("/srv/setup");
  });

  // Empty string is unset (config.ts's own `isUnset`), the `VAR=`-means-unset rule every other
  // optional variable in this file follows: `WAITRON_TILL_APP_DIR=` must leave the SPA unmounted
  // (undefined), never reach boot as an empty dir whose `join("", "index.html")` would be a relative
  // `index.html` under cwd — the "empty value is a valid value" trap (CLAUDE.md §3).
  it("treats an empty WAITRON_TILL_APP_DIR / WAITRON_DASHBOARD_APP_DIR / WAITRON_SETUP_APP_DIR as unset (undefined, not '')", () => {
    const config = loadConfig(
      {
        ...MIN_ENV,
        WAITRON_TILL_APP_DIR: "",
        WAITRON_DASHBOARD_APP_DIR: "",
        WAITRON_SETUP_APP_DIR: "",
      },
      ROOT,
      MEDIA_ROOT,
      STATE_ROOT,
    );
    expect(config.tillAppDir).toBeUndefined();
    expect(config.dashboardAppDir).toBeUndefined();
    expect(config.setupAppDir).toBeUndefined();
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

describe("loadSyncConfig", () => {
  it("is undefined when no peers are configured", () => {
    expect(loadSyncConfig({})).toBeUndefined();
  });

  it("parses peers and requires a non-blank database url, defaulting the fast tick to 1000ms", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "https://peer/", token: "tok2" }]),
      WAITRON_SYNC_DATABASE_URL: "postgres://sync@host/db",
    };
    expect(loadSyncConfig(env)).toEqual({
      databaseUrl: "postgres://sync@host/db",
      peers: [{ nodeId: "n2", url: "https://peer/", token: "tok2" }],
      fastMinIdleMs: 1000,
      // Defaulted (WAITRON_SYNC_RETENTION_TICK_MS unset). retentionDatabaseUrl is NOT in this
      // object — the field is omitted when unset (its own test below proves that directly), so
      // `toEqual` here also pins that no present-but-undefined key leaks in.
      retentionTickMs: 60_000,
    });
  });

  it("reads WAITRON_SYNC_FAST_TICK_MS as the fast lane's idle interval", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
      WAITRON_SYNC_FAST_TICK_MS: "500",
    };
    expect(loadSyncConfig(env)!.fastMinIdleMs).toBe(500);
  });

  it("refuses a non-positive-integer WAITRON_SYNC_FAST_TICK_MS", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
      WAITRON_SYNC_FAST_TICK_MS: "0",
    };
    expect(() => loadSyncConfig(env)).toThrow(/config_invalid|WAITRON_SYNC_FAST_TICK_MS/);
  });

  it("reads WAITRON_SYNC_RETENTION_TICK_MS as the retention sweep's idle interval, defaulting to 60000", () => {
    const base = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
    };
    // Default when unset.
    expect(loadSyncConfig(base)!.retentionTickMs).toBe(60_000);
    // Honoured when set.
    expect(
      loadSyncConfig({ ...base, WAITRON_SYNC_RETENTION_TICK_MS: "30000" })!.retentionTickMs,
    ).toBe(30_000);
  });

  it("refuses a non-positive-integer WAITRON_SYNC_RETENTION_TICK_MS", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
      WAITRON_SYNC_RETENTION_TICK_MS: "0",
    };
    expect(() => loadSyncConfig(env)).toThrow(/config_invalid|WAITRON_SYNC_RETENTION_TICK_MS/);
  });

  it("sets retentionDatabaseUrl only when WAITRON_SYNC_RETENTION_DATABASE_URL is set (absent → field omitted)", () => {
    const base = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
    };
    // Set → field carries the URL.
    expect(
      loadSyncConfig({ ...base, WAITRON_SYNC_RETENTION_DATABASE_URL: "postgres://ret@host/db" })!
        .retentionDatabaseUrl,
    ).toBe("postgres://ret@host/db");
    // Unset → the key is OMITTED entirely (the sweep-off signal boot reads), not present-but-undefined.
    // `not.toHaveProperty` distinguishes the two — an `=== undefined` check would pass for both.
    expect(loadSyncConfig(base)).not.toHaveProperty("retentionDatabaseUrl");
    // Empty string is unset too (the "empty connection string is a valid connection string" trap,
    // CLAUDE.md §3): `WAITRON_SYNC_RETENTION_DATABASE_URL=` must omit the field, never reach
    // `createPostgresDb` as "".
    expect(loadSyncConfig({ ...base, WAITRON_SYNC_RETENTION_DATABASE_URL: "" })).not.toHaveProperty(
      "retentionDatabaseUrl",
    );
  });

  it("sets lagAlarmRows only when WAITRON_SYNC_LAG_ALARM_ROWS is a positive int (absent → field omitted; non-positive → throws)", () => {
    const base = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
    };
    // Set to a positive int → field carries the threshold.
    expect(loadSyncConfig({ ...base, WAITRON_SYNC_LAG_ALARM_ROWS: "1000" })!.lagAlarmRows).toBe(
      1000,
    );
    // Unset → the key is OMITTED entirely (the alarm is opt-in; boot then passes lagAlarmRows
    // undefined → runRetentionSweep stays prune-only). `not.toHaveProperty` distinguishes an omitted
    // key from a present-but-undefined one, which an `=== undefined` check would not.
    expect(loadSyncConfig(base)).not.toHaveProperty("lagAlarmRows");
    // Empty string is unset too — omit the field, never a present-but-undefined key.
    expect(loadSyncConfig({ ...base, WAITRON_SYNC_LAG_ALARM_ROWS: "" })).not.toHaveProperty(
      "lagAlarmRows",
    );
    // A non-positive value is refused (server.config_invalid) — the same posture positiveInt takes.
    expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_LAG_ALARM_ROWS: "0" })).toThrow(
      /config_invalid|WAITRON_SYNC_LAG_ALARM_ROWS/,
    );
    expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_LAG_ALARM_ROWS: "-5" })).toThrow(
      /config_invalid|WAITRON_SYNC_LAG_ALARM_ROWS/,
    );
  });

  it("refuses a blank sync database url", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "u", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "",
    };
    expect(() => loadSyncConfig(env)).toThrow(/config_missing|WAITRON_SYNC_DATABASE_URL/);
  });

  it("refuses a peer with a blank url or token", () => {
    const env = {
      WAITRON_SYNC_PEERS: JSON.stringify([{ nodeId: "n2", url: "", token: "t" }]),
      WAITRON_SYNC_DATABASE_URL: "x",
    };
    expect(() => loadSyncConfig(env)).toThrow(/config_invalid|WAITRON_SYNC_PEERS/);
  });

  it("refuses a peers value that is valid JSON but not a non-empty array", () => {
    const base = { WAITRON_SYNC_DATABASE_URL: "x" };
    expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_PEERS: "[]" })).toThrow(
      /config_invalid|WAITRON_SYNC_PEERS/,
    );
    expect(() => loadSyncConfig({ ...base, WAITRON_SYNC_PEERS: '{"nodeId":"n"}' })).toThrow(
      /config_invalid|WAITRON_SYNC_PEERS/,
    );
  });

  it("refuses malformed WAITRON_SYNC_PEERS JSON", () => {
    expect(() => loadSyncConfig({ WAITRON_SYNC_PEERS: "not json" })).toThrow(
      /config_invalid|WAITRON_SYNC_PEERS/,
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

  // BINDING RULING (task-5 brief): an absent OR empty WAITRON_TUNNEL_RELAY_URL means the tunnel is
  // OFF (undefined), exactly like loadSyncConfig's empty WAITRON_SYNC_PEERS off-switch — via isUnset.
  // The empty string does NOT fail closed here; returning undefined is how the empty value never
  // reaches a dialer as "" ("an empty connection string is a valid connection string", CLAUDE.md §3).
  // A PRESENT-but-unparseable url DOES fail closed (the cases below).
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

  // A url can parse yet name no host (`relay.example:9000` — no scheme, read as scheme + opaque path
  // → hostname ""). A blank relayHost is exactly the "" a dialer must never see, so it fails closed
  // too rather than being handed on (CLAUDE.md §3).
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

  // A well-formed url can still omit the port (`tcp://relay.example` → `.port` "" → `Number("")` 0).
  // relayPort 0 is exactly the degenerate value a dialer must never see, so a portless relay url
  // fails closed at boot — the mirror of the hostname guard, with a dedicated `no_port` reason
  // because the url IS valid, it just lacks the port we require.
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

  // An EXPLICIT port zero (`tcp://relay.example:0`) parses with `.port` "0", not "", so the empty-string
  // check alone would let `relayPort: 0` through — you cannot connect to port 0, so it fails closed too
  // (the `Number(url.port) === 0` guard catches both the omitted and the explicit-zero case).
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

  // Box id + token are required once the tunnel is on, and a blank one fails closed (the
  // peer_field_blank shape loadSyncConfig uses for a blank peer field): a blank token must never mean
  // "no auth", a blank box id names no box to the relay.
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

describe("loadMirrorSyncConfig", () => {
  // C2b (spec §7): a mirror's CONNECTION to its primary (relay URL, box CA + hostname, per-peer token)
  // now lives in the DB (`mirror_config`) + the vault (`sync.mirror_token`), read at boot — NOT in env.
  // This loader supplies only the mirror's LOCAL pull config: the `sync_applier` pool
  // (WAITRON_SYNC_DATABASE_URL) and the fast-lane tick. `peers` is deliberately empty — boot builds the
  // one relay peer from the DB config. Unlike `loadSyncConfig` it never returns undefined: a mirror MUST
  // pull, so an absent sync DB URL is a loud `server.config_missing`.
  it("returns the sync pool URL + defaulted ticks, and an empty peers list, from just the sync DB URL", () => {
    expect(loadMirrorSyncConfig({ WAITRON_SYNC_DATABASE_URL: "postgres://a@h/d" })).toEqual({
      databaseUrl: "postgres://a@h/d",
      peers: [],
      fastMinIdleMs: 1000,
      retentionTickMs: 60_000,
    });
  });

  it("reads WAITRON_SYNC_FAST_TICK_MS and WAITRON_SYNC_RETENTION_TICK_MS when set", () => {
    expect(
      loadMirrorSyncConfig({
        WAITRON_SYNC_DATABASE_URL: "postgres://a@h/d",
        WAITRON_SYNC_FAST_TICK_MS: "250",
        WAITRON_SYNC_RETENTION_TICK_MS: "5000",
      }),
    ).toEqual({
      databaseUrl: "postgres://a@h/d",
      peers: [],
      fastMinIdleMs: 250,
      retentionTickMs: 5000,
    });
  });

  // Fail-closed: a mirror that cannot open its sync pool cannot pull, so an absent (or empty, via
  // `required`'s `isUnset`) WAITRON_SYNC_DATABASE_URL is a loud boot failure, never sync-off.
  it("throws server.config_missing when WAITRON_SYNC_DATABASE_URL is absent", async () => {
    const error = await captureError(() => Promise.resolve(loadMirrorSyncConfig({})));
    expect(codeOf(error)).toBe("server.config_missing");
    expect(isAppError(error) && error.params).toEqual({ variable: "WAITRON_SYNC_DATABASE_URL" });
  });
});

import { VENUE_DIR_NAME } from "@waitron/store";
import { join, resolve } from "node:path";
import { deploymentEnvironmentFor, resolveLogDir } from "@waitron/db";
import type { DeploymentEnvironment } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { DEFAULTS } from "@waitron/payments";
import { resolveLitestreamBin } from "@waitron/stream/litestream.js";
import { parseBoxAddresses } from "./box-reach.js";
import { tryLoadNodeIdentity } from "./node-config.js";
import type { NodeIdentityConfig } from "./node-config.js";
import { loadTillAppSettings, type TillAppSettings } from "./till-config.js";
import { assertOutsideScratch } from "./scratch.js";
import { isUnset } from "./env-value.js";
import type { OnboardingIntent } from "./trading-config.js";
import "./errors.js";

export type { DeploymentEnvironment } from "@waitron/db";

export interface SchedulerConfig {
  horizonDays: number;
  maxPeriodsPerTick: number;
  maxAttempts: number;
  backoffBaseMs: number;
  staleAfterMs: number;
}

export interface ServerConfig {
  installationOrigin?: "usb";
  environment: DeploymentEnvironment;
  /** `WAITRON_ENV=dev` only ({@link isDevMode}); `environment` maps `dev` to `preproduction`. */
  devMode: boolean;
  /** Why this fresh primary was created; undefined when `WAITRON_ONBOARDING_INTENT` is unset. */
  onboardingIntent: OnboardingIntent | undefined;
  /** Explicitly enables preproduction submissions on a dedicated integration-test target. */
  fiscalTestSubmissions: boolean;
  /** Lets a Prepare node exercise a configured payment provider with test credentials. */
  paymentTestProviders: boolean;
  httpPort: number;
  staff?: { origin: string; host: string; port: number };
  /**
   * The plain-HTTP trust/landing listener's port; `0` disables it. A phone meets the browser's
   * interstitial for the untrusted self-signed leaf before any page runs, so the CA download is
   * served over plain HTTP.
   */
  landingPort: number;
  /** `WAITRON_SPARE_STORE_PORT`: where a spare's store listens for the main box's copy (D11). */
  spareStorePort: number;
  /** `WAITRON_SPARE_STORE_LOOPBACK_PORT`: where the spare's versitygw listens, on 127.0.0.1. */
  spareStoreLoopbackPort: number;
  /** Defaults to loopback, because `/health` is unauthenticated. */
  httpHost: string;
  migrationsRoot: string;
  /** `WAITRON_LITESTREAM_BIN`; unset or empty means `litestream`, found on PATH. */
  litestreamBin: string;
  /** `WAITRON_VERSITYGW_BIN`; unset or empty means `versitygw`, found on PATH. */
  versitygwBin: string;
  /**
   * The directory the box keeps its TLS files and generated secrets under, absolute so it does not
   * shift with the cwd. `WAITRON_STATE_DIR` overrides `defaultStateRoot`; an unset OR EMPTY value
   * falls back to it via `isUnset`, never `resolve("")`, which is the cwd (CLAUDE.md §3).
   */
  stateDir: string;
  tunnelControlDir?: string;
  /**
   * Where `openVenueStore` creates `venue.db` and `node.db`. Defaults to `join(stateDir, "venue")`;
   * `WAITRON_VENUE_DIR` overrides it. An unset OR EMPTY value falls back to the default via
   * `isUnset`, never `resolve("")`; an override is `resolve`d so it does not shift with the cwd.
   */
  venueDir: string;
  /**
   * The addresses this box advertises: its leaf's IP SANs, the trust page's QR and its mDNS A
   * records. Undefined means the host's interfaces (`listBoxIpv4`), which a container behind bridge
   * networking cannot use. From `WAITRON_BOX_ADDRESSES`, a comma-separated IPv4 list; unset or
   * empty → undefined.
   *
   * The leaf is minted once and reused, so changing this on a box that has already booted moves the
   * QR and mDNS but not the certificate. Delete the `tls/` quartet to force a re-mint.
   */
  boxAddresses?: string[];
  /**
   * Where the rotating log sink writes `waitron.log`. Defaults to `join(stateDir, "logs")`;
   * `WAITRON_LOG_DIR` overrides it (`resolveLogDir`). An unset OR EMPTY value falls back to the
   * default, never `resolve("")`; an override is used verbatim.
   */
  logDir: string;
  /** Operator-supplied PEM files, both or neither; they override the box leaf under `stateDir`. */
  tls?: { certFile: string; keyFile: string };
  node?: NodeIdentityConfig;
  tillApp: TillAppSettings;
  /** The WebAuthn Relying Party ID: a bare domain, no scheme or port. A passkey is only offered
   * back on the RP ID it was registered under. Defaults to `localhost`; REQUIRED in production. */
  managementRpId: string;
  /** The exact origin the dashboard is served from, which each passkey ceremony must match
   * byte-for-byte. Defaults to `http://localhost:5191`; REQUIRED in production, and in every
   * environment refused unless a bare http(s) origin (`bareOrigin`). */
  managementOrigin: string;
  /** Optional Google login client. The callback is derived from the validated management origin so
   * the configured Google redirect and the server route cannot drift. */
  googleOidc?: { clientId: string; clientSecret: string; redirectUri: string };
  /**
   * The device cookie's `Domain` when the request host is under it, so one credential reaches
   * every one of the venue's servers after a promotion. From `WAITRON_TENANT_DOMAIN`, lower-cased;
   * unset OR empty → undefined (host-only cookies); a value carrying `/`, `:` or whitespace is
   * refused.
   */
  tenantDomain?: string;
  /**
   * The built `till` SPA served at "/", mounted after every API route so it shadows none. From
   * `WAITRON_TILL_APP_DIR`; absent OR empty → undefined (not served), never `""`. Stored
   * verbatim.
   */
  tillAppDir?: string;
  /** The built `dashboard` SPA served at "/manage"; `WAITRON_DASHBOARD_APP_DIR`, as
   * `tillAppDir`. */
  dashboardAppDir?: string;
  /**
   * The built `setup` wizard SPA served at "/" in SETUP MODE; undefined serves the inline
   * placeholder shell. `WAITRON_SETUP_APP_DIR`, as `tillAppDir`.
   */
  setupAppDir?: string;
}

/** A liveness floor: `drain`'s hourly duty must not be lengthened by a quiet ledger. `health.ts`
 * builds drain's staleness budget from this same constant, so the budget exceeds the longest sleep
 * this default allows. */
export const DEFAULT_MAX_TICK_MS = 60 * 60 * 1000;
/** Stops a hot loop when a duty reports `now`. */
const DEFAULT_MIN_TICK_MS = 5_000;
/** Exported for `node-entry.ts`'s recovery path, which runs without `loadConfig` because the
 * configuration may be what is broken. */
export const DEFAULT_HTTP_PORT = 8080;
/** Port 80, where a phone lands by typing the box's bare address. Exported for recovery. */
export const DEFAULT_HTTP_LANDING_PORT = 80;
const DEFAULT_SPARE_STORE_PORT = 7443;
const DEFAULT_SPARE_STORE_LOOPBACK_PORT = 7444;
export const LOG_MAX_BYTES = 10_000_000;
export const LOG_MAX_FILES = 5;
/** Loopback, so an unconfigured box never binds a public interface. Exported for recovery. */
export const DEFAULT_HTTP_HOST = "127.0.0.1";
/** The highest port `net.Server.listen` accepts; above it `serve()` throws a raw `RangeError`
 * instead of `server.config_invalid`. Exported for the recovery path. */
export const MAX_HTTP_PORT = 65_535;
/** Loopback passkey defaults, outside production only (`requiredInProduction`). The origin is the
 * dashboard's Vite dev server. */
const DEFAULT_MANAGEMENT_RP_ID = "localhost";
const DEFAULT_MANAGEMENT_ORIGIN = "http://localhost:5191";

export interface DutyTimings {
  minTickMs: number;
  maxTickMs: number;
  skipRetryMs: number;
  /** Undefined lets the neutral layer apply its own seven days. */
  settlementLagMs: number | undefined;
  scheduler: SchedulerConfig;
}

export const DEFAULT_DUTY_TIMINGS: DutyTimings = {
  minTickMs: DEFAULT_MIN_TICK_MS,
  maxTickMs: DEFAULT_MAX_TICK_MS,
  skipRetryMs: DEFAULTS.skipRetryMs,
  settlementLagMs: undefined,
  scheduler: {
    horizonDays: DEFAULTS.horizonDays,
    maxPeriodsPerTick: DEFAULTS.maxPeriodsPerTick,
    maxAttempts: DEFAULTS.maxAttempts,
    backoffBaseMs: DEFAULTS.backoffBaseMs,
    staleAfterMs: DEFAULTS.staleAfterMs,
  },
};

export function resolveDutyTimings(
  override?: Partial<Omit<DutyTimings, "scheduler">> & { scheduler?: Partial<SchedulerConfig> },
): DutyTimings {
  const timings = {
    ...DEFAULT_DUTY_TIMINGS,
    ...override,
    scheduler: { ...DEFAULT_DUTY_TIMINGS.scheduler, ...override?.scheduler },
  };
  for (const [option, value] of Object.entries({
    minTickMs: timings.minTickMs,
    maxTickMs: timings.maxTickMs,
    skipRetryMs: timings.skipRetryMs,
    ...(timings.settlementLagMs === undefined ? {} : { settlementLagMs: timings.settlementLagMs }),
    ...Object.fromEntries(
      Object.entries(timings.scheduler).map(([key, value]) => [`scheduler.${key}`, value]),
    ),
  })) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`${option} must be a positive safe integer`);
  }
  if (timings.maxTickMs > 2_147_483_647) throw new Error("maxTickMs exceeds the timer limit");
  if (timings.minTickMs > timings.maxTickMs) throw new Error("minTickMs exceeds maxTickMs");
  if (timings.skipRetryMs < timings.minTickMs || timings.skipRetryMs > timings.maxTickMs) {
    throw new Error("skipRetryMs must be between minTickMs and maxTickMs");
  }
  return timings;
}

type Env = Record<string, string | undefined>;

function required(env: Env, variable: string): string {
  const value = env[variable];
  if (isUnset(value)) {
    throw new AppError("server.config_missing", { variable });
  }
  return value;
}

/**
 * An unset OR empty `raw` falls back to `fallback`; a set value is made absolute — never
 * `resolve("")`, which is the cwd. Shared so the callers' directory handling cannot drift.
 */
export function resolveConfigDir(raw: string | undefined, fallback: string): string {
  return isUnset(raw) ? fallback : resolve(raw);
}

/**
 * Optional outside production, falling back to the loopback `devDefault`; required in production,
 * where a passkey RP ID or origin left at `localhost` would fail every login with an opaque 401
 * rather than failing boot.
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

/** Whether `value` is a bare http(s) origin (`scheme://host[:port]`, nothing else): a till concatenates
 * paths onto it and a browser's `Origin` header is compared to it byte-for-byte. The round-trip
 * comparison also refuses an explicit default port, which a browser `Origin` never carries.
 * `""` is not a bare origin. */
export function isBareOrigin(value: string): boolean {
  const parsed = URL.parse(value);
  return (
    parsed !== null &&
    parsed.origin === value &&
    (parsed.protocol === "http:" || parsed.protocol === "https:")
  );
}

/** Takes a resolved value rather than `(env, variable)`, because the value may have come from a
 * fallback and must be reported under the variable the operator actually set. */
function bareOrigin(value: string, variable: string): string {
  if (!isBareOrigin(value)) {
    throw new AppError("server.config_invalid", { variable, reason: "not_an_origin" });
  }
  return value;
}

/** Account-action links carry a bearer token, so a non-loopback dashboard origin must use HTTPS. */
function secureManagementOrigin(value: string): string {
  const origin = bareOrigin(value, "WAITRON_MANAGEMENT_ORIGIN");
  const parsed = new URL(origin);
  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !loopback) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_MANAGEMENT_ORIGIN",
      reason: "https_required",
    });
  }
  return origin;
}

function loadTenantDomain(env: Env): string | undefined {
  const raw = env.WAITRON_TENANT_DOMAIN;
  if (isUnset(raw)) return undefined;
  if (/[/:\s]/.test(raw)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_TENANT_DOMAIN",
      reason: "not_a_domain",
    });
  }
  return raw.toLowerCase();
}

function parsePositiveInt(env: Env, variable: string): number | undefined {
  const raw = env[variable];
  if (isUnset(raw)) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AppError("server.config_invalid", { variable, reason: "not_a_positive_integer" });
  }
  return value;
}

// Exported so `backup-config.ts` validates its knobs by the same rule.
export function positiveInt(env: Env, variable: string, fallback: number): number {
  return parsePositiveInt(env, variable) ?? fallback;
}

/** A port a listener binds: `1..MAX_HTTP_PORT`. */
function listeningPort(env: Env, variable: string, fallback: number): number {
  const port = positiveInt(env, variable, fallback);
  if (port > MAX_HTTP_PORT) {
    throw new AppError("server.config_invalid", { variable, reason: "port_out_of_range" });
  }
  return port;
}

/** A port in `0..MAX_HTTP_PORT`, where `0` means "disabled", so not `positiveInt`. */
function boundedPort(env: Env, variable: string, fallback: number): number {
  const raw = env[variable];
  if (isUnset(raw)) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_HTTP_PORT) {
    throw new AppError("server.config_invalid", { variable, reason: "port_out_of_range" });
  }
  return value;
}

/**
 * Which environment this whole deployment belongs to — AEAT's endpoints, and the Stripe key mode
 * a tenant's credential must match. ONE setting, not one per provider: AEAT pre-production with a
 * live Stripe key takes real money without filing it; AEAT production with a test key files
 * invoices for money never taken.
 */
export function deploymentEnvironment(env: Env): DeploymentEnvironment {
  const environment = deploymentEnvironmentFor(env.WAITRON_ENV);
  if (environment === null) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ENV",
      reason: "not_a_deployment_environment",
    });
  }
  return environment;
}

/**
 * Whether this host runs in DEV mode: `WAITRON_ENV=dev` exactly, which gates the dev routes and the
 * dev device switcher. {@link deploymentEnvironment} maps `dev` to `preproduction`, so a host is
 * never both production and dev mode.
 */
export function isDevMode(env: Env): boolean {
  return env.WAITRON_ENV === "dev";
}

/** Parse the product intent and prove it agrees with the independently selected fiscal environment. */
function onboardingIntent(
  env: Env,
  environment: DeploymentEnvironment,
): OnboardingIntent | undefined {
  const raw = env.WAITRON_ONBOARDING_INTENT;
  if (isUnset(raw)) return undefined;
  if (raw !== "demo" && raw !== "prepare" && raw !== "live") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ONBOARDING_INTENT",
      reason: "not_an_onboarding_intent",
    });
  }
  const matches =
    raw === "live"
      ? environment === "production" || isDevMode(env)
      : environment === "preproduction";
  if (!matches) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_ONBOARDING_INTENT",
      reason: "intent_environment_mismatch",
    });
  }
  return raw;
}

function fiscalTestSubmissions(env: Env): boolean {
  const raw = env.WAITRON_FISCAL_TEST_SUBMISSIONS;
  if (isUnset(raw)) return false;
  if (raw !== "enabled") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_FISCAL_TEST_SUBMISSIONS",
      reason: "not_enabled",
    });
  }
  return true;
}

function paymentTestProviders(env: Env): boolean {
  const raw = env.WAITRON_PAYMENT_TEST_PROVIDERS;
  if (isUnset(raw)) return false;
  if (raw !== "enabled") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_PAYMENT_TEST_PROVIDERS",
      reason: "not_enabled",
    });
  }
  return true;
}

export function loadConfig(
  env: Env,
  defaultMigrationsRoot: string,
  defaultStateRoot: string,
): ServerConfig {
  const httpPort = listeningPort(env, "WAITRON_HTTP_PORT", DEFAULT_HTTP_PORT);
  const landingPort = boundedPort(env, "WAITRON_HTTP_LANDING_PORT", DEFAULT_HTTP_LANDING_PORT);
  const spareStorePort = listeningPort(env, "WAITRON_SPARE_STORE_PORT", DEFAULT_SPARE_STORE_PORT);
  if (spareStorePort === httpPort || spareStorePort === landingPort) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SPARE_STORE_PORT",
      reason: "listener_port_conflict",
    });
  }
  const spareStoreLoopbackPort = listeningPort(
    env,
    "WAITRON_SPARE_STORE_LOOPBACK_PORT",
    DEFAULT_SPARE_STORE_LOOPBACK_PORT,
  );
  if ([httpPort, landingPort, spareStorePort].includes(spareStoreLoopbackPort)) {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_SPARE_STORE_LOOPBACK_PORT",
      reason: "listener_port_conflict",
    });
  }
  const migrationsDir = env.WAITRON_MIGRATIONS_DIR;
  const stateDir = env.WAITRON_STATE_DIR;
  // Computed once so `venueDir` and `logDir` default under the returned `stateDir`.
  const resolvedStateDir = resolveConfigDir(stateDir, defaultStateRoot);
  const venueDir = resolveConfigDir(env.WAITRON_VENUE_DIR, join(resolvedStateDir, VENUE_DIR_NAME));
  const logDir = resolveLogDir(env, resolvedStateDir);
  assertOutsideScratch(resolvedStateDir, venueDir, "WAITRON_VENUE_DIR");
  assertOutsideScratch(resolvedStateDir, logDir, "WAITRON_LOG_DIR");
  const httpHost = env.WAITRON_HTTP_HOST;
  // A half-configured pair is refused rather than silently falling back to plain HTTP; the error
  // names the missing variable.
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
  const environment = deploymentEnvironment(env);
  const installationOrigin = env.WAITRON_INSTALLATION_ORIGIN;
  if (!isUnset(installationOrigin) && installationOrigin !== "usb") {
    throw new AppError("server.config_invalid", {
      variable: "WAITRON_INSTALLATION_ORIGIN",
      reason: "not_an_installation_origin",
    });
  }
  const managementRpId = requiredInProduction(
    env,
    "WAITRON_MANAGEMENT_RP_ID",
    environment,
    DEFAULT_MANAGEMENT_RP_ID,
  );
  const managementOrigin = secureManagementOrigin(
    requiredInProduction(env, "WAITRON_MANAGEMENT_ORIGIN", environment, DEFAULT_MANAGEMENT_ORIGIN),
  );
  const googleClientId = env.WAITRON_GOOGLE_CLIENT_ID;
  const googleClientSecret = env.WAITRON_GOOGLE_CLIENT_SECRET;
  const hasGoogleId = !isUnset(googleClientId);
  const hasGoogleSecret = !isUnset(googleClientSecret);
  if (hasGoogleId !== hasGoogleSecret) {
    throw new AppError("server.config_invalid", {
      variable: hasGoogleId ? "WAITRON_GOOGLE_CLIENT_SECRET" : "WAITRON_GOOGLE_CLIENT_ID",
      reason: "google_requires_client_id_and_secret",
    });
  }
  const staffOrigin = env.WAITRON_STAFF_ORIGIN;
  let staff: ServerConfig["staff"];
  if (!isUnset(staffOrigin)) {
    if (!isBareOrigin(staffOrigin) || new URL(staffOrigin).protocol !== "https:")
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_STAFF_ORIGIN",
        reason: "https_origin_required",
      });
    const port = listeningPort(env, "WAITRON_STAFF_PORT", 8443);
    if ([httpPort, landingPort, spareStorePort, spareStoreLoopbackPort].includes(port))
      throw new AppError("server.config_invalid", {
        variable: "WAITRON_STAFF_PORT",
        reason: "listener_port_conflict",
      });
    staff = {
      origin: staffOrigin,
      host: isUnset(env.WAITRON_STAFF_HOST) ? DEFAULT_HTTP_HOST : env.WAITRON_STAFF_HOST,
      port,
    };
  }
  return {
    ...(staff === undefined ? {} : { staff }),
    ...(installationOrigin === "usb" ? { installationOrigin } : {}),
    environment,
    devMode: isDevMode(env),
    onboardingIntent: onboardingIntent(env, environment),
    fiscalTestSubmissions: fiscalTestSubmissions(env),
    paymentTestProviders: paymentTestProviders(env),
    httpPort,
    landingPort,
    spareStorePort,
    spareStoreLoopbackPort,
    httpHost: isUnset(httpHost) ? DEFAULT_HTTP_HOST : httpHost,
    migrationsRoot: isUnset(migrationsDir) ? defaultMigrationsRoot : migrationsDir,
    litestreamBin: resolveLitestreamBin(env),
    versitygwBin: isUnset(env.WAITRON_VERSITYGW_BIN) ? "versitygw" : env.WAITRON_VERSITYGW_BIN,
    stateDir: resolvedStateDir,
    ...(isUnset(env.WAITRON_TUNNEL_CONTROL_DIR)
      ? {}
      : { tunnelControlDir: resolve(env.WAITRON_TUNNEL_CONTROL_DIR) }),
    venueDir,
    // Validated at load so a typo fails boot rather than minting a certificate for it.
    boxAddresses: parseBoxAddresses(env.WAITRON_BOX_ADDRESSES),
    logDir,
    ...(tls === undefined ? {} : { tls }),
    node: tryLoadNodeIdentity(env),
    tillApp: loadTillAppSettings(env),
    managementRpId,
    managementOrigin,
    ...(hasGoogleId && hasGoogleSecret
      ? {
          googleOidc: {
            clientId: googleClientId,
            clientSecret: googleClientSecret,
            redirectUri: `${managementOrigin}/management-api/google/callback`,
          },
        }
      : {}),
    tenantDomain: loadTenantDomain(env),
    tillAppDir: isUnset(env.WAITRON_TILL_APP_DIR) ? undefined : env.WAITRON_TILL_APP_DIR,
    dashboardAppDir: isUnset(env.WAITRON_DASHBOARD_APP_DIR)
      ? undefined
      : env.WAITRON_DASHBOARD_APP_DIR,
    setupAppDir: isUnset(env.WAITRON_SETUP_APP_DIR) ? undefined : env.WAITRON_SETUP_APP_DIR,
  };
}

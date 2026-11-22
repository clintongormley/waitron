export type BoxFile = "trading.env" | "secrets.env" | "backup.env";

export type VariableSource =
  | BoxFile
  | "image"
  | "compose"
  | "operator"
  | "build"
  | "command"
  | "internal"
  | "development"
  | "test";

export type VariableKind =
  "path" | "port" | "origin" | "url" | "text" | "choice" | "count" | "list" | "key";

export interface VariableSpec {
  readonly source: VariableSource;
  readonly kind: VariableKind;
  readonly readers: readonly string[];
  readonly default?: string;
  readonly rule?: string;
  readonly secret: boolean;
  readonly retiring?: string;
}

// Browser builds can remove the whole server inventory when readers do not import it.
/* @__NO_SIDE_EFFECTS__ */
function variable(
  source: VariableSource,
  kind: VariableKind,
  readers: readonly string[],
  details?: Partial<Pick<VariableSpec, "default" | "rule" | "secret" | "retiring">>,
): VariableSpec {
  return { source, kind, readers, secret: kind === "key", ...details };
}

const server = ["server"] as const;
const host = ["waitron.sh"] as const;
const compose = ["compose"] as const;
const dev = ["dev"] as const;
const tests = ["tests"] as const;
const release = ["release"] as const;
const lockedCopy = ["cloud-locked-entry"] as const;
const litestream = ["litestream"] as const;
const keyRing = ["server", "credentials", "provisioning"] as const;
const port = "1–65535";
const fi11 = { retiring: "A1308 fi11" } as const;
const google = { retiring: "A646 slice 8" } as const;
const unset = { default: "unset" } as const;
const secret = { secret: true } as const;

export const ENVIRONMENT_VARIABLES = {
  WAITRON_STATE_DIR: variable("image", "path", ["server", "print agent", "commands"], {
    default: "provided by the program",
  }),
  WAITRON_LOG_DIR: variable("image", "path", server, { default: "<state>/logs" }),
  WAITRON_HTTP_HOST: variable("image", "text", server, { default: "127.0.0.1" }),
  WAITRON_MIGRATIONS_DIR: variable("image", "path", server, {
    default: "the bundled drizzle directory",
  }),
  WAITRON_TILL_APP_DIR: variable("image", "path", server, unset),
  WAITRON_DASHBOARD_APP_DIR: variable("image", "path", server, unset),
  WAITRON_SETUP_APP_DIR: variable("image", "path", server, unset),
  WAITRON_DEMO_MEDIA_SOURCE: variable("image", "path", server, unset),
  WAITRON_LITESTREAM_BIN: variable("image", "path", ["server", "tests", "bench"], {
    default: "litestream from PATH",
  }),
  WAITRON_PRODUCER_NAME: variable("image", "text", ["server", "declaration"], {
    rule: "required in production with tax number and address, up to 200 characters",
  }),
  WAITRON_PRODUCER_TAX_ID: variable("image", "text", ["server", "declaration"], {
    rule: "required in production with name and address, up to 200 characters",
  }),
  WAITRON_PRODUCER_ADDRESS: variable("image", "text", ["server", "declaration"], {
    rule: "required in production with name and tax number, up to 200 characters",
  }),
  WAITRON_BUILD_ID: variable("build", "text", ["build", "server"], unset),
  WAITRON_SOURCE_METADATA: variable("build", "text", ["build"], unset),
  WAITRON_IMAGE_CREATED: variable("build", "text", ["build"], unset),
  WAITRON_IMAGE_REF: variable("build", "text", ["build"], unset),
  WAITRON_RELEASE_VERSION: variable("build", "text", ["build"], {
    rule: "a supported numbered release or prerelease version",
  }),
  WAITRON_BOX_ADDRESSES: variable("compose", "list", ["server", "print agent"], {
    rule: "comma-separated IPv4 addresses",
  }),
  WAITRON_MANAGEMENT_RP_ID: variable("compose", "text", server, {
    default: "localhost outside production",
    rule: "required in production",
  }),
  WAITRON_MANAGEMENT_ORIGIN: variable("compose", "origin", server, {
    default: "http://localhost:5191 outside production",
    rule: "required in production, HTTPS outside loopback",
  }),
  WAITRON_INSTALLATION_ORIGIN: variable("compose", "choice", server, { rule: "usb" }),
  WAITRON_CLOUD_ORIGIN: variable("compose", "origin", server, {
    rule: "HTTPS, or HTTP loopback in dev",
  }),
  WAITRON_IMAGE: variable("compose", "text", ["compose", "waitron.sh"]),
  WAITRON_PRINT_AGENT_IMAGE: variable("compose", "text", ["compose", "waitron.sh"]),
  WAITRON_PRINT_AGENT_APPARMOR: variable("compose", "text", compose, { default: "docker-default" }),
  WAITRON_BOX_SOCKET_DIR: variable("compose", "path", compose),
  WAITRON_TUNNEL_CONTROL_DIR: variable("compose", "path", server, unset),
  WAITRON_TUNNEL_IMAGE: variable("compose", "text", ["compose", "waitron.sh"]),
  WAITRON_STAFF_SOCKET: variable("compose", "path", server, unset),
  WAITRON_TEST_CLOUD_SIGN_IN_CALLBACK: variable("compose", "url", server, {
    rule: "HTTPS, outside production only",
  }),
  WAITRON_HTTP_PORT: variable("operator", "port", ["server", "print agent development"], {
    default: "8080",
    rule: port,
  }),
  WAITRON_HTTP_LANDING_PORT: variable("operator", "port", server, {
    default: "80",
    rule: "0 disables the listener, otherwise 1–65535",
  }),
  WAITRON_TLS_CERT_FILE: variable("operator", "path", server, { rule: "set with the TLS key" }),
  WAITRON_TLS_KEY_FILE: variable("operator", "path", server, {
    rule: "set with the TLS certificate",
  }),
  WAITRON_VENUE_DOMAIN: variable("operator", "text", server, {
    rule: "domain without a scheme or port",
  }),
  WAITRON_FISCAL_TEST_SUBMISSIONS: variable("operator", "choice", server, {
    default: "off",
    rule: "enabled",
  }),
  WAITRON_DIR: variable("operator", "path", host, { default: "/opt/waitron" }),
  WAITRON_HOST_DIR: variable(
    "operator",
    "path",
    ["waitron.sh", "waitron-box.sh", "upgrade-restart"],
    { default: "/opt/waitron-host" },
  ),
  WAITRON_SH_REFRESHED: variable("operator", "choice", host),
  WAITRON_STAFF_PORT: variable("operator", "port", server, { default: "8443", rule: port }),
  WAITRON_STAFF_HOST: variable("operator", "text", server, { default: "127.0.0.1" }),
  WAITRON_SPARE_STORE_PORT: variable("operator", "port", server, {
    default: "7443",
    rule: "1–65535, distinct from HTTP and landing ports",
  }),
  WAITRON_SPARE_STORE_LOOPBACK_PORT: variable("operator", "port", server, {
    default: "7444",
    rule: "1–65535, distinct from other listener ports",
  }),
  WAITRON_NODE_ID: variable("trading.env", "text", ["server", "restore", "rejoin", "waitron.sh"]),
  WAITRON_ENV: variable(
    "trading.env",
    "choice",
    ["server", "restore", "provisioning", "waitron.sh"],
    { default: "preproduction", rule: "preproduction, production or dev" },
  ),
  WAITRON_ONBOARDING_INTENT: variable("trading.env", "choice", server, {
    rule: "demo, prepare or live, matching the deployment environment",
  }),
  WAITRON_CREDENTIALS_KEY: variable("secrets.env", "key", keyRing, {
    rule: "32 bytes in base64",
  }),
  WAITRON_CREDENTIALS_KEY_VERSION: variable("secrets.env", "count", keyRing, {
    default: "1",
    rule: "positive integer",
  }),
  WAITRON_CREDENTIALS_KEY_PREVIOUS: variable("secrets.env", "key", keyRing, {
    rule: "32 bytes in base64, set with the previous version",
  }),
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: variable("secrets.env", "count", keyRing, {
    rule: "positive integer distinct from the current version",
  }),
  WAITRON_BACKUP_RECOVERY_KEY: variable("backup.env", "key", ["server", "restore"]),
  WAITRON_BACKUP_KEY_ROTATED_AT: variable("backup.env", "text", server),
  WAITRON_BREAKGLASS_PASSWORD: variable("command", "text", ["break-glass"], secret),
  WAITRON_BREAKGLASS_PIN: variable("command", "text", ["break-glass"], secret),
  WAITRON_NODE_RECOVERY_KEY: variable("command", "key", ["server", "restore", "rejoin"]),
  WAITRON_RECOVERY_OPERATION_FILE: variable("command", "path", server),
  WAITRON_ADMIN_PIN: variable("command", "text", ["provisioning"], secret),
  WAITRON_ADMIN_PASSWORD: variable("command", "text", ["provisioning"], secret),
  WAITRON_INITIAL_VENUE_INPUT: variable("command", "path", ["provisioning"]),
  WAITRON_SETUP_SETTINGS_FILE: variable("command", "path", ["provisioning"]),
  WAITRON_LOCKED_COPY: variable("internal", "text", lockedCopy, {
    secret: true,
    rule: "JSON launch object with copy binding and Cloud credentials",
  }),
  WAITRON_LOCKED_TOTP_KEYS: variable("internal", "key", lockedCopy, {
    rule: "JSON purpose-key payload",
  }),
  WAITRON_STREAM_ACCESS_KEY_ID: variable("internal", "key", litestream),
  WAITRON_STREAM_SECRET_ACCESS_KEY: variable("internal", "key", litestream),
  WAITRON_STREAM_ENCRYPTION_KEY: variable("internal", "key", litestream),
  WAITRON_PRODUCER_CHANGE_ALLOWED: variable("build", "text", ["CI"], {
    rule: "tax number the publish job permits",
  }),
  WAITRON_RELEASE_SIGNING_KEY: variable("build", "key", release, {
    rule: "the trusted Ed25519 private key",
  }),
  WAITRON_VENUE_DIR: variable("development", "path", ["server", "dev", "commands"], {
    default: "<state>/venue",
  }),
  WAITRON_TILL_VITE_PORT: variable("development", "port", dev),
  WAITRON_DASHBOARD_VITE_PORT: variable("development", "port", dev),
  WAITRON_SETUP_VITE_PORT: variable("development", "port", dev),
  WAITRON_DEV_ENV_FILE: variable("development", "path", dev),
  WAITRON_DEV_HOUR_RELEASE: variable("development", "text", dev),
  WAITRON_DEMO_REGION: variable("development", "choice", dev),
  WAITRON_SEED_LOCALE: variable("development", "choice", dev),
  WAITRON_SEED_SALES_DAYS: variable("development", "count", dev),
  WAITRON_BENCH_ACCESS_KEY_ID: variable("test", "key", ["bench"]),
  WAITRON_BENCH_SECRET_ACCESS_KEY: variable("test", "key", ["bench"]),
  WAITRON_VERSITYGW_BIN: variable("test", "path", ["server", "tests"], {
    default: "versitygw from PATH",
  }),
  WAITRON_REQUIRE_TEST_TOOLS: variable("test", "choice", tests),
  WAITRON_LARGE_CLOUD_BACKUP_TEST: variable("test", "choice", tests, {
    rule: "1 runs the large backup cases",
  }),
  WAITRON_LARGE_CLOUD_BACKUP_BASELINE: variable("test", "choice", tests, {
    rule: "1 runs the baseline upload measurement",
  }),
  WAITRON_FULL_DISK_ROOT: variable("test", "path", tests),
  WAITRON_TEST_HOST_ROOT: variable("test", "path", ["waitron.sh", "waitron-box.sh"]),
  WAITRON_TEST_HEALTH_TRIES: variable("test", "count", host),
  WAITRON_TEST_HEALTH_DELAY: variable("test", "count", host),
  WAITRON_TEST_READ_SECONDS: variable("test", "count", ["waitron-box.sh"]),
  WAITRON_TEST_TRACE_FILES: variable("test", "choice", tests),
  WAITRON_TEST_CRASH_AT: variable("test", "text", tests),
  WAITRON_PRE_PUSH_FETCH_SECONDS: variable("test", "count", ["pre-push"]),
  WAITRON_STARTUP_ENGINES: variable("test", "list", ["bench"]),
  WAITRON_WRITE_GOLDEN: variable("test", "choice", tests),
  WAITRON_CERT_CHECK_PFX_BASE64: variable("test", "key", tests),
  WAITRON_CERT_CHECK_PASSPHRASE: variable("test", "text", tests, secret),
  WAITRON_CERT_CHECK_KIND: variable("test", "choice", tests),
  WAITRON_CERT_CHECK_ENVIRONMENT: variable("test", "choice", tests),
  WAITRON_CERT_CHECK_NIF: variable("test", "text", tests, secret),
  WAITRON_CERT_CHECK_LEGAL_NAME: variable("test", "text", tests, secret),
  WAITRON_CERT_CHECK_ADDRESS_KIND: variable("test", "choice", tests),
  WAITRON_INTERRUPT_FACTS: variable("test", "path", tests),
  WAITRON_INTERRUPT_ENDPOINT: variable("test", "url", tests),
  WAITRON_INTERRUPT_RECEIPT_DIR: variable("test", "path", tests),
  WAITRON_RUN_AWS_REHEARSAL: variable("test", "choice", tests),
  WAITRON_AWS_REHEARSAL_BUCKET: variable("test", "text", tests),
  WAITRON_AWS_REHEARSAL_RECEIPT_DIR: variable("test", "path", tests),
  WAITRON_GOOGLE_CLIENT_ID: variable("operator", "text", server, google),
  WAITRON_GOOGLE_CLIENT_SECRET: variable("operator", "key", server, google),
  WAITRON_FISCAL_CLOUD_FINGERPRINT: variable("operator", "text", ["VeriFactu"], fi11),
  WAITRON_FISCAL_CLOUD_RECEIPT_DIRECTORY: variable("operator", "path", ["VeriFactu"], fi11),
  WAITRON_FISCAL_CLOUD_TRUST_FILE: variable("operator", "path", ["VeriFactu"], fi11),
  WAITRON_FISCAL_CONFIRMATION_FILE: variable("operator", "path", ["VeriFactu"], fi11),
  WAITRON_FISCAL_CUSTODIAN_FILE: variable("operator", "path", ["VeriFactu"], fi11),
  WAITRON_FISCAL_CUSTODIAN_FINGERPRINT: variable("operator", "text", ["VeriFactu"], fi11),
  WAITRON_FISCAL_EMERGENCY_DIRECTORY: variable("operator", "path", ["VeriFactu"], fi11),
  WAITRON_FISCAL_PAPER_HISTORY_FILE: variable("operator", "path", ["VeriFactu"], fi11),
} as const;

export type EnvironmentVariableName = keyof typeof ENVIRONMENT_VARIABLES;

export const PRINT_AGENT_ONLY_NAMES = [
  "WAITRON_PRINT_AGENT_SERVER_URL",
  "WAITRON_PRINT_AGENT_SETUP_URL",
  "WAITRON_SETUP_PORT",
] as const;

export function readVariable(
  env: Readonly<Record<string, string | undefined>>,
  name: EnvironmentVariableName,
): string | undefined {
  return env[name];
}

/* @__NO_SIDE_EFFECTS__ */
function namesFor(file: BoxFile): EnvironmentVariableName[] {
  const names = Object.keys(ENVIRONMENT_VARIABLES) as EnvironmentVariableName[];
  return names.filter((name) => ENVIRONMENT_VARIABLES[name].source === file).sort();
}

export const BOX_FILE_VARIABLES: Readonly<Record<BoxFile, readonly EnvironmentVariableName[]>> = {
  "trading.env": namesFor("trading.env"),
  "secrets.env": namesFor("secrets.env"),
  "backup.env": namesFor("backup.env"),
};

export function unknownVariables(
  env: Readonly<Record<string, string | undefined>>,
  alsoKnown: readonly string[] = [],
): string[] {
  return Object.keys(env)
    .filter(
      (name) =>
        name.startsWith("WAITRON_") &&
        !Object.hasOwn(ENVIRONMENT_VARIABLES, name) &&
        !alsoKnown.includes(name),
    )
    .sort();
}

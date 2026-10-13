import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isUnset } from "../env-value.js";

export const AWS_REHEARSAL_PROFILE = "waitron-rehearsal";

export const AWS_REHEARSAL_LIMITS = {
  archiveBytes: 32 * 1024 * 1024,
  deleteObjects: 1005,
  uploadedBytes: 128 * 1024 * 1024,
  denialControlMs: 60_000,
  teardownMs: 120_000,
} as const;

export type AwsRehearsalRefusalReason =
  | "opt-in-missing"
  | "profile-mismatch"
  | "variable-unset"
  | "file-not-absolute"
  | "file-inside-repository"
  | "profile-section-missing"
  | "credentials-missing"
  | "session-token-unsupported"
  | "provider-unsupported"
  | "region-mismatch";

/** Its message names a rule and a variable or key, never a value read from the environment or a file. */
export class AwsRehearsalRefused extends Error {
  constructor(
    readonly reason: AwsRehearsalRefusalReason,
    detail: string,
  ) {
    super(`AWS rehearsal refused (${reason}): ${detail}`);
    this.name = "AwsRehearsalRefused";
  }
}

export interface RehearsalProfile {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface RehearsalProfileDeps {
  readFile(path: string): Promise<string>;
}

type Env = Readonly<Record<string, string | undefined>>;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const UNSUPPORTED_PROVIDER_KEYS = [
  "role_arn",
  "credential_process",
  "sso_session",
  "sso_start_url",
];

export function assertRehearsalOptIn(env: Env): void {
  if (env.WAITRON_RUN_AWS_REHEARSAL !== "1") {
    throw new AwsRehearsalRefused(
      "opt-in-missing",
      'WAITRON_RUN_AWS_REHEARSAL must be exactly "1"',
    );
  }
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (isUnset(value)) throw new AwsRehearsalRefused("variable-unset", `${name} must be set`);
  return value;
}

function outsideRepository(env: Env, name: string): string {
  const path = required(env, name);
  if (!isAbsolute(path))
    throw new AwsRehearsalRefused("file-not-absolute", `${name} must be an absolute path`);
  const fromRoot = relative(REPOSITORY_ROOT, resolve(path));
  if (fromRoot === "" || (!fromRoot.startsWith("..") && !isAbsolute(fromRoot))) {
    throw new AwsRehearsalRefused(
      "file-inside-repository",
      `${name} must be outside the repository`,
    );
  }
  return path;
}

function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let current: Map<string, string> | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[\s*(.+?)\s*\]$/.exec(line);
    if (header) {
      const name = header[1]!.replace(/\s+/g, " ");
      current = sections.get(name) ?? new Map<string, string>();
      sections.set(name, current);
      continue;
    }
    const equals = line.indexOf("=");
    if (current === undefined || equals < 0) continue;
    current.set(line.slice(0, equals).trim().toLowerCase(), line.slice(equals + 1).trim());
  }
  return sections;
}

function section(text: string, name: string, variable: string): Map<string, string> {
  const found = parseIni(text).get(name);
  if (found === undefined) {
    throw new AwsRehearsalRefused(
      "profile-section-missing",
      `${variable} has no [${name}] section`,
    );
  }
  for (const key of UNSUPPORTED_PROVIDER_KEYS) {
    if (found.has(key))
      throw new AwsRehearsalRefused(
        "provider-unsupported",
        `${key} in ${variable} is not supported`,
      );
  }
  if (found.has("aws_session_token")) {
    throw new AwsRehearsalRefused(
      "session-token-unsupported",
      `aws_session_token in ${variable}: temporary credentials are not supported`,
    );
  }
  return found;
}

export async function loadRehearsalProfile(
  env: Env,
  deps: RehearsalProfileDeps,
): Promise<RehearsalProfile> {
  assertRehearsalOptIn(env);
  if (env.AWS_PROFILE !== AWS_REHEARSAL_PROFILE) {
    throw new AwsRehearsalRefused(
      "profile-mismatch",
      `AWS_PROFILE must be ${AWS_REHEARSAL_PROFILE}`,
    );
  }
  const region = required(env, "AWS_REGION");
  const credentialsPath = outsideRepository(env, "AWS_SHARED_CREDENTIALS_FILE");
  const configPath = outsideRepository(env, "AWS_CONFIG_FILE");

  const credentials = section(
    await deps.readFile(credentialsPath),
    AWS_REHEARSAL_PROFILE,
    "AWS_SHARED_CREDENTIALS_FILE",
  );
  const config = section(
    await deps.readFile(configPath),
    `profile ${AWS_REHEARSAL_PROFILE}`,
    "AWS_CONFIG_FILE",
  );

  const accessKeyId = credentials.get("aws_access_key_id");
  const secretAccessKey = credentials.get("aws_secret_access_key");
  for (const [key, value] of [
    ["aws_access_key_id", accessKeyId],
    ["aws_secret_access_key", secretAccessKey],
  ] as const) {
    if (isUnset(value)) throw new AwsRehearsalRefused("credentials-missing", `${key} must be set`);
  }
  if (config.get("region") !== region) {
    throw new AwsRehearsalRefused(
      "region-mismatch",
      "region in AWS_CONFIG_FILE must equal AWS_REGION",
    );
  }
  return { region, accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! };
}

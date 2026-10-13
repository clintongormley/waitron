import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AWS_REHEARSAL_LIMITS,
  AWS_REHEARSAL_PROFILE,
  AwsRehearsalRefused,
  assertRehearsalOptIn,
  loadRehearsalProfile,
} from "./aws-rehearsal.js";

const KEY_ID = "AKIAFIXTUREKEYID0001";
const SECRET = "fixtureSecret/Value+Not=Real0123456789";
const SESSION = "FixtureSessionTokenValue";
const ROLE = "arn:aws:iam::123456789012:role/fixture-role";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

const CREDENTIALS = `[default]
aws_access_key_id = OTHERKEY
aws_secret_access_key = othersecret

[waitron-rehearsal]
aws_access_key_id = ${KEY_ID}
aws_secret_access_key = ${SECRET}
`;

const CONFIG = `# fixture
[profile waitron-rehearsal]
region = eu-north-1
output = json
`;

let dir: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aws-rehearsal-profile-"));
  credentialsFile = join(dir, "credentials");
  configFile = join(dir, "config");
  await writeFile(credentialsFile, CREDENTIALS);
  await writeFile(configFile, CONFIG);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function env(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    WAITRON_RUN_AWS_REHEARSAL: "1",
    AWS_PROFILE: "waitron-rehearsal",
    AWS_SHARED_CREDENTIALS_FILE: credentialsFile,
    AWS_CONFIG_FILE: configFile,
    AWS_REGION: "eu-north-1",
    ...overrides,
  };
}

const deps = { readFile: (path: string) => readFile(path, "utf8") };

async function refusal(promise: Promise<unknown>): Promise<AwsRehearsalRefused> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AwsRehearsalRefused);
  const message = (error as Error).message;
  for (const secret of [KEY_ID, SECRET, SESSION, ROLE, dir]) expect(message).not.toContain(secret);
  return error as AwsRehearsalRefused;
}

describe("assertRehearsalOptIn", () => {
  it.each([undefined, "", "0", "true", " 1"])("refuses opt-in %j", (value) => {
    expect(() => assertRehearsalOptIn({ WAITRON_RUN_AWS_REHEARSAL: value })).toThrow(
      AwsRehearsalRefused,
    );
  });

  it("accepts exactly 1", () => {
    expect(() => assertRehearsalOptIn({ WAITRON_RUN_AWS_REHEARSAL: "1" })).not.toThrow();
  });
});

describe("loadRehearsalProfile", () => {
  it("exposes the agreed profile name and limits", () => {
    expect(AWS_REHEARSAL_PROFILE).toBe("waitron-rehearsal");
    expect(AWS_REHEARSAL_LIMITS).toEqual({
      archiveBytes: 32 * 1024 * 1024,
      deleteObjects: 1005,
      uploadedBytes: 128 * 1024 * 1024,
      denialControlMs: 60_000,
      teardownMs: 120_000,
    });
  });

  it("returns the region and static key pair", async () => {
    await expect(loadRehearsalProfile(env(), deps)).resolves.toEqual({
      region: "eu-north-1",
      accessKeyId: KEY_ID,
      secretAccessKey: SECRET,
    });
  });

  it("refuses without opt-in before reading any file", async () => {
    const readSpy = vi.fn(deps.readFile);
    const error = await refusal(
      loadRehearsalProfile(env({ WAITRON_RUN_AWS_REHEARSAL: undefined }), { readFile: readSpy }),
    );
    expect(error.reason).toBe("opt-in-missing");
    expect(error.message).toContain("WAITRON_RUN_AWS_REHEARSAL");
    expect(readSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["AWS_PROFILE absent", { AWS_PROFILE: undefined }, "profile-mismatch", "AWS_PROFILE"],
    ["AWS_PROFILE wrong", { AWS_PROFILE: "default" }, "profile-mismatch", "AWS_PROFILE"],
    ["AWS_REGION empty", { AWS_REGION: "" }, "variable-unset", "AWS_REGION"],
    [
      "credentials file unset",
      { AWS_SHARED_CREDENTIALS_FILE: "" },
      "variable-unset",
      "AWS_SHARED_CREDENTIALS_FILE",
    ],
    ["config file unset", { AWS_CONFIG_FILE: undefined }, "variable-unset", "AWS_CONFIG_FILE"],
    [
      "relative credentials file",
      { AWS_SHARED_CREDENTIALS_FILE: "credentials" },
      "file-not-absolute",
      "AWS_SHARED_CREDENTIALS_FILE",
    ],
    [
      "credentials file inside the repository",
      { AWS_SHARED_CREDENTIALS_FILE: join(REPO_ROOT, "apps/server/credentials") },
      "file-inside-repository",
      "AWS_SHARED_CREDENTIALS_FILE",
    ],
    [
      "config file at the repository root",
      { AWS_CONFIG_FILE: join(REPO_ROOT, "aws-config") },
      "file-inside-repository",
      "AWS_CONFIG_FILE",
    ],
  ])("refuses %s before reading", async (_label, overrides, reason, name) => {
    const readSpy = vi.fn(deps.readFile);
    const error = await refusal(loadRehearsalProfile(env(overrides), { readFile: readSpy }));
    expect(error.reason).toBe(reason);
    expect(error.message).toContain(name);
    expect(readSpy).not.toHaveBeenCalled();
  });

  it.each([
    [
      "missing credentials section",
      "[default]\naws_access_key_id = x\naws_secret_access_key = y\n",
      CONFIG,
      "profile-section-missing",
      "waitron-rehearsal",
    ],
    [
      "missing secret",
      `[waitron-rehearsal]\naws_access_key_id = ${KEY_ID}\n`,
      CONFIG,
      "credentials-missing",
      "aws_secret_access_key",
    ],
    [
      "empty key id",
      `[waitron-rehearsal]\naws_access_key_id =\naws_secret_access_key = ${SECRET}\n`,
      CONFIG,
      "credentials-missing",
      "aws_access_key_id",
    ],
    [
      "session token",
      `${CREDENTIALS}aws_session_token = ${SESSION}\n`,
      CONFIG,
      "session-token-unsupported",
      "aws_session_token",
    ],
    [
      "missing config section",
      CREDENTIALS,
      "[profile other]\nregion = eu-north-1\n",
      "profile-section-missing",
      "profile waitron-rehearsal",
    ],
    [
      "role_arn",
      CREDENTIALS,
      `${CONFIG}role_arn = ${ROLE}\nsource_profile = default\n`,
      "provider-unsupported",
      "role_arn",
    ],
    [
      "credential_process",
      CREDENTIALS,
      `${CONFIG}credential_process = /bin/echo ${SECRET}\n`,
      "provider-unsupported",
      "credential_process",
    ],
    [
      "sso_session",
      CREDENTIALS,
      `${CONFIG}sso_session = fixture\n`,
      "provider-unsupported",
      "sso_session",
    ],
    [
      "sso_start_url",
      CREDENTIALS,
      `${CONFIG}sso_start_url = https://example.awsapps.com/start\n`,
      "provider-unsupported",
      "sso_start_url",
    ],
    [
      "region mismatch",
      CREDENTIALS,
      "[profile waitron-rehearsal]\nregion = us-east-1\n",
      "region-mismatch",
      "region",
    ],
    [
      "region missing",
      CREDENTIALS,
      "[profile waitron-rehearsal]\noutput = json\n",
      "region-mismatch",
      "region",
    ],
  ])("refuses %s", async (_label, credentials, config, reason, name) => {
    await writeFile(credentialsFile, credentials);
    await writeFile(configFile, config);
    const error = await refusal(loadRehearsalProfile(env(), deps));
    expect(error.reason).toBe(reason);
    expect(error.message).toContain(name);
  });
});

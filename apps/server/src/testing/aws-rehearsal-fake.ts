// The in-memory Amazon S3 admin client and profile files the rehearsal's unit suites share.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { AdminClient, AwsRehearsalDeps } from "./aws-rehearsal.js";
import type { RehearsalJournal } from "./aws-rehearsal-journal.js";
import { AWS_REHEARSAL_NONCE_KEY } from "./aws-request-plan.js";

export const KEY_ID = "AKIAFIXTUREKEYID0001";
export const SECRET = "fixtureSecretValueNotReal0123456789abcd";
export const SUFFIX = "abc123def456";
export const BUCKET = `waitron-rehearsal-waitron-${SUFFIX}`;
export const RUN_ID = "run-0001";
export const NONCE = AWS_REHEARSAL_NONCE_KEY;
export const START_TIME = "Wed Oct 14 10:00:00 2026";

export const CREDENTIALS = `[waitron-rehearsal]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\n`;
export const CONFIG = "[profile waitron-rehearsal]\nregion = eu-north-1\n";

export interface Call {
  name: string;
  input: Record<string, unknown>;
  signal: AbortSignal | undefined;
}

export type Answer = (input: Record<string, unknown>, fake: FakeAdmin) => unknown;

export function sdkError(name: string, status: number | undefined, attempts = 1): Error {
  return Object.assign(new Error(`raw SDK detail ${SECRET}`), {
    name,
    $metadata: status === undefined ? {} : { httpStatusCode: status, attempts },
  });
}

export const ok = (status = 200) => ({ $metadata: { httpStatusCode: status, attempts: 1 } });

export function body(text: string) {
  return { ...ok(), Body: { transformToString: async () => text } };
}

export interface FakeAdminOptions {
  answers?: Record<string, Answer>;
  /** Starting objects, key to body. */
  objects?: Iterable<[string, string]>;
  /** Starting unfinished uploads, upload id to key. */
  uploads?: Iterable<[string, string]>;
  /** Keys per ListObjectsV2 page. */
  pageSize?: number;
  /** Uploads per ListMultipartUploads page. */
  uploadsPageSize?: number;
}

/** An admin client that keeps an in-memory bucket and records every command it is sent. */
export class FakeAdmin implements AdminClient {
  readonly calls: Call[] = [];
  readonly objects: Map<string, string>;
  readonly uploads: Map<string, string>;
  readonly answers: Record<string, Answer>;
  private readonly pageSize: number;
  private readonly uploadsPageSize: number;

  constructor(options: FakeAdminOptions = {}) {
    this.objects = new Map(options.objects);
    this.uploads = new Map(options.uploads);
    this.pageSize = options.pageSize ?? 1000;
    this.uploadsPageSize = options.uploadsPageSize ?? 1000;
    this.answers = { ...this.defaults(), ...options.answers };
  }

  async send(command: object, options?: { abortSignal?: AbortSignal }): Promise<unknown> {
    const name = command.constructor.name.replace(/Command$/, "");
    const input = (command as { input: Record<string, unknown> }).input;
    this.calls.push({ name, input, signal: options?.abortSignal });
    const answer = this.answers[name];
    if (answer === undefined) throw new Error(`fake has no answer for ${name}`);
    return answer(input, this);
  }

  names(): string[] {
    return this.calls.map((call) => call.name);
  }

  private defaults(): Record<string, Answer> {
    return {
      CreateBucket: () => ok(),
      GetObject: (input) => {
        const text = this.objects.get(input.Key as string);
        if (text === undefined) throw sdkError("NoSuchKey", 404);
        return body(text);
      },
      PutObject: (input) => {
        this.objects.set(input.Key as string, String(input.Body));
        return ok();
      },
      GetBucketEncryption: () => ({
        ...ok(),
        ServerSideEncryptionConfiguration: {
          Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } }],
        },
      }),
      GetBucketVersioning: () => ok(),
      ListMultipartUploads: (input) => {
        const prefix = (input.Prefix as string | undefined) ?? "";
        const listed = [...this.uploads]
          .filter(([, key]) => key.startsWith(prefix))
          .map(([UploadId, Key]) => ({ Key, UploadId }));
        const after =
          input.KeyMarker === undefined
            ? 0
            : listed.findIndex(
                (u) => u.Key === input.KeyMarker && u.UploadId === input.UploadIdMarker,
              ) + 1;
        const page = listed.slice(after, after + this.uploadsPageSize);
        const last = page.at(-1);
        const truncated = after + this.uploadsPageSize < listed.length;
        return {
          ...ok(),
          IsTruncated: truncated,
          Uploads: page,
          ...(truncated && last !== undefined
            ? { NextKeyMarker: last.Key, NextUploadIdMarker: last.UploadId }
            : {}),
        };
      },
      AbortMultipartUpload: (input) => {
        if (!this.uploads.delete(input.UploadId as string)) throw sdkError("NoSuchUpload", 404);
        return ok(204);
      },
      DeleteBucketPolicy: () => ok(204),
      ListObjectsV2: (input) => {
        const keys = [...this.objects.keys()].sort();
        const start = input.ContinuationToken === undefined ? 0 : Number(input.ContinuationToken);
        const next = start + this.pageSize;
        return {
          ...ok(),
          Contents: keys.slice(start, next).map((Key) => ({ Key })),
          IsTruncated: next < keys.length,
          ...(next < keys.length ? { NextContinuationToken: String(next) } : {}),
        };
      },
      DeleteObjects: (input) => {
        const objects = (input.Delete as { Objects: { Key: string }[] }).Objects;
        for (const { Key } of objects) this.objects.delete(Key);
        return { ...ok(), Deleted: objects };
      },
      DeleteObject: (input) => {
        this.objects.delete(input.Key as string);
        return ok(204);
      },
      DeleteBucket: () => {
        if (this.objects.size > 0) throw sdkError("BucketNotEmpty", 409);
        return ok(204);
      },
    };
  }
}

export interface ProfileFiles {
  dir: string;
  credentialsFile: string;
  configFile: string;
}

/** A fresh temporary folder holding a credentials file and a config file; the caller removes it. */
export async function writeProfileFiles(
  prefix: string,
  credentials = CREDENTIALS,
  config = CONFIG,
): Promise<ProfileFiles> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const credentialsFile = join(dir, "credentials");
  const configFile = join(dir, "config");
  await writeFile(credentialsFile, credentials);
  await writeFile(configFile, config);
  return { dir, credentialsFile, configFile };
}

export function profileEnv(
  files: Pick<ProfileFiles, "credentialsFile" | "configFile">,
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    WAITRON_RUN_AWS_REHEARSAL: "1",
    AWS_PROFILE: "waitron-rehearsal",
    AWS_SHARED_CREDENTIALS_FILE: files.credentialsFile,
    AWS_CONFIG_FILE: files.configFile,
    AWS_REGION: "eu-north-1",
    ...overrides,
  };
}

export interface FakeHarness {
  fake: FakeAdmin;
  deps: Partial<AwsRehearsalDeps>;
  printed: string[];
  /** A copy of every journal the run wrote, in order. */
  journals: RehearsalJournal[];
  readFile: ReturnType<typeof vi.fn>;
  createAdminClient: ReturnType<typeof vi.fn>;
}

/** Dependencies that read real files, hand out `fake`, tick a clock 5 ms a call and record prints and journals. */
export function fakeHarness(
  fake: FakeAdmin,
  env: NodeJS.ProcessEnv,
  startsAt: string,
): FakeHarness {
  const printed: string[] = [];
  const journals: RehearsalJournal[] = [];
  const readFileSpy = vi.fn((path: string) => readFile(path, "utf8"));
  const createAdminClient = vi.fn(() => fake);
  let clock = Date.parse(startsAt);
  return {
    fake,
    printed,
    journals,
    readFile: readFileSpy,
    createAdminClient,
    deps: {
      env,
      readFile: readFileSpy,
      createAdminClient,
      now: () => (clock += 5),
      commit: () => "0123456789abcdef",
      sleep: async () => {},
      print: (line) => printed.push(line),
      journal: (_dir, journal) => {
        journals.push(structuredClone(journal));
      },
      processStartTime: () => START_TIME,
      // No keeper process: these suites start none.
      startKeeper: async () => ({ keeperPid: null, end: () => {} }),
      // These suites' scenarios send only through the runner's own admin client.
      apis: [],
    },
  };
}

/** The error `promise` rejects with; throws if it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (thrown: unknown) => thrown as Error,
  );
}

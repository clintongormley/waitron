import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCleanupArgs, runCleanup } from "../../scripts/aws-rehearsal-cleanup.js";
import { type AwsReceipt, cleanupCommandFor } from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  type AdminClient,
  type AwsRehearsalDeps,
  cleanupFromReceipt,
} from "./aws-rehearsal.js";

const KEY_ID = "AKIAFIXTUREKEYID0001";
const SECRET = "fixtureSecretValueNotReal0123456789abcd";
const BUCKET = "waitron-rehearsal-waitron-abc123def456";
const RUN_ID = "run-0001";
const NONCE = ".waitron-rehearsal-owner";
const DELETES = ["AbortMultipartUpload", "DeleteBucketPolicy", "DeleteObjects", "DeleteObject"];
const DELETES_AND_BUCKET = [...DELETES, "DeleteBucket"];

interface Call {
  name: string;
  input: Record<string, unknown>;
}

type Answer = (input: Record<string, unknown>, fake: FakeAdmin) => unknown;

function sdkError(name: string, status: number): Error {
  return Object.assign(new Error(`raw SDK detail ${SECRET}`), {
    name,
    $metadata: { httpStatusCode: status, attempts: 1 },
  });
}

const ok = (status = 200) => ({ $metadata: { httpStatusCode: status, attempts: 1 } });

function body(text: string) {
  return { ...ok(), Body: { transformToString: async () => text } };
}

/** A bucket left behind by a run: its marker, two objects and one unfinished upload. */
class FakeAdmin implements AdminClient {
  readonly calls: Call[] = [];
  readonly objects = new Map<string, string>([
    [NONCE, JSON.stringify({ runId: RUN_ID })],
    ["rehearsal-run-0001/loop/a", "x"],
    ["rehearsal-run-0001/loop/b", "y"],
  ]);
  readonly uploads = new Map<string, string>([
    ["upload-from-receipt", "rehearsal-run-0001/loop/big"],
    ["upload-only-listed", "rehearsal-run-0001/loop/other"],
  ]);
  readonly answers: Record<string, Answer>;

  constructor(overrides: Record<string, Answer> = {}) {
    this.answers = { ...this.defaults(), ...overrides };
  }

  async send(command: object): Promise<unknown> {
    const name = command.constructor.name.replace(/Command$/, "");
    const input = (command as { input: Record<string, unknown> }).input;
    this.calls.push({ name, input });
    const answer = this.answers[name];
    if (answer === undefined) throw new Error(`fake has no answer for ${name}`);
    return answer(input, this);
  }

  names(): string[] {
    return this.calls.map((call) => call.name);
  }

  private defaults(): Record<string, Answer> {
    return {
      GetObject: (input) => {
        const text = this.objects.get(input.Key as string);
        if (text === undefined) throw sdkError("NoSuchKey", 404);
        return body(text);
      },
      PutObject: (input) => {
        this.objects.set(input.Key as string, String(input.Body));
        return ok();
      },
      ListMultipartUploads: () => ({
        ...ok(),
        IsTruncated: false,
        Uploads: [...this.uploads].map(([UploadId, Key]) => ({ Key, UploadId })),
      }),
      AbortMultipartUpload: (input) => {
        if (!this.uploads.delete(input.UploadId as string)) throw sdkError("NoSuchUpload", 404);
        return ok(204);
      },
      DeleteBucketPolicy: () => ok(204),
      ListObjectsV2: () => ({
        ...ok(),
        Contents: [...this.objects.keys()].sort().map((Key) => ({ Key })),
        IsTruncated: false,
      }),
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

let dir: string;
let receiptPath: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "aws-rehearsal-cleanup-"));
  receiptPath = join(dir, `aws-rehearsal-${RUN_ID}.json`);
  credentialsFile = join(dir, "credentials");
  configFile = join(dir, "config");
  await writeFile(
    credentialsFile,
    `[waitron-rehearsal]\naws_access_key_id = ${KEY_ID}\naws_secret_access_key = ${SECRET}\n`,
  );
  await writeFile(configFile, "[profile waitron-rehearsal]\nregion = eu-north-1\n");
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

/** The receipt a run that left its bucket behind writes. */
function leftReceipt(overrides: Partial<AwsReceipt> = {}): AwsReceipt {
  return {
    header: {
      runId: RUN_ID,
      commit: "0123456789abcdef",
      node: "v26.7.0",
      sdkVersion: "3.1140.0",
      litestreamVersion: "v0.5.17",
      region: "eu-north-1",
      startedAt: "2026-10-14T10:00:00.000Z",
      finishedAt: "2026-10-14T10:05:00.000Z",
      limits: { teardownMs: 120_000 },
    },
    ownership: { state: "owned", bucket: BUCKET },
    events: [],
    teardown: [{ step: "delete-bucket", outcome: "failed", errorName: "InternalError" }],
    actions: [],
    remaining: { bucket: BUCKET, uploadIds: ["upload-from-receipt"] },
    cleanupCommand: cleanupCommandFor("eu-north-1", receiptPath),
    ...overrides,
  };
}

async function writeLeft(receipt: unknown): Promise<void> {
  await writeFile(receiptPath, JSON.stringify(receipt));
}

interface Harness {
  fake: FakeAdmin;
  deps: Partial<AwsRehearsalDeps>;
  printed: string[];
  kill: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  createAdminClient: ReturnType<typeof vi.fn>;
}

function harness(overrides: Record<string, Answer> = {}, extra: Partial<AwsRehearsalDeps> = {}) {
  const fake = new FakeAdmin(overrides);
  const printed: string[] = [];
  const kill = vi.fn();
  const readFileSpy = vi.fn((path: string) => readFile(path, "utf8"));
  const createAdminClient = vi.fn(() => fake);
  let clock = Date.parse("2026-10-14T11:00:00.000Z");
  const h: Harness = {
    fake,
    printed,
    kill,
    readFile: readFileSpy,
    createAdminClient,
    deps: {
      env: env(),
      readFile: readFileSpy,
      createAdminClient,
      now: () => (clock += 5),
      commit: () => "0123456789abcdef",
      isAlive: () => true,
      kill,
      sleep: async () => {},
      print: (line) => printed.push(line),
      ...extra,
    },
  };
  return h;
}

async function refusal(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected a refusal");
    },
    (thrown: unknown) => thrown as Error,
  );
}

function deleteCalls(fake: FakeAdmin): string[] {
  return fake.names().filter((name) => DELETES_AND_BUCKET.includes(name) || name === "PutObject");
}

const cleanupPath = () => join(dir, `aws-rehearsal-${RUN_ID}-cleanup.json`);

describe("cleanupFromReceipt refusals", () => {
  it("refuses without the opt-in, reading nothing and creating no client", async () => {
    await writeLeft(leftReceipt());
    const h = harness({}, { env: env({ WAITRON_RUN_AWS_REHEARSAL: undefined }) });
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("opt-in-missing");
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a receipt from another region with zero commands", async () => {
    await writeLeft(leftReceipt({ header: { ...leftReceipt().header, region: "eu-west-1" } }));
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("region-mismatch");
    expect(h.fake.calls).toEqual([]);
  });

  it.each([
    ["another lane's bucket", "waitron-rehearsal-cloud-x"],
    ["a suffix of the wrong length", "waitron-rehearsal-waitron-abc"],
    ["an upper-case suffix", "waitron-rehearsal-waitron-ABC123DEF456"],
  ])("refuses %s with zero commands", async (_label, bucket) => {
    await writeLeft(leftReceipt({ remaining: { bucket, uploadIds: [] } }));
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-refused");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a receipt that is not JSON, without echoing its text", async () => {
    await writeFile(receiptPath, `not json ${SECRET}`);
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-refused");
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a run id that is not a token", async () => {
    await writeLeft(leftReceipt({ header: { ...leftReceipt().header, runId: "a/b c" } }));
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-refused");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses an owned receipt whose remaining bucket is not the one it owned", async () => {
    await writeLeft(
      leftReceipt({
        ownership: { state: "owned", bucket: "waitron-rehearsal-waitron-zzzzzzzzzzzz" },
      }),
    );
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-refused");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses an unowned candidate for a person's check, naming only the bucket", async () => {
    await writeLeft(
      leftReceipt({
        ownership: { state: "unowned-candidate", bucket: null, candidate: BUCKET },
        remaining: { bucket: null, uploadIds: [] },
        cleanupCommand: null,
      }),
    );
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
    expect(error.message).toContain(BUCKET);
    expect(error.message).toContain("ownership");
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.calls).toEqual([]);
  });

  it.each(["collision", "not-created"] as const)(
    "refuses a %s receipt with zero commands",
    async (state) => {
      await writeLeft(
        leftReceipt({
          ownership: { state, bucket: null },
          remaining: { bucket: null, uploadIds: [] },
          cleanupCommand: null,
        }),
      );
      const h = harness();
      const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
      expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
      expect(error.message).toContain(state);
      expect(h.fake.calls).toEqual([]);
    },
  );

  it.each([
    ["missing", (fake: FakeAdmin) => fake.objects.delete(NONCE)],
    [
      "another run's",
      (fake: FakeAdmin) => fake.objects.set(NONCE, JSON.stringify({ runId: "run-0002" })),
    ],
    ["unparseable", (fake: FakeAdmin) => fake.objects.set(NONCE, "{runId: run-0001")],
    [
      "carrying more than the run id",
      (fake: FakeAdmin) => fake.objects.set(NONCE, JSON.stringify({ runId: RUN_ID, x: 1 })),
    ],
    ["a bare string", (fake: FakeAdmin) => fake.objects.set(NONCE, JSON.stringify(RUN_ID))],
  ])("refuses when the ownership marker is %s, deleting nothing", async (_label, change) => {
    await writeLeft(leftReceipt());
    const h = harness();
    change(h.fake);
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
    expect(error.message).toContain(BUCKET);
    expect(h.fake.names()).toEqual(["GetObject"]);
    expect(h.fake.calls[0]!.input).toMatchObject({ Bucket: BUCKET, Key: NONCE });
    expect(deleteCalls(h.fake)).toEqual([]);
    expect(h.kill).not.toHaveBeenCalled();
  });

  it("refuses when the marker cannot be read, deleting nothing", async () => {
    await writeLeft(leftReceipt());
    const h = harness({
      GetObject: () => {
        throw sdkError("AccessDenied", 403);
      },
    });
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.names()).toEqual(["GetObject"]);
  });
});

describe("cleanupFromReceipt with nothing to do", () => {
  it("succeeds without a command when the receipt left no bucket", async () => {
    await writeLeft(
      leftReceipt({ remaining: { bucket: null, uploadIds: [] }, cleanupCommand: null }),
    );
    const h = harness();
    const result = await cleanupFromReceipt(receiptPath, h.deps);
    expect(result.ok).toBe(true);
    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(h.fake.calls).toEqual([]);
  });

  it("succeeds and deletes nothing when the bucket is already gone", async () => {
    // A run whose stop-child step failed still names its bucket even though DeleteBucket succeeded.
    await writeLeft(
      leftReceipt({
        teardown: [
          { step: "stop-child", outcome: "failed", count: 1 },
          { step: "delete-bucket", outcome: "ok" },
        ],
      }),
    );
    const h = harness({
      GetObject: () => {
        throw sdkError("NoSuchBucket", 404);
      },
    });
    const result = await cleanupFromReceipt(receiptPath, h.deps);
    expect(result.ok).toBe(true);
    expect(h.fake.names()).toEqual(["GetObject"]);
    expect(h.printed).toEqual(["bucket not found; nothing deleted"]);
    expect(h.kill).not.toHaveBeenCalled();
  });
});

describe("cleanupFromReceipt on a bucket it proves it owns", () => {
  it("tears the bucket down, never signals a process, and writes a cleanup receipt", async () => {
    await writeLeft(leftReceipt());
    const h = harness();
    const result = await cleanupFromReceipt(receiptPath, h.deps);
    expect(result.ok).toBe(true);
    expect(h.kill).not.toHaveBeenCalled();

    const names = h.fake.names();
    expect(names[0]).toBe("GetObject");
    const aborted = h.fake.calls
      .filter((call) => call.name === "AbortMultipartUpload")
      .map((call) => call.input.UploadId);
    expect(aborted.sort()).toEqual(["upload-from-receipt", "upload-only-listed"]);
    for (const step of ["DeleteBucketPolicy", "DeleteObjects", "DeleteObject", "DeleteBucket"]) {
      expect(names).toContain(step);
    }
    const nonceDelete = h.fake.calls.find((call) => call.name === "DeleteObject");
    expect(nonceDelete!.input.Key).toBe(NONCE);
    expect(names.indexOf("DeleteObject")).toBe(names.indexOf("DeleteBucket") - 1);
    for (const call of h.fake.calls) expect(call.input.Bucket).toBe(BUCKET);
    expect(h.fake.objects.size).toBe(0);
    expect(h.fake.uploads.size).toBe(0);

    expect(result.receiptPath).toBe(cleanupPath());
    expect(h.printed).toEqual([cleanupPath()]);
    const text = await readFile(cleanupPath(), "utf8");
    expect(text).not.toContain(KEY_ID);
    expect(text).not.toContain(SECRET);
    const receipt = JSON.parse(text) as AwsReceipt;
    expect(receipt.header.runId).toBe(RUN_ID);
    expect(receipt.ownership).toEqual({ state: "owned", bucket: BUCKET });
    expect(receipt.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(receipt.cleanupCommand).toBeNull();
    expect(receipt.teardown.map((entry) => entry.outcome)).not.toContain("failed");
    // The original receipt is left as it was.
    expect(JSON.parse(await readFile(receiptPath, "utf8"))).toEqual(leftReceipt());
  });

  it("returns failure and lists what remains when part of the teardown fails", async () => {
    await writeLeft(leftReceipt());
    const h = harness({
      AbortMultipartUpload: (input, fake) => {
        if (input.UploadId === "upload-from-receipt") throw sdkError("InternalError", 500);
        fake.uploads.delete(input.UploadId as string);
        return ok(204);
      },
      DeleteBucket: () => {
        throw sdkError("InternalError", 500);
      },
    });
    const result = await cleanupFromReceipt(receiptPath, h.deps);
    expect(result.ok).toBe(false);
    expect(h.printed).toEqual([cleanupPath()]);
    const receipt = JSON.parse(await readFile(cleanupPath(), "utf8")) as AwsReceipt;
    expect(receipt.remaining).toEqual({ bucket: BUCKET, uploadIds: ["upload-from-receipt"] });
    expect(receipt.cleanupCommand).toBe(cleanupCommandFor("eu-north-1", cleanupPath()));
    const failed = receipt.teardown
      .filter((entry) => entry.outcome === "failed")
      .map((e) => e.step);
    expect(failed).toEqual(["abort-upload", "delete-bucket"]);
    // The marker was put back, so the cleanup can be run again.
    expect(h.fake.objects.get(NONCE)).toBe(JSON.stringify({ runId: RUN_ID }));
  });

  it("writes nothing but the cleanup receipt beside the original", async () => {
    await writeLeft(leftReceipt());
    const h = harness();
    await cleanupFromReceipt(receiptPath, h.deps);
    expect((await readdir(dir)).sort()).toEqual(
      [
        "config",
        "credentials",
        `aws-rehearsal-${RUN_ID}-cleanup.json`,
        `aws-rehearsal-${RUN_ID}.json`,
      ].sort(),
    );
  });
});

describe("aws-rehearsal-cleanup script", () => {
  it.each([
    ["no arguments", []],
    ["a missing value", ["--receipt"]],
    ["an extra argument", ["--receipt", "/tmp/r.json", "--force"]],
    ["another flag", ["--bucket", "x"]],
    ["an empty value", ["--receipt", ""]],
  ])("refuses %s", (_label, argv) => {
    expect(parseCleanupArgs(argv)).toBeNull();
  });

  it("accepts exactly --receipt <path>", () => {
    expect(parseCleanupArgs(["--receipt", "/tmp/r.json"])).toEqual({ receipt: "/tmp/r.json" });
  });

  it("exits 2 with a usage message on bad arguments and never starts a cleanup", async () => {
    const lines: string[] = [];
    const cleanup = vi.fn();
    expect(await runCleanup(["--receipt"], { cleanup, error: (l) => lines.push(l) })).toBe(2);
    expect(cleanup).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("usage:");
  });

  it("exits 0 or 1 by the cleanup's result, and prints only an error's message", async () => {
    const lines: string[] = [];
    const error = (line: string) => lines.push(line);
    expect(
      await runCleanup(["--receipt", "/r.json"], { cleanup: async () => ({ ok: true }), error }),
    ).toBe(0);
    expect(
      await runCleanup(["--receipt", "/r.json"], { cleanup: async () => ({ ok: false }), error }),
    ).toBe(1);
    const thrown = new Error("refused: names the bucket only");
    expect(
      await runCleanup(["--receipt", "/r.json"], {
        cleanup: async () => {
          throw thrown;
        },
        error,
      }),
    ).toBe(1);
    expect(lines).toEqual(["refused: names the bucket only"]);
  });

  it("is the script the run's cleanup command names", () => {
    const command = cleanupCommandFor("eu-north-1", "/tmp/aws-rehearsal-x.json");
    const named = /exec tsx (\S+) --receipt /.exec(command)?.[1];
    expect(named).toBe("scripts/aws-rehearsal-cleanup.ts");
    const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    expect(existsSync(join(serverRoot, named!))).toBe(true);
  });
});

describe("cleanupFromReceipt fix round 1", () => {
  async function useRegion(region: string): Promise<void> {
    await writeFile(configFile, `[profile waitron-rehearsal]\nregion = ${region}\n`);
  }

  it("refuses a region the cleanup command cannot carry, saying so", async () => {
    await useRegion("eusc-de-east-1");
    await writeLeft(leftReceipt({ header: { ...leftReceipt().header, region: "eusc-de-east-1" } }));
    const h = harness({}, { env: env({ AWS_REGION: "eusc-de-east-1" }) });
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("region-unsupported");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a run id too long for the cleanup receipt's name, saying so", async () => {
    await writeLeft(leftReceipt({ header: { ...leftReceipt().header, runId: "r".repeat(60) } }));
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("run-id-unsupported");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a receipt in a folder the cleanup command cannot name", async () => {
    const folder = join(dir, "has space");
    await mkdir(folder);
    receiptPath = join(folder, `aws-rehearsal-${RUN_ID}.json`);
    await writeLeft(leftReceipt());
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(error.message).toContain("may hold only letters, digits and . _ @ -");
    expect(error.message).toContain("at most 40 folders deep");
    expect(error.message).not.toContain("512");
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses a receipt more than 40 folders deep, saying so, though its path is short", async () => {
    const folder = join(dir, ...Array.from({ length: 41 }, () => "d"));
    await mkdir(folder, { recursive: true });
    receiptPath = join(folder, `aws-rehearsal-${RUN_ID}.json`);
    expect(receiptPath.length).toBeLessThan(512);
    await writeLeft(leftReceipt());
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(error.message).toContain("at most 40 folders deep");
    expect(error.message).not.toContain("512");
    expect(h.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      "an owned bucket that is not a rehearsal bucket",
      {
        ownership: { state: "owned", bucket: "lane-d" },
        remaining: { bucket: null, uploadIds: [] },
      },
    ],
    ["an unknown ownership state", { ownership: { state: "adopted", bucket: BUCKET } }],
    [
      "an unowned candidate that is not a rehearsal bucket",
      { ownership: { state: "unowned-candidate", bucket: null, candidate: "x" } },
    ],
    ["a remaining block that is not an object", { remaining: null }],
    [
      "upload ids that are not a list",
      { remaining: { bucket: BUCKET, uploadIds: "upload-from-receipt" } },
    ],
    ["an upload id with a space", { remaining: { bucket: BUCKET, uploadIds: ["has space"] } }],
    ["a missing ownership block", { ownership: undefined }],
    ["a region that is not a token", { header: { ...leftReceipt().header, region: "eu north" } }],
  ])("refuses %s with zero commands", async (_label, override) => {
    await writeLeft({ ...leftReceipt(), ...override });
    const h = harness();
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-refused");
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses when the marker's body cannot be read, deleting nothing", async () => {
    await writeLeft(leftReceipt());
    const h = harness({
      GetObject: () => ({
        ...ok(),
        Body: {
          transformToString: async () => {
            throw new Error(`stream broke ${SECRET}`);
          },
        },
      }),
    });
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("ownership-unproven");
    expect(error.message).not.toContain(SECRET);
    expect(h.fake.names()).toEqual(["GetObject"]);
  });

  it("names the bucket left and the failed steps when the cleanup receipt cannot be written", async () => {
    await writeLeft(leftReceipt());
    await mkdir(cleanupPath());
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("InternalError", 500);
      },
    });
    const error = await refusal(cleanupFromReceipt(receiptPath, h.deps));
    expect(error.message).toContain("receipt not written");
    expect(error.message).toContain(`bucket left: ${BUCKET}`);
    expect(error.message).toContain("failed teardown steps: delete-bucket");
    expect(error.message).not.toContain(SECRET);
    expect(error.message).not.toContain(KEY_ID);
    expect(h.printed).toEqual([]);
  });
});

describe("cleanupFromReceipt: a receipt entry the receipt refuses", () => {
  it("still deletes the bucket, writes its receipt without the value and reports failure", async () => {
    await writeLeft(leftReceipt());
    const h = harness({
      DeleteBucketPolicy: () => {
        throw sdkError(`Denied${SECRET}`, 403);
      },
    });
    const result = await cleanupFromReceipt(receiptPath, h.deps);
    expect(result.ok).toBe(false);
    expect(h.fake.names().at(-1)).toBe("DeleteBucket");
    const text = await readFile(cleanupPath(), "utf8");
    expect(text).not.toContain(SECRET);
    const receipt = JSON.parse(text) as AwsReceipt;
    expect(receipt.teardown.find((entry) => entry.step === "remove-policy")).toEqual({
      step: "remove-policy",
      outcome: "failed",
    });
    expect(receipt.events).toContainEqual({
      scenario: "lifecycle",
      phase: "record-refused",
      outcome: "refused",
    });
  });
});

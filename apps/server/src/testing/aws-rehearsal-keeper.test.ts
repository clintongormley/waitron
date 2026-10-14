import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUCKET,
  CONFIG,
  FakeAdmin,
  KEY_ID,
  SECRET,
  NONCE,
  RUN_ID,
  START_TIME,
  sdkError,
  profileEnv,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { journalFileName, type RehearsalJournal } from "./aws-rehearsal-journal.js";
import {
  type KeeperDeps,
  keeperLogPath,
  runKeeper,
  terminalPrinter,
} from "./aws-rehearsal-keeper.js";
import { type AwsReceipt, cleanupCommandFor } from "./aws-rehearsal-receipt.js";
import { cleanupFromReceipt } from "./aws-rehearsal.js";
import {
  currentRequestScope,
  installSendGate,
  setSendGateStrict,
  uninstallSendGate,
} from "./aws-send-gate.js";

const CEILING = 1_000_000;
const GRACE = 30_000;
const NEVER = new Promise<never>(() => {});

let dir: string;
let tmp: string;
let receiptDir: string;
let journalPath: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-keeper-"));
  tmp = await mkdtemp(join(tmpdir(), "aws-rehearsal-keeper-tmp-"));
  receiptDir = join(dir, "receipts");
  await mkdir(receiptDir);
  journalPath = join(receiptDir, journalFileName(RUN_ID));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(tmp, { recursive: true, force: true });
});

afterAll(() => {
  uninstallSendGate();
});

const scratchRoot = (): string => join(tmp, `waitron-aws-rehearsal-${RUN_ID}`);
const interruptedPath = (): string => join(receiptDir, `aws-rehearsal-${RUN_ID}-interrupted.json`);

function journal(overrides: Partial<RehearsalJournal> = {}): RehearsalJournal {
  return {
    version: 1,
    runId: RUN_ID,
    region: "eu-north-1",
    bucket: BUCKET,
    state: "owned",
    uploads: [],
    pids: [],
    scratchRoot: null,
    receiptDir,
    header: {
      commit: "0123456789abcdef",
      node: "v26.7.0",
      sdkVersion: "3.900.0",
      litestreamVersion: "0.5.0",
      startedAt: "2026-10-14T10:00:00.000Z",
      limits: { teardownMs: 120000 },
    },
    teardownMs: 120000,
    keeperCeilingMs: CEILING,
    keeperPid: null,
    ready: null,
    ...overrides,
  };
}

async function writeJournalFile(value: unknown): Promise<void> {
  await writeFile(journalPath, JSON.stringify(value));
}

interface Harness {
  deps: Partial<KeeperDeps> & Pick<KeeperDeps, "waitForRunnerEnd">;
  printed: string[];
  /** Every sleep, and every command the fake was sent, in order. */
  order: string[];
  kill: ReturnType<typeof vi.fn>;
  removeDir: ReturnType<typeof vi.fn>;
  createAdminClient: ReturnType<typeof vi.fn>;
}

function harness(fake: FakeAdmin, overrides: Partial<KeeperDeps> = {}): Harness {
  const printed: string[] = [];
  const order: string[] = [];
  const send = fake.send.bind(fake);
  fake.send = (command, options) => {
    order.push(command.constructor.name.replace(/Command$/, ""));
    return send(command, options);
  };
  let clock = Date.parse("2026-10-14T10:10:00.000Z");
  const kill = vi.fn();
  const removeDir = vi.fn((path: string) => rm(path, { recursive: true, force: true }));
  const createAdminClient = vi.fn(() => fake);
  return {
    printed,
    order,
    kill,
    removeDir,
    createAdminClient,
    deps: {
      env: profileEnv({ credentialsFile, configFile }),
      tmpdir: tmp,
      waitForRunnerEnd: () => Promise.resolve(),
      sleep: async (ms) => {
        order.push(`sleep ${ms}`);
        if (ms === CEILING) await NEVER;
      },
      now: () => (clock += 5),
      createAdminClient,
      print: (line) => printed.push(line),
      processStartTime: () => START_TIME,
      isAlive: () => false,
      kill,
      removeDir,
      graceMs: GRACE,
      childGraceMs: 200,
      ...overrides,
    },
  };
}

/** A run that ends when the test calls `end`; `waiting` settles once the keeper waits on it. */
function heldRunner(): {
  waitForRunnerEnd: () => Promise<void>;
  waiting: Promise<void>;
  end: () => void;
} {
  let waited!: () => void;
  let end!: () => void;
  const waiting = new Promise<void>((resolve) => {
    waited = resolve;
  });
  const ended = new Promise<void>((resolve) => {
    end = resolve;
  });
  return {
    waitForRunnerEnd: () => {
      waited();
      return ended;
    },
    waiting,
    end: () => end(),
  };
}

/** Reads files, the first read outlasting several of the test's own turns. */
function slowFirstRead(): (path: string) => Promise<string> {
  let first = true;
  return async (path) => {
    if (first) {
      first = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return readFile(path, "utf8");
  };
}

function withAlive(h: Harness, pids: number[]): void {
  const alive = new Set(pids);
  h.deps.isAlive = (pid) => alive.has(pid);
  h.kill.mockImplementation((pid: number) => {
    alive.delete(pid);
  });
}

async function logLines(): Promise<string[]> {
  return (await readFile(keeperLogPath(journalPath), "utf8")).trimEnd().split("\n");
}

async function receipt(): Promise<AwsReceipt> {
  return JSON.parse(await readFile(interruptedPath(), "utf8")) as AwsReceipt;
}

const DELETES = ["AbortMultipartUpload", "DeleteBucketPolicy", "DeleteObjects", "DeleteObject"];

function bucketWithObjects(options: ConstructorParameters<typeof FakeAdmin>[0] = {}): FakeAdmin {
  return new FakeAdmin({
    objects: [
      [NONCE, JSON.stringify({ runId: RUN_ID })],
      [`rehearsal-${RUN_ID}/loop/a`, "x"],
    ],
    uploads: [["upload-1", `rehearsal-${RUN_ID}/loop/big`]],
    ...options,
  });
}

describe("runKeeper", () => {
  it("re-reads the journal after the run ends and does nothing when it is finished", async () => {
    await writeJournalFile(journal({ state: "owned", scratchRoot: scratchRoot() }));
    await mkdir(scratchRoot());
    const fake = bucketWithObjects();
    const runner = heldRunner();
    const h = harness(fake, {
      readFile: slowFirstRead(),
      waitForRunnerEnd: runner.waitForRunnerEnd,
    });
    const status = runKeeper(journalPath, h.deps);
    await runner.waiting;
    expect(fake.calls).toEqual([]);
    await writeJournalFile(journal({ state: "finished", scratchRoot: scratchRoot() }));
    runner.end();
    expect(await status).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(h.removeDir).not.toHaveBeenCalled();
    expect(h.printed).toEqual([]);
    await stat(scratchRoot());
    const lines = await logLines();
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.at(-1)).toBe("exit 0");
  });

  it("tears an owned bucket down, stops tracked pids, removes scratch and writes its receipt", async () => {
    await mkdir(join(scratchRoot(), "loop"), { recursive: true });
    await writeJournalFile(
      journal({
        uploads: [{ key: `rehearsal-${RUN_ID}/loop/big`, uploadId: "upload-1" }],
        pids: [{ pid: 4242, startTime: START_TIME }],
        scratchRoot: scratchRoot(),
      }),
    );
    const fake = bucketWithObjects();
    let scoped = false;
    const getObject = fake.answers.GetObject!;
    fake.answers.GetObject = (input, self) => {
      scoped = currentRequestScope() !== undefined;
      return getObject(input, self);
    };
    const h = harness(fake);
    withAlive(h, [4242]);

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(scoped).toBe(true);
    expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
    expect(fake.names()).toEqual([
      "GetObject",
      "AbortMultipartUpload",
      "ListMultipartUploads",
      "DeleteBucketPolicy",
      "ListObjectsV2",
      "DeleteObjects",
      "DeleteObject",
      "DeleteBucket",
    ]);
    expect(fake.calls.every((c) => c.input.Bucket === BUCKET)).toBe(true);
    expect(fake.uploads.size).toBe(0);
    expect(fake.objects.size).toBe(0);
    await expect(stat(scratchRoot())).rejects.toThrow();
    expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    const written = await receipt();
    expect(written.header.runId).toBe(RUN_ID);
    expect(written.events).toContainEqual(expect.objectContaining({ phase: "interrupted" }));
    expect(written.ownership).toEqual({ state: "owned", bucket: BUCKET });
    expect(written.teardown.map((e) => [e.step, e.outcome])).toEqual([
      ["stop-child", "ok"],
      ["abort-upload", "ok"],
      ["remove-policy", "ok"],
      ["delete-objects", "ok"],
      ["delete-bucket", "ok"],
      ["remove-scratch", "ok"],
    ]);
    expect(written.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(written.cleanupCommand).toBeNull();
    const lines = await logLines();
    expect(lines).toEqual(expect.arrayContaining([interruptedPath(), "nothing left behind"]));
    expect(lines.at(-1)).toBe("exit 0");
  });

  it("signals only a pid whose start time is unchanged, and never one with no start time", async () => {
    await writeJournalFile(
      journal({
        pids: [
          { pid: 101, startTime: START_TIME },
          { pid: 102, startTime: START_TIME },
          { pid: 103, startTime: null },
        ],
      }),
    );
    const h = harness(bucketWithObjects(), {
      processStartTime: (pid) => (pid === 102 ? "Thu Oct 15 09:00:00 2026" : START_TIME),
    });
    withAlive(h, [101, 102, 103]);

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(h.kill.mock.calls.map(([pid]) => pid)).toEqual([101]);
    const lines = (await logLines()).join("\n");
    expect(lines).toContain("pid 102");
    expect(lines).toContain("pid 103");
  });

  it("finds nothing left when the marker read answers NoSuchBucket", async () => {
    await writeJournalFile(journal({ pids: [{ pid: 101, startTime: START_TIME }] }));
    const fake = new FakeAdmin({
      answers: {
        GetObject: () => {
          throw sdkError("NoSuchBucket", 404);
        },
      },
    });
    const h = harness(fake);
    withAlive(h, [101]);

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(fake.names()).toEqual(["GetObject"]);
    expect(h.kill).toHaveBeenCalledWith(101, "SIGTERM");
    expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    expect((await receipt()).remaining).toEqual({ bucket: null, uploadIds: [] });
  });

  it("reports a bucket whose DeleteBucket fails, with the cleanup command, and exits 1", async () => {
    await writeJournalFile(journal());
    const fake = bucketWithObjects({
      answers: {
        DeleteBucket: () => {
          throw sdkError("InternalError", 500);
        },
      },
    });
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(h.printed).toEqual([interruptedPath(), "left behind:", `bucket ${BUCKET}`]);
    const written = await receipt();
    expect(written.remaining.bucket).toBe(BUCKET);
    expect(written.cleanupCommand).toBe(cleanupCommandFor("eu-north-1", interruptedPath()));
    expect((await logLines()).at(-1)).toBe("exit 1");
  });

  it("waits the grace period on creating, then finds nothing created on NoSuchBucket", async () => {
    await writeJournalFile(journal({ state: "creating" }));
    const fake = new FakeAdmin({
      answers: {
        GetObject: () => {
          throw sdkError("NoSuchBucket", 404);
        },
      },
    });
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(h.order.filter((entry) => !entry.startsWith(`sleep ${CEILING}`))).toEqual([
      `sleep ${GRACE}`,
      "GetObject",
    ]);
    expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    expect((await receipt()).ownership).toEqual({ state: "not-created", bucket: null });
  });

  it("on creating with the bucket present deletes nothing and reports ownership unknown", async () => {
    await writeJournalFile(journal({ state: "creating" }));
    const fake = bucketWithObjects();
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(fake.names()).toEqual(["GetObject"]);
    expect(fake.names().some((name) => [...DELETES, "DeleteBucket"].includes(name))).toBe(false);
    expect(h.printed).toEqual([
      interruptedPath(),
      "left behind:",
      `bucket ${BUCKET} (ownership unknown)`,
    ]);
    expect((await receipt()).ownership).toEqual({
      state: "unowned-candidate",
      bucket: null,
      candidate: BUCKET,
    });
  });

  it.each(["deleted", "not-created", "collision"] as const)(
    "takes no bucket step on %s, and still removes scratch",
    async (state) => {
      await mkdir(scratchRoot());
      await writeJournalFile(journal({ state, scratchRoot: scratchRoot() }));
      const fake = bucketWithObjects();
      const h = harness(fake);

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(fake.calls).toEqual([]);
      await expect(stat(scratchRoot())).rejects.toThrow();
      expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    },
  );

  it("prints the scratch folder it could not remove and exits 1", async () => {
    await mkdir(scratchRoot());
    await writeJournalFile(journal({ state: "deleted", scratchRoot: scratchRoot() }));
    const h = harness(new FakeAdmin());
    h.removeDir.mockRejectedValue(Object.assign(new Error("busy"), { code: "EBUSY" }));

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(h.printed).toEqual([interruptedPath(), "left behind:", `folder ${scratchRoot()}`]);
    expect((await receipt()).teardown).toContainEqual(
      expect.objectContaining({ step: "remove-scratch", outcome: "failed" }),
    );
  });

  it("never overwrites an existing interrupted receipt, and still cleans up", async () => {
    await writeJournalFile(journal());
    await writeFile(interruptedPath(), "already here\n");
    const fake = bucketWithObjects();
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(await readFile(interruptedPath(), "utf8")).toBe("already here\n");
    expect(fake.names()).toContain("DeleteBucket");
    expect(h.printed[0]).toContain(interruptedPath());
    expect(h.printed[0]).toContain("already exists");
    expect(h.printed.at(-1)).toBe("nothing left behind");
  });

  it("gives up at the ceiling without acting, and exits 1", async () => {
    await writeJournalFile(journal({ scratchRoot: scratchRoot() }));
    await mkdir(scratchRoot());
    const fake = bucketWithObjects();
    const h = harness(fake, {
      waitForRunnerEnd: () => NEVER,
      sleep: async () => {},
    });

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(h.printed.join("\n")).toContain("gave up waiting");
    expect(h.printed).toContain(`bucket ${BUCKET}`);
    expect(h.printed).toContain(`folder ${scratchRoot()}`);
    expect(fake.calls).toEqual([]);
    expect(h.removeDir).not.toHaveBeenCalled();
    expect((await logLines()).at(-1)).toBe("exit 1");
  });

  it("at the ceiling names each tracked process still running as itself, and signals none", async () => {
    await writeJournalFile(
      journal({
        pids: [
          { pid: 101, startTime: START_TIME },
          { pid: 102, startTime: START_TIME },
          { pid: 103, startTime: START_TIME },
        ],
      }),
    );
    const h = harness(bucketWithObjects(), {
      waitForRunnerEnd: () => NEVER,
      sleep: async () => {},
      processStartTime: (pid) => (pid === 103 ? "Thu Oct 15 09:00:00 2026" : START_TIME),
    });
    withAlive(h, [101, 103]);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    const may = h.printed.slice(h.printed.indexOf("may be left:") + 1);
    expect(may).toEqual([`bucket ${BUCKET}`, "process 101"]);
    expect(h.kill).not.toHaveBeenCalled();
  });

  it("at the ceiling names a live tracked process whose start time cannot be read now", async () => {
    await writeJournalFile(journal({ pids: [{ pid: 101, startTime: START_TIME }] }));
    const h = harness(bucketWithObjects(), {
      waitForRunnerEnd: () => NEVER,
      sleep: async () => {},
      processStartTime: () => null,
    });
    withAlive(h, [101]);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    const may = h.printed.slice(h.printed.indexOf("may be left:") + 1);
    expect(may).toEqual([`bucket ${BUCKET}`, "process 101"]);
    expect(h.kill).not.toHaveBeenCalled();
  });

  it.each([
    ["a bucket outside the rehearsal pattern", { bucket: "someone-elses-bucket" }, "bucket"],
    ["a scratch folder outside tmpdir", { scratchRoot: "/etc/waitron" }, "scratchRoot"],
    ["a remote endpoint", { endpoint: "https://s3.example.com" }, "endpoint"],
  ])("refuses a journal naming %s, deletes nothing and exits 1", async (_name, bad, field) => {
    await writeJournalFile(journal(bad as Partial<RehearsalJournal>));
    const fake = bucketWithObjects();
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(h.printed).toEqual([
      `AWS rehearsal refused (journal-refused): the journal's ${field} is not one it accepts`,
    ]);
    expect(fake.calls).toEqual([]);
    expect(h.removeDir).not.toHaveBeenCalled();
    expect((await logLines()).at(-1)).toBe("exit 1");
  });

  it("refuses a journal that turns bad by the time the run ends", async () => {
    await writeJournalFile(journal());
    const runner = heldRunner();
    const fake = bucketWithObjects();
    const h = harness(fake, {
      readFile: slowFirstRead(),
      waitForRunnerEnd: runner.waitForRunnerEnd,
    });
    const status = runKeeper(journalPath, h.deps);
    await runner.waiting;
    await writeFile(journalPath, "{not json");
    runner.end();
    expect(await status).toBe(1);
    expect(h.printed).toEqual([
      "AWS rehearsal refused (journal-refused): the journal's JSON is not one it accepts",
    ]);
    expect(fake.calls).toEqual([]);
  });

  it("builds its client for the journal's endpoint", async () => {
    await writeJournalFile(journal({ endpoint: "http://127.0.0.1:7070" }));
    const h = harness(bucketWithObjects());

    expect(await runKeeper(journalPath, h.deps)).toBe(0);

    expect(h.createAdminClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-north-1" }),
      "http://127.0.0.1:7070",
    );
  });
  describe("what it says is left", () => {
    it("names a process that would not stop, and not the bucket it deleted", async () => {
      await writeJournalFile(journal({ pids: [{ pid: 4242, startTime: START_TIME }] }));
      const fake = bucketWithObjects();
      const h = harness(fake, { isAlive: (pid) => pid === 4242 });

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(fake.names()).toContain("DeleteBucket");
      expect(h.printed).toEqual([interruptedPath(), "left behind:", "process 4242"]);
      const written = await receipt();
      expect(written.remaining).toEqual({ bucket: null, uploadIds: [] });
      expect(written.cleanupCommand).toBeNull();
    });

    it.each([
      ["AbortMultipartUpload", "an upload abort"],
      ["DeleteBucketPolicy", "a policy removal"],
    ])("after %s fails (%s), a deleted bucket is not named", async (api) => {
      await writeJournalFile(
        journal({ uploads: [{ key: `rehearsal-${RUN_ID}/loop/big`, uploadId: "upload-1" }] }),
      );
      const fake = bucketWithObjects({
        answers: {
          [api]: () => {
            throw sdkError("InternalError", 500);
          },
        },
      });
      const h = harness(fake);

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(fake.names()).toContain("DeleteBucket");
      expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
      const written = await receipt();
      expect(written.remaining).toEqual({ bucket: null, uploadIds: [] });
      expect(written.cleanupCommand).toBeNull();
    });
  });

  describe("the ownership marker", () => {
    it("deletes nothing when the marker names another run", async () => {
      await writeJournalFile(journal());
      const fake = new FakeAdmin({
        objects: [
          [NONCE, JSON.stringify({ runId: "run-9999" })],
          ["someone-elses/object", "x"],
        ],
      });
      const h = harness(fake);

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(fake.names()).toEqual(["GetObject"]);
      expect(fake.objects.size).toBe(2);
      expect(h.printed).toEqual([
        interruptedPath(),
        "left behind:",
        `bucket ${BUCKET} (ownership unknown)`,
      ]);
      expect((await receipt()).ownership).toEqual({
        state: "unowned-candidate",
        bucket: null,
        candidate: BUCKET,
      });
    });

    it("puts the marker back when it was never written and the bucket outlives teardown, so the cleanup command works", async () => {
      await writeJournalFile(journal());
      const failing = () => {
        throw sdkError("InternalError", 500);
      };
      const fake = new FakeAdmin({
        objects: [[`rehearsal-${RUN_ID}/loop/a`, "x"]],
        answers: { DeleteObjects: failing, DeleteBucket: failing },
      });
      const h = harness(fake);

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.printed).toEqual([interruptedPath(), "left behind:", `bucket ${BUCKET}`]);
      expect((await receipt()).cleanupCommand).toBe(
        cleanupCommandFor("eu-north-1", interruptedPath()),
      );
      const after = new FakeAdmin({ objects: fake.objects });
      const cleaned = await cleanupFromReceipt(interruptedPath(), {
        env: profileEnv({ credentialsFile, configFile }),
        createAdminClient: () => after,
        print: () => {},
      });
      expect(cleaned.ok).toBe(true);
      expect(after.names()).toContain("DeleteBucket");
      expect(after.objects.size).toBe(0);
    });

    it("tears down when the marker was never written", async () => {
      await writeJournalFile(journal());
      const fake = new FakeAdmin({ objects: [[`rehearsal-${RUN_ID}/loop/a`, "x"]] });
      const h = harness(fake);

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(fake.names()).toContain("DeleteBucket");
      expect(fake.objects.size).toBe(0);
      expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    });
  });

  describe("a refusal after the run ended", () => {
    it.each([
      ["AWS_PROFILE", "owned", `bucket ${BUCKET}`],
      ["WAITRON_RUN_AWS_REHEARSAL", "creating", `bucket ${BUCKET} (ownership unknown)`],
    ] as const)(
      "with %s unset still removes scratch and names the %s bucket",
      async (variable, state, bucketLine) => {
        await mkdir(scratchRoot());
        await writeFile(join(scratchRoot(), "secrets.env"), "AWS_SECRET_ACCESS_KEY=x\n");
        await writeJournalFile(
          journal({
            state,
            scratchRoot: scratchRoot(),
            uploads:
              state === "owned"
                ? [{ key: `rehearsal-${RUN_ID}/loop/big`, uploadId: "upload-1" }]
                : [],
          }),
        );
        const fake = bucketWithObjects();
        const h = harness(fake, {
          env: profileEnv({ credentialsFile, configFile }, { [variable]: undefined }),
        });

        expect(await runKeeper(journalPath, h.deps)).toBe(1);

        expect(fake.calls).toEqual([]);
        await expect(stat(scratchRoot())).rejects.toThrow();
        expect(h.printed[0]).toMatch(/^AWS rehearsal refused \(/);
        expect(h.printed.slice(1)).toEqual([
          "left behind:",
          bucketLine,
          ...(state === "owned" ? ["upload upload-1"] : []),
        ]);
        expect(await readdir(receiptDir)).not.toContain(`aws-rehearsal-${RUN_ID}-interrupted.json`);
        expect((await logLines()).at(-1)).toBe("exit 1");
      },
    );
  });

  it("refuses a profile that names its own S3 endpoint before building a client", async () => {
    await writeFile(configFile, `${CONFIG}endpoint_url = http://127.0.0.1:9\n`);
    await writeJournalFile(journal({ state: "owned" }));
    const fake = bucketWithObjects();
    const h = harness(fake);

    expect(await runKeeper(journalPath, h.deps)).toBe(1);

    expect(h.createAdminClient).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
    expect(h.printed[0]).toMatch(/^AWS rehearsal refused \(endpoint-unsupported\)/);
    expect(h.printed.slice(1)).toEqual(["left behind:", `bucket ${BUCKET}`]);
  });

  describe("with a real SDK client", () => {
    function stubbed(config: ConstructorParameters<typeof S3Client>[0] = {}) {
      const paths: string[] = [];
      const client = new S3Client({
        ...config,
        region: "eu-north-1",
        credentials: { accessKeyId: KEY_ID, secretAccessKey: SECRET },
        requestHandler: {
          async handle(request: { path: string }) {
            paths.push(request.path);
            return {
              response: {
                statusCode: 404,
                headers: { "content-type": "application/xml" },
                body: Readable.from([
                  '<?xml version="1.0"?><Error><Code>NoSuchBucket</Code><Message>gone</Message></Error>',
                ]),
              },
            };
          },
        },
      });
      return { client, paths };
    }

    afterEach(() => {
      setSendGateStrict(false);
    });

    it("sends its marker read as the runner, and leaves the gate strict", async () => {
      installSendGate();
      // Earlier cases' keepers left the gate strict, which would refuse this unscoped control.
      setSendGateStrict(false);
      const control = stubbed();
      await control.client
        .send(new GetObjectCommand({ Bucket: BUCKET, Key: NONCE }))
        .catch(() => {});
      expect(control.paths).toHaveLength(1);

      await writeJournalFile(journal());
      const real = stubbed();
      const h = harness(new FakeAdmin(), { createAdminClient: () => real.client });

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(real.paths).toHaveLength(1);
      expect(real.paths[0]).toContain(NONCE);
      const after = stubbed();
      const refused = await after.client
        .send(new GetObjectCommand({ Bucket: BUCKET, Key: NONCE }))
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(String(refused)).toContain("outside a rehearsal run");
      expect(after.paths).toEqual([]);
    });

    it("refuses a request whose host is not Amazon's when the journal names no endpoint", async () => {
      await writeJournalFile(journal());
      const real = stubbed({ endpoint: "http://127.0.0.1:9", forcePathStyle: true });
      const h = harness(new FakeAdmin(), { createAdminClient: () => real.client });

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(real.paths).toEqual([]);
      expect((await receipt()).events).toContainEqual({
        scenario: "lifecycle",
        phase: "request-refused",
        api: "GetObject",
        outcome: "refused",
      });
    });

    it("lets a request reach the journal's own local endpoint", async () => {
      await writeJournalFile(journal({ endpoint: "http://127.0.0.1:9" }));
      const real = stubbed({ endpoint: "http://127.0.0.1:9", forcePathStyle: true });
      const h = harness(new FakeAdmin(), { createAdminClient: () => real.client });

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(real.paths).toHaveLength(1);
    });
  });
  describe("tracked processes, whatever the bucket's state", () => {
    const pid = { pid: 4242, startTime: START_TIME };

    it.each(["deleted", "not-created", "collision"] as const)(
      "stops a live tracked process on %s",
      async (state) => {
        await writeJournalFile(journal({ state, pids: [pid] }));
        const h = harness(new FakeAdmin());
        withAlive(h, [4242]);

        expect(await runKeeper(journalPath, h.deps)).toBe(0);

        expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
        expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
        expect((await receipt()).teardown).toContainEqual(
          expect.objectContaining({ step: "stop-child", outcome: "ok", count: 1 }),
        );
      },
    );

    it("never signals a tracked pid once another process holds it", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      let startTime = START_TIME;
      const h = harness(new FakeAdmin(), {
        isAlive: (p) => p === 4242,
        processStartTime: () => startTime,
      });
      h.kill.mockImplementation(() => {
        startTime = "Thu Oct 15 10:00:00 2026";
      });

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(h.kill.mock.calls).toEqual([[4242, "SIGTERM"]]);
      expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
    });

    it("does not signal a pid another process took after its start time was first read", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), {
        isAlive: (p) => p === 4242,
        processStartTime: vi
          .fn()
          .mockReturnValueOnce(START_TIME)
          .mockReturnValue("Thu Oct 15 10:00:00 2026"),
      });

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(h.kill).not.toHaveBeenCalled();
    });

    it.each([
      [
        "once it has been matched",
        () => vi.fn().mockReturnValueOnce(START_TIME).mockReturnValue(null),
      ],
      ["from the first read", () => vi.fn().mockReturnValue(null)],
    ])(
      "names a live process whose start time cannot be read %s as left, signals it not, and exits 1",
      async (_when, startTimes) => {
        await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
        const h = harness(new FakeAdmin(), {
          isAlive: (p) => p === 4242,
          processStartTime: startTimes(),
        });

        expect(await runKeeper(journalPath, h.deps)).toBe(1);

        expect(h.kill).not.toHaveBeenCalled();
        expect(h.printed).toEqual([interruptedPath(), "left behind:", "process 4242"]);
        expect((await receipt()).teardown).toContainEqual({
          step: "stop-child",
          outcome: "failed",
          count: 1,
        });
      },
    );

    it("finds nothing left of a tracked process that has exited, though its start time cannot be read", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), { processStartTime: () => null });

      expect(await runKeeper(journalPath, h.deps)).toBe(0);

      expect(h.kill).not.toHaveBeenCalled();
      expect(h.printed).toEqual([interruptedPath(), "nothing left behind"]);
      expect((await logLines()).join("\n")).toContain("pid 4242 is gone");
    });

    it("names a process that would not stop on deleted, and exits 1", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), { isAlive: (p) => p === 4242 });

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.kill).toHaveBeenCalledWith(4242, "SIGKILL");
      expect(h.printed).toEqual([interruptedPath(), "left behind:", "process 4242"]);
    });

    it("stops a live tracked process when the marker names another run", async () => {
      await writeJournalFile(journal({ pids: [pid] }));
      const fake = new FakeAdmin({ objects: [[NONCE, JSON.stringify({ runId: "run-9999" })]] });
      const h = harness(fake);
      withAlive(h, [4242]);

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
      expect(fake.names()).toEqual(["GetObject"]);
      expect(h.printed).toEqual([
        interruptedPath(),
        "left behind:",
        `bucket ${BUCKET} (ownership unknown)`,
      ]);
    });

    it("stops a live tracked process when it is refused after the run ended", async () => {
      await writeJournalFile(journal({ pids: [pid] }));
      const fake = bucketWithObjects();
      const h = harness(fake, {
        env: profileEnv({ credentialsFile, configFile }, { AWS_PROFILE: undefined }),
      });
      withAlive(h, [4242]);

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
      expect(fake.calls).toEqual([]);
      expect(h.printed.slice(1)).toEqual(["left behind:", `bucket ${BUCKET}`]);
    });

    it("logs the process it stopped when it is refused, which has no receipt to record it", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), {
        env: profileEnv({ credentialsFile, configFile }, { AWS_PROFILE: undefined }),
      });
      withAlive(h, [4242]);

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.kill).toHaveBeenCalledWith(4242, "SIGTERM");
      expect(await logLines()).toContain("stopped process 4242");
      expect(await readdir(receiptDir)).not.toContain(`aws-rehearsal-${RUN_ID}-interrupted.json`);
    });

    it("does not log as stopped a process that would not stop when it is refused", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), {
        env: profileEnv({ credentialsFile, configFile }, { AWS_PROFILE: undefined }),
        isAlive: (p) => p === 4242,
      });

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(await logLines()).not.toContain("stopped process 4242");
    });

    it("names a process that would not stop when it is refused", async () => {
      await writeJournalFile(journal({ state: "deleted", pids: [pid] }));
      const h = harness(new FakeAdmin(), {
        env: profileEnv({ credentialsFile, configFile }, { AWS_PROFILE: undefined }),
        isAlive: (p) => p === 4242,
      });

      expect(await runKeeper(journalPath, h.deps)).toBe(1);

      expect(h.kill).toHaveBeenCalledWith(4242, "SIGKILL");
      expect(h.printed.slice(1)).toEqual(["left behind:", "process 4242"]);
    });
  });
});

describe("terminalPrinter", () => {
  /** A terminal closed after the keeper started: each write fails as an `error` event, not a throw. */
  class ClosedTerminal extends Writable {
    readonly isTTY = true;
    readonly writes: string[] = [];
    override _write(chunk: Buffer, _encoding: string, done: (error?: Error) => void): void {
      this.writes.push(chunk.toString());
      done(Object.assign(new Error("write EIO"), { code: "EIO" }));
    }
  }

  it("survives a terminal that closed, and writes nothing more to it", async () => {
    const terminal = new ClosedTerminal();
    const print = terminalPrinter(terminal);
    print("first");
    await new Promise((resolve) => setImmediate(resolve));
    print("second");
    await new Promise((resolve) => setImmediate(resolve));
    expect(terminal.writes).toEqual(["first\n"]);
  });

  it("writes nothing when the keeper has no terminal", () => {
    const write = vi.fn();
    terminalPrinter({ isTTY: false, write, on: vi.fn() })("line");
    expect(write).not.toHaveBeenCalled();
  });
});

import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUCKET,
  FakeAdmin,
  NONCE,
  RUN_ID,
  START_TIME,
  sdkError,
  profileEnv,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { journalFileName, type RehearsalJournal } from "./aws-rehearsal-journal.js";
import { type KeeperDeps, keeperLogPath, runKeeper } from "./aws-rehearsal-keeper.js";
import { type AwsReceipt, cleanupCommandFor } from "./aws-rehearsal-receipt.js";
import { currentRequestScope, uninstallSendGate } from "./aws-send-gate.js";

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
    let end!: () => void;
    const h = harness(fake, {
      waitForRunnerEnd: () =>
        new Promise<void>((resolve) => {
          end = resolve;
        }),
    });
    const status = runKeeper(journalPath, h.deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.calls).toEqual([]);
    await writeJournalFile(journal({ state: "finished", scratchRoot: scratchRoot() }));
    end();
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
    expect(h.kill).not.toHaveBeenCalled();
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
    expect(fake.calls).toEqual([]);
    expect(h.removeDir).not.toHaveBeenCalled();
    expect((await logLines()).at(-1)).toBe("exit 1");
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
    let end!: () => void;
    const fake = bucketWithObjects();
    const h = harness(fake, {
      waitForRunnerEnd: () =>
        new Promise<void>((resolve) => {
          end = resolve;
        }),
    });
    const status = runKeeper(journalPath, h.deps);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await writeFile(journalPath, "{not json");
    end();
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
});

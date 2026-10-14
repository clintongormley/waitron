import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Answer,
  BUCKET,
  FakeAdmin,
  type FakeHarness,
  ok,
  profileEnv,
  RUN_ID,
  rejection,
  SECRET,
  KEY_ID,
  sdkError,
  START_TIME,
  SUFFIX,
  fakeHarness,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import {
  journalFileName,
  readJournal,
  type RehearsalJournal,
  writeJournal,
} from "./aws-rehearsal-journal.js";
import {
  type AwsReceipt,
  cleanupCommandFor,
  isReceiptCleanupCommand,
  receiptFileName,
} from "./aws-rehearsal-receipt.js";
import { AwsRehearsalRefused, type AwsRehearsalDeps, withAwsRehearsal } from "./aws-rehearsal.js";

let dir: string;
let receiptDir: string;
let scratchBase: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-journal-"));
  receiptDir = join(dir, "receipts");
  scratchBase = await mkdtemp(join(tmpdir(), "aws-rehearsal-journal-base-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(scratchBase, { recursive: true, force: true });
});

const DEADLINE_MS = 60_000;
const SETTLE_MS = 10;
const TEARDOWN_MS = 30_000;

function harness(
  answers: Record<string, Answer> = {},
  extra: Partial<AwsRehearsalDeps> = {},
): FakeHarness {
  const h = fakeHarness(
    new FakeAdmin({ answers }),
    profileEnv({ credentialsFile, configFile }),
    "2026-10-14T10:00:00.000Z",
  );
  h.deps = {
    ...h.deps,
    randomSuffix: () => SUFFIX,
    runId: () => RUN_ID,
    receiptDir,
    isAlive: () => false,
    kill: () => {},
    deadlineMs: DEADLINE_MS,
    settleMs: SETTLE_MS,
    teardownMs: TEARDOWN_MS,
    scratchBase,
    ...extra,
  };
  return h;
}

/** The states the journals passed through, a repeated state written once. */
function states(journals: readonly RehearsalJournal[]): string[] {
  return journals
    .map((journal) => journal.state)
    .filter((state, index, all) => index === 0 || all[index - 1] !== state);
}

function last(h: FakeHarness): RehearsalJournal {
  return h.journals.at(-1)!;
}

const receiptPath = (): string => join(receiptDir, `aws-rehearsal-${RUN_ID}.json`);

describe("the run's journal states", () => {
  it("a passing run: creating, owned, deleted, finished", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      ctx.trackChild(4242);
    }, h.deps);
    expect(states(h.journals)).toEqual(["creating", "owned", "deleted", "finished"]);
  });

  it.each([
    ["not-created", sdkError("AccessDenied", 403)],
    ["collision", sdkError("BucketAlreadyExists", 409)],
  ])("a create answered %s: creating, then that, then finished", async (state, error) => {
    const h = harness({
      CreateBucket: () => {
        throw error;
      },
    });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(states(h.journals)).toEqual(["creating", state, "finished"]);
  });

  it("a create with no answer stays creating until the run finishes", async () => {
    const h = harness({
      CreateBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(states(h.journals)).toEqual(["creating", "finished"]);
  });

  it("a run stopped before its create is not-created", async () => {
    const stop = new AbortController();
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          h.journals.push(structuredClone(journal));
          // Stopped after the first journal write, before the create is sent.
          if (journal.state === "creating") stop.abort();
        },
        signal: stop.signal,
      },
    );
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(h.fake.calls.map((call) => call.name)).not.toContain("CreateBucket");
    expect(states(h.journals)).toEqual(["creating", "not-created", "finished"]);
  });

  it("a failed DeleteBucket: never deleted, still finished", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("InternalError", 500, 3);
      },
    });
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(states(h.journals)).toEqual(["creating", "owned", "finished"]);
  });

  it("is deleted when DeleteBucket answers NoSuchBucket, as teardown counts it", async () => {
    const h = harness({
      DeleteBucket: () => {
        throw sdkError("NoSuchBucket", 404);
      },
    });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(states(h.journals)).toEqual(["creating", "owned", "deleted", "finished"]);
  });

  it("is written creating before CreateBucket is sent, and owned before the next command", async () => {
    const seen: Record<string, string | undefined> = {};
    const h = harness({
      CreateBucket: () => {
        seen.CreateBucket = last(h).state;
        return ok();
      },
      PutObject: () => {
        seen.PutObject ??= last(h).state;
        return ok();
      },
    });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(seen).toEqual({ CreateBucket: "creating", PutObject: "owned" });
  });

  it("writes finished only after the receipt is written and its path printed, as the last write", async () => {
    let atFinished: { receipt: boolean; printed: string[] } | undefined;
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          h.journals.push(structuredClone(journal));
          if (journal.state === "finished") {
            atFinished = { receipt: existsSync(receiptPath()), printed: [...h.printed] };
          }
        },
      },
    );
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(atFinished).toEqual({ receipt: true, printed: [receiptPath()] });
    expect(last(h).state).toBe("finished");
  });

  it("does not write finished when the receipt could not be written, so a keeper would still act", async () => {
    await writeFile(receiptDir, "not a folder");
    const h = harness();
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(states(h.journals)).toEqual(["creating", "owned", "deleted"]);
  });
});

describe("a kill can only find a journal naming every tracked pid, upload and scratch root", () => {
  it("names each pid, with its start time, before trackChild returns", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      ctx.trackChild(4242);
      expect(last(h).pids).toEqual([{ pid: 4242, startTime: START_TIME }]);
      ctx.trackChild(4343);
      expect(last(h).pids).toEqual([
        { pid: 4242, startTime: START_TIME },
        { pid: 4343, startTime: START_TIME },
      ]);
    }, h.deps);
  });

  it("records a pid whose start time cannot be read, with a null start time", async () => {
    const h = harness({}, { processStartTime: () => null });
    await withAwsRehearsal(async (ctx) => {
      ctx.trackChild(4242);
      expect(last(h).pids).toEqual([{ pid: 4242, startTime: null }]);
    }, h.deps);
  });

  it("names each upload before trackUpload returns", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      const key = `${ctx.prefix("up")}a.enc`;
      ctx.trackUpload(key, "upload-1");
      expect(last(h).uploads).toEqual([{ key, uploadId: "upload-1" }]);
    }, h.deps);
  });

  it("refuses to track an upload whose key carries the key pair, so the journal never holds it", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      const key = `${ctx.prefix("up")}${SECRET}.enc`;
      expect(() => ctx.trackUpload(key, "upload-1")).toThrow(AwsRehearsalRefused);
    }, h.deps);
    expect(JSON.stringify(h.journals)).not.toContain(SECRET);
  });

  it("refuses to track an upload whose key holds a control character, which the journal's reader refuses", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      const key = `${ctx.prefix("up")}a\u0001.enc`;
      let error: unknown;
      try {
        ctx.trackUpload(key, "upload-1");
      } catch (caught) {
        error = caught;
      }
      expect((error as AwsRehearsalRefused).reason).toBe("upload-id-refused");
      expect((error as Error).message).toContain(
        "an upload key the journal could not carry is not tracked",
      );
    }, h.deps);
    expect(h.journals.every((journal) => journal.uploads.length === 0)).toBe(true);
  });

  it("names the scratch root before the folder is made, and not before scratch is asked for", async () => {
    const root = join(scratchBase, `waitron-aws-rehearsal-${RUN_ID}`);
    let madeWhenNamed: boolean | undefined;
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          if (journal.scratchRoot !== null && madeWhenNamed === undefined) {
            madeWhenNamed = existsSync(root);
          }
          h.journals.push(structuredClone(journal));
        },
      },
    );
    await withAwsRehearsal(async (ctx) => {
      expect(last(h).scratchRoot).toBeNull();
      const making = ctx.scratch("a");
      expect(last(h).scratchRoot).toBe(root);
      await making;
    }, h.deps);
    expect(madeWhenNamed).toBe(false);
  });
});

describe("what the journal carries", () => {
  it("the run, the bucket, the receipt header, the limits and the keeper's ceiling", async () => {
    const h = harness();
    await withAwsRehearsal(async () => undefined, h.deps);
    const receipt = JSON.parse(await readFile(receiptPath(), "utf8")) as AwsReceipt;
    const { runId, region, ...header }: Partial<AwsReceipt["header"]> = receipt.header;
    delete header.finishedAt;
    expect(h.journals[0]).toEqual({
      version: 1,
      runId,
      region,
      bucket: BUCKET,
      state: "creating",
      uploads: [],
      pids: [],
      scratchRoot: null,
      receiptDir,
      header,
      teardownMs: TEARDOWN_MS,
      keeperCeilingMs: 2 * (DEADLINE_MS + SETTLE_MS + TEARDOWN_MS),
      keeperPid: null,
      ready: null,
    });
  });

  it("an endpoint only when one was set", async () => {
    const h = harness({}, { endpoint: "http://127.0.0.1:7070" });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(h.journals.every((journal) => journal.endpoint === "http://127.0.0.1:7070")).toBe(true);
  });

  it("through the real writer, a file the reader accepts, finished", async () => {
    const h = harness({}, { journal: writeJournal, scratchBase: tmpdir() });
    await withAwsRehearsal(async (ctx) => {
      ctx.trackChild(4242);
      await ctx.scratch("a");
    }, h.deps);
    const text = await readFile(join(receiptDir, journalFileName(RUN_ID)), "utf8");
    const read = readJournal(text, { tmpdir: tmpdir() });
    expect(read).toMatchObject({
      state: "finished",
      pids: [{ pid: 4242, startTime: START_TIME }],
      scratchRoot: join(tmpdir(), `waitron-aws-rehearsal-${RUN_ID}`),
    });
  });
});

describe("a journal that cannot be written", () => {
  it("before CreateBucket, refuses the run with nothing sent", async () => {
    const h = harness(
      {},
      {
        journal: () => {
          throw new Error("disk full");
        },
      },
    );
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("journal-unwritable");
    expect(h.fake.calls).toEqual([]);
  });

  it("after CreateBucket, is recorded and fails the run, and teardown still deletes the bucket", async () => {
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          if (journal.state !== "creating") throw new Error("disk full");
          h.journals.push(structuredClone(journal));
        },
      },
    );
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.trackChild(4242);
      }, h.deps),
    );
    expect(messagesOf(error)).toEqual([
      "AwsRehearsalFailed: 3 journal writes failed, so the journal may not have named everything this run made",
      "AwsRehearsalFailed: the journal was not marked finished",
    ]);
    expect(h.fake.calls.map((call) => call.name)).toContain("DeleteBucket");
    const receipt = JSON.parse(await readFile(receiptPath(), "utf8")) as AwsReceipt;
    expect(receipt.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(
      receipt.events.filter((event) => event.phase === "journal").map((event) => event.outcome),
    ).toEqual(["failed", "failed", "failed"]);
  });
});

function messagesOf(error: Error): string[] {
  return ((error as Partial<AggregateError>).errors ?? []).map(
    (each: Error) => `${each.name}: ${each.message}`,
  );
}

describe("a journal that cannot be written, round 1", () => {
  it("names one failed write in the singular", async () => {
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          if (journal.pids.length > 0 && journal.state === "owned") throw new Error("disk full");
          h.journals.push(structuredClone(journal));
        },
      },
    );
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.trackChild(4242);
      }, h.deps),
    );
    expect(`${error.name}: ${error.message}`).toBe(
      "AwsRehearsalFailed: 1 journal write failed, so the journal may not have named everything this run made",
    );
    expect(last(h).state).toBe("finished");
  });

  it("names only the unfinished journal when that is the one write that failed", async () => {
    const h = harness(
      {},
      {
        journal: (_dir, journal) => {
          if (journal.state === "finished") throw new Error("disk full");
          h.journals.push(structuredClone(journal));
        },
      },
    );
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(`${error.name}: ${error.message}`).toBe(
      "AwsRehearsalFailed: the journal was not marked finished",
    );
  });

  it("refuses a journal holding the key pair, as a failed write, before the writer sees it", async () => {
    const h = harness({}, { endpoint: `http://127.0.0.1:7070/${KEY_ID}` });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("journal-unwritable");
    expect(h.journals).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });
});

describe("a journal refused at its first write", () => {
  it("says the journal would hold the key pair, not that it could not be written", async () => {
    const h = harness({}, { endpoint: `http://127.0.0.1:7070/${KEY_ID}` });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(error.message).toContain("the journal would hold the key pair; nothing was created");
    expect(error.message).not.toContain("could not be written");
    expect(error.message).not.toContain(KEY_ID);
  });

  it("still says a journal the writer failed on could not be written", async () => {
    const h = harness(
      {},
      {
        journal: () => {
          throw new Error("disk full");
        },
      },
    );
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(error.message).toContain(
      "the journal could not be written in the receipt folder; nothing was created",
    );
  });
});

describe("round 1: refusals before the first journal write", () => {
  it("a refused plan writes no journal and sends nothing", async () => {
    const h = harness({}, { apis: ["CreateBucket"] });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("plan-refused");
    expect(h.journals).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });

  it("writes finished when printing the receipt's path throws", async () => {
    const h = harness(
      {},
      {
        print: () => {
          throw new Error("stdout closed");
        },
      },
    );
    await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(existsSync(receiptPath())).toBe(true);
    expect(last(h).state).toBe("finished");
  });
});

describe("the interrupted receipt's name", () => {
  it("is aws-rehearsal-<runId>-interrupted.json", () => {
    expect(receiptFileName(RUN_ID, "interrupted")).toBe(`aws-rehearsal-${RUN_ID}-interrupted.json`);
  });

  it("refuses, before creating anything, a folder that fits the cleanup receipt's name but not the interrupted one's", async () => {
    const commandFor = (folder: string, name: string) =>
      cleanupCommandFor("eu-north-1", join(folder, name));
    const cleanupName = `aws-rehearsal-${RUN_ID}-cleanup.json`;
    const interruptedName = `aws-rehearsal-${RUN_ID}-interrupted.json`;
    const pad = 512 - commandFor(join(dir, "x"), cleanupName).length;
    const folder = join(dir, "x".repeat(1 + pad));
    expect(isReceiptCleanupCommand(commandFor(folder, cleanupName))).toBe(true);
    expect(isReceiptCleanupCommand(commandFor(folder, interruptedName))).toBe(false);
    const h = harness({}, { receiptDir: folder });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("receipt-dir-unsupported");
    expect(h.fake.calls).toEqual([]);
    expect(h.journals).toEqual([]);
  });

  it("refuses a run id that fits the cleanup receipt's name but not the interrupted one's", async () => {
    const runId = "r".repeat(56);
    const h = harness({}, { runId: () => runId });
    const error = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((error as AwsRehearsalRefused).reason).toBe("run-id-unsupported");
    expect(h.fake.calls).toEqual([]);
  });
});

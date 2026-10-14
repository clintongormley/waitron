import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import {
  journalFileName,
  processStartTime,
  readJournal,
  type RehearsalJournal,
  writeJournal,
} from "./aws-rehearsal-journal.js";

const RUN_ID = "run-0123456789";
const TMP = "/var/tmp-fixture";

function journal(overrides: Partial<RehearsalJournal> = {}): RehearsalJournal {
  return {
    version: 1,
    runId: RUN_ID,
    region: "eu-north-1",
    bucket: "waitron-rehearsal-waitron-abc123def456",
    state: "owned",
    uploads: [{ key: `rehearsal-${RUN_ID}/loop/part`, uploadId: "upload-1" }],
    pids: [
      { pid: 4242, startTime: "Wed Oct 14 10:00:00 2026" },
      { pid: 4343, startTime: null },
    ],
    scratchRoot: join(TMP, `waitron-aws-rehearsal-${RUN_ID}`),
    receiptDir: "/var/receipts",
    header: {
      commit: "0123456789abcdef",
      node: "v26.7.0",
      sdkVersion: "3.900.0",
      litestreamVersion: "0.5.0",
      startedAt: "2026-10-14T10:00:00.000Z",
      limits: { teardownMs: 120000 },
    },
    teardownMs: 120000,
    keeperCeilingMs: 1000000,
    keeperPid: null,
    ready: null,
    ...overrides,
  };
}

function text(value: unknown): string {
  return JSON.stringify(value);
}

function refusal(input: string): AwsRehearsalRefused {
  try {
    readJournal(input, { tmpdir: TMP });
  } catch (error) {
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("journal-refused");
    return error as AwsRehearsalRefused;
  }
  throw new Error("expected a refusal");
}

describe("readJournal", () => {
  it("reads back a journal it accepts, unchanged", () => {
    const written = journal({ endpoint: "http://127.0.0.1:7070" });
    expect(readJournal(text(written), { tmpdir: TMP })).toEqual(written);
    expect(readJournal(text(journal({ scratchRoot: null })), { tmpdir: TMP }).scratchRoot).toBe(
      null,
    );
    expect(
      readJournal(text(journal({ endpoint: "http://localhost:9000" })), { tmpdir: TMP }).endpoint,
    ).toBe("http://localhost:9000");
    for (const state of [
      "creating",
      "owned",
      "not-created",
      "collision",
      "deleted",
      "finished",
    ] as const) {
      expect(readJournal(text(journal({ state })), { tmpdir: TMP }).state).toBe(state);
    }
    expect(
      readJournal(text(journal({ keeperPid: 77, ready: true })), { tmpdir: TMP }),
    ).toMatchObject({ keeperPid: 77, ready: true });
  });

  it("refuses malformed JSON", () => {
    expect(refusal("{not json").message).toContain("journal");
    refusal("[]");
    refusal("null");
  });

  const SECRETISH = "SECRETVALUE0123";
  it.each<[string, Record<string, unknown>]>([
    ["version", { version: 2 }],
    ["runId", { runId: `${SECRETISH} with space` }],
    ["bucket", { bucket: `someone-elses-${SECRETISH}` }],
    ["region", { region: SECRETISH }],
    ["scratchRoot", { scratchRoot: `/home/${SECRETISH}` }],
    ["scratchRoot", { scratchRoot: join(TMP, `waitron-aws-rehearsal-${RUN_ID}`, "..", "..") }],
    ["scratchRoot", { scratchRoot: join(TMP, `waitron-aws-rehearsal-other-${SECRETISH}`) }],
    ["endpoint", { endpoint: `https://${SECRETISH}.s3.amazonaws.com` }],
    ["endpoint", { endpoint: `http://127.0.0.1:7070/${SECRETISH}` }],
    ["endpoint", { endpoint: "http://127.0.0.2:7070" }],
    ["endpoint", { endpoint: "http://localhost" }],
    ["pids", { pids: [{ pid: 0, startTime: null }] }],
    ["pids", { pids: [{ pid: -1, startTime: null }] }],
    ["pids", { pids: [{ pid: 1.5, startTime: null }] }],
    ["pids", { pids: [{ pid: 2 ** 53, startTime: null }] }],
    ["pids", { pids: [{ pid: "4242", startTime: null }] }],
    ["pids", { pids: [{ pid: 4242, startTime: `${SECRETISH}\n` }] }],
    ["pids", { pids: "4242" }],
    ["uploads", { uploads: [{ key: "k", uploadId: `https://${SECRETISH}` }] }],
    ["uploads", { uploads: [{ key: "k", uploadId: `has space ${SECRETISH}` }] }],
    ["uploads", { uploads: [{ key: "", uploadId: "upload-1" }] }],
    ["uploads", { uploads: [{ key: "k", uploadId: "u", extra: SECRETISH }] }],
    ["state", { state: `gone-${SECRETISH}` }],
    ["receiptDir", { receiptDir: `relative/${SECRETISH}` }],
    ["receiptDir", { receiptDir: `/a/../${SECRETISH}` }],
    ["header.commit", { header: { ...journal().header, commit: `${SECRETISH} x` } }],
    ["header.limits", { header: { ...journal().header, limits: { teardownMs: "1" } } }],
    ["teardownMs", { teardownMs: -1 }],
    ["keeperCeilingMs", { keeperCeilingMs: Number.NaN }],
    ["keeperPid", { keeperPid: 0 }],
    ["ready", { ready: "yes" }],
    [SECRETISH, { [SECRETISH]: 1 }],
    ["endpoint", { endpoint: "http://127.0.0.1:65536" }],
    ["endpoint", { endpoint: "http://127.0.0.1:080" }],
    ["endpoint", { endpoint: "http://localhost:0" }],
    ["receiptDir", { receiptDir: `/var/has space/${SECRETISH}` }],
    ["receiptDir", { receiptDir: `/var//${SECRETISH}` }],
    ["receiptDir", { receiptDir: `/var/${SECRETISH}/` }],
    ["pids", { pids: [{ pid: 4242, startTime: null, extra: SECRETISH }] }],
    ["pids", { pids: [{ pid: 1, startTime: null }] }],
    ["header", { header: { ...journal().header, extra: SECRETISH } }],
    ["uploads", { uploads: [{ key: "k".repeat(1025), uploadId: "upload-1" }] }],
    ["uploads", { uploads: [{ key: `a\n${SECRETISH}`, uploadId: "upload-1" }] }],
    ["uploads", { uploads: [{ key: `a\u0000${SECRETISH}`, uploadId: "upload-1" }] }],
    ["keeperCeilingMs", { keeperCeilingMs: 1e308 }],
    ["teardownMs", { teardownMs: 1e308 }],
  ])("refuses a bad %s, naming the field and never the value", (field, overrides) => {
    const error = refusal(text({ ...journal(), ...overrides }));
    if (field !== SECRETISH) expect(error.message).toContain(field);
    expect(error.message).not.toContain(SECRETISH);
  });

  it("accepts the edges it allows: port 65535, a 1024-character key, pid 2", () => {
    const read = readJournal(
      text(
        journal({
          endpoint: "http://localhost:65535",
          uploads: [{ key: "k".repeat(1024), uploadId: "upload-1" }],
          pids: [{ pid: 2, startTime: null }],
          keeperCeilingMs: 24 * 60 * 60_000,
        }),
      ),
      { tmpdir: TMP },
    );
    expect(read.endpoint).toBe("http://localhost:65535");
    expect(read.pids).toEqual([{ pid: 2, startTime: null }]);
  });

  it("refuses a journal missing a field", () => {
    const rest: Partial<RehearsalJournal> = journal();
    delete rest.bucket;
    expect(refusal(text(rest)).message).toContain("bucket");
  });
});

describe("writeJournal", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "aws-rehearsal-journal-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("names the file after the run", () => {
    expect(journalFileName(RUN_ID)).toBe(`aws-rehearsal-${RUN_ID}-journal.json`);
  });

  it("writes the whole journal in one rename, readable only by its owner, leaving no temporary file", async () => {
    const receipts = join(dir, "receipts");
    writeJournal(receipts, journal());
    writeJournal(receipts, journal({ state: "deleted" }));
    const path = join(receipts, journalFileName(RUN_ID));
    expect(await readdir(receipts)).toEqual([journalFileName(RUN_ID)]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(readJournal(await readFile(path, "utf8"), { tmpdir: TMP }).state).toBe("deleted");
  });

  it("replaces the file rather than writing into it, so a reader holding the old one sees it whole", () => {
    const receipts = join(dir, "receipts");
    writeJournal(receipts, journal({ state: "creating" }));
    const path = join(receipts, journalFileName(RUN_ID));
    const before = statSync(path).ino;
    const held = openSync(path, "r");
    try {
      writeJournal(receipts, journal({ state: "owned" }));
      expect(statSync(path).ino).not.toBe(before);
      expect(readJournal(readFileSync(held, "utf8"), { tmpdir: TMP }).state).toBe("creating");
    } finally {
      closeSync(held);
    }
    expect(readJournal(readFileSync(path, "utf8"), { tmpdir: TMP }).state).toBe("owned");
  });

  it("is synchronous: the file holds the journal as soon as the call returns", () => {
    const receipts = join(dir, "receipts");
    writeJournal(receipts, journal({ state: "creating" }));
    const read = readFileSync(join(receipts, journalFileName(RUN_ID)), "utf8");
    expect(readJournal(read, { tmpdir: TMP }).state).toBe("creating");
  });
});

describe("processStartTime", () => {
  it("reads this process's start time as ps prints it", () => {
    const started = processStartTime(process.pid);
    expect(started).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/);
  });

  it("answers null for a pid ps cannot read", () => {
    expect(processStartTime(2 ** 22 + 12345)).toBeNull();
  });
});

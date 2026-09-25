import { describe, expect, it } from "vitest";
import { COMMIT_GRANULARITY_MS, CommitLog, computeLag } from "./freshness.js";

const at = (iso: string) => Date.parse(iso);
const MINUTE = 60_000;

describe("computeLag", () => {
  it("is zero with nothing committed", () => {
    expect(
      computeLag({
        pending: [],
        newestUploadAt: null,
        skewMs: 0,
        now: at("2026-09-23T12:00:00Z"),
      }),
    ).toEqual({ lagMs: 0, coveredUpTo: null });
  });

  // Not time since the last upload: a quiet night after a good copy is not stale.
  it("is zero overnight when the newest upload came after the last commit", () => {
    const { lagMs } = computeLag({
      pending: [[at("2026-09-23T23:00:00Z"), at("2026-09-23T23:00:00Z")]],
      newestUploadAt: new Date("2026-09-23T23:00:05Z"),
      skewMs: 0,
      now: at("2026-09-24T08:00:00Z"),
    });
    expect(lagMs).toBe(0);
  });

  it("is how long the oldest commit after the newest upload has waited", () => {
    const { lagMs } = computeLag({
      pending: [[at("2026-09-23T12:00:00Z"), at("2026-09-23T12:00:00Z")]],
      newestUploadAt: new Date("2026-09-23T11:59:00Z"),
      skewMs: 0,
      now: at("2026-09-23T12:20:00Z"),
    });
    expect(lagMs).toBe(20 * MINUTE);
  });

  it("is how long the oldest commit has waited when nothing has been uploaded yet", () => {
    const { lagMs } = computeLag({
      pending: [[at("2026-09-23T12:00:00Z"), at("2026-09-23T12:00:09Z")]],
      newestUploadAt: null,
      skewMs: 0,
      now: at("2026-09-23T12:05:00Z"),
    });
    expect(lagMs).toBe(5 * MINUTE);
  });

  // The bucket's clock runs AHEAD of this box's (a box without network time, running slow).
  // Unconverted, an upload stamped by the bucket after a commit would be read as covering it
  // although it happened before it, and the copy would read "current".
  it("does not read a bucket whose clock runs ahead as holding changes it has not got", () => {
    const input = {
      pending: [[at("2026-09-23T12:10:00Z"), at("2026-09-23T12:10:00Z")] as const],
      // Stamped by the bucket at 12:15, which is 12:05 on this box: before the commit.
      newestUploadAt: new Date("2026-09-23T12:15:00Z"),
      now: at("2026-09-23T12:30:00Z"),
    };
    expect(computeLag({ ...input, skewMs: 10 * MINUTE }).lagMs).toBe(20 * MINUTE);
    expect(computeLag({ ...input, skewMs: 0 }).lagMs).toBe(0);
  });

  it("converts the bucket's clock to this box's before comparing", () => {
    // The bucket's clock runs ten minutes behind this box's.
    const input = {
      pending: [[at("2026-09-23T12:10:00Z"), at("2026-09-23T12:10:00Z")] as const],
      newestUploadAt: new Date("2026-09-23T12:00:01Z"),
      now: at("2026-09-23T12:30:00Z"),
    };
    expect(computeLag({ ...input, skewMs: -10 * MINUTE }).lagMs).toBe(0);
    expect(computeLag({ ...input, skewMs: 0 }).lagMs).toBe(20 * MINUTE);
  });

  // A run keeps only its first and last commit, so which commits inside it the upload holds is
  // unknown; it counts from just after the upload.
  it("counts a run that straddles the newest upload from just after the upload", () => {
    const { lagMs, coveredUpTo } = computeLag({
      pending: [[at("2026-09-23T12:00:00Z"), at("2026-09-23T12:00:08Z")]],
      newestUploadAt: new Date("2026-09-23T12:00:04Z"),
      skewMs: 0,
      now: at("2026-09-23T12:10:04Z"),
    });
    expect(coveredUpTo).toBe(at("2026-09-23T12:00:04Z"));
    expect(lagMs).toBe(10 * MINUTE - 1);
  });

  it("is never negative when this box's clock steps back behind a pending commit", () => {
    const { lagMs } = computeLag({
      pending: [[at("2026-09-23T12:10:00Z"), at("2026-09-23T12:10:00Z")]],
      newestUploadAt: null,
      skewMs: 0,
      now: at("2026-09-23T12:05:00Z"),
    });
    expect(lagMs).toBe(0);
  });
});

describe("CommitLog", () => {
  it("keeps commits closer together than the granularity as one run", () => {
    const log = new CommitLog();
    log.record(at("2026-09-23T12:00:00Z"));
    log.record(at("2026-09-23T12:00:00Z") + COMMIT_GRANULARITY_MS - 1);
    log.record(at("2026-09-23T12:00:00Z") + COMMIT_GRANULARITY_MS);
    expect(log.pending()).toEqual([
      [at("2026-09-23T12:00:00Z"), at("2026-09-23T12:00:00Z") + COMMIT_GRANULARITY_MS - 1],
      [
        at("2026-09-23T12:00:00Z") + COMMIT_GRANULARITY_MS,
        at("2026-09-23T12:00:00Z") + COMMIT_GRANULARITY_MS,
      ],
    ]);
  });

  it("does not move a run's last commit backwards when a commit arrives out of order", () => {
    const log = new CommitLog();
    log.record(at("2026-09-23T12:00:05Z"));
    log.record(at("2026-09-23T12:00:02Z"));
    expect(log.pending()).toEqual([[at("2026-09-23T12:00:05Z"), at("2026-09-23T12:00:05Z")]]);
  });

  it("forgets what the bucket covers, and trims a run it covers part of", () => {
    const log = new CommitLog();
    log.record(at("2026-09-23T12:00:00Z"));
    log.record(at("2026-09-23T12:00:08Z"));
    log.record(at("2026-09-23T12:01:00Z"));
    log.settle(at("2026-09-23T12:00:04Z"));
    expect(log.pending()).toEqual([
      [at("2026-09-23T12:00:04Z") + 1, at("2026-09-23T12:00:08Z")],
      [at("2026-09-23T12:01:00Z"), at("2026-09-23T12:01:00Z")],
    ]);
    log.settle(at("2026-09-23T12:05:00Z"));
    expect(log.pending()).toEqual([]);
    log.settle(null);
    expect(log.pending()).toEqual([]);
  });

  // A box offline for a month, committing all day, then back: the whole backlog is settled on the
  // first good read, on the thread sales run on.
  it("settles a month of runs at once without stalling", () => {
    const log = new CommitLog();
    const start = at("2026-09-01T00:00:00Z");
    const runs = (30 * 24 * 60 * 60_000) / COMMIT_GRANULARITY_MS;
    for (let i = 0; i < runs; i += 1) log.record(start + i * COMMIT_GRANULARITY_MS);
    expect(log.pending()).toHaveLength(runs);
    const started = performance.now();
    log.settle(start + (runs - 2) * COMMIT_GRANULARITY_MS);
    expect(performance.now() - started).toBeLessThan(500);
    expect(log.pending()).toEqual([
      [start + (runs - 1) * COMMIT_GRANULARITY_MS, start + (runs - 1) * COMMIT_GRANULARITY_MS],
    ]);
  });

  it("keeps everything when the bucket covers nothing yet", () => {
    const log = new CommitLog();
    log.record(at("2026-09-23T12:00:00Z"));
    log.settle(null);
    expect(log.pending()).toEqual([[at("2026-09-23T12:00:00Z"), at("2026-09-23T12:00:00Z")]]);
  });
});

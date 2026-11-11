import { describe, expect, it } from "vitest";
import { jobFailingAlertSource } from "./alert-sources.js";
import type { JobView } from "./job-runner.js";

const NOW = new Date("2026-11-11T12:00:00Z");
const SINCE = "2026-11-11T11:50:00.000Z";
const view: JobView = {
  kind: "job",
  detail: null,
  state: "waiting",
  judged: false,
  lastTurnAt: null,
  lastRunAt: null,
  lastOkAt: null,
  consecutiveFailures: 3,
  failingSince: SINCE,
  throwsSinceClean: 3,
  throwingSince: SINCE,
  lastErrorCode: "unknown",
  nextDueAt: null,
  ownFailureAlert: null,
};
const ctx = { tx: {} as never, now: NOW };

describe("jobFailingAlertSource", () => {
  it.each([
    ["two throws", { throwsSinceClean: 2 }],
    ["three recent throws", { throwingSince: "2026-11-11T11:50:00.001Z" }],
    ["its own failure alert", { ownFailureAlert: "fiscal.awaiting_certificate" }],
    ["degraded passes alone", { consecutiveFailures: 40, throwsSinceClean: 0 }],
    [
      "one throw followed by hours of degraded passes",
      {
        consecutiveFailures: 40,
        throwsSinceClean: 1,
        throwingSince: "2026-11-11T08:00:00Z",
      },
    ],
    ["a clean pass", { throwsSinceClean: 0, throwingSince: null }],
  ] satisfies [string, Partial<JobView>][])("raises nothing for %s", async (_name, change) => {
    const source = jobFailingAlertSource({
      views: () => ({ "mail.send": { ...view, ...change } }),
      now: () => NOW,
    });
    expect(await source.read(ctx)).toEqual([]);
  });

  it("raises one alert per failing job, using its judgement and first throw", async () => {
    const source = jobFailingAlertSource({
      views: () => ({ "mail.send": view, "fiscal.drain": { ...view, judged: true } }),
      now: () => NOW,
    });
    expect(source.area).toBe("box");
    expect(source.permission).toBe("system.manage");
    expect(await source.read(ctx)).toEqual([
      {
        key: "job.failing:mail.send",
        code: "job.failing",
        params: { job: "mail.send" },
        severity: "warning",
        since: SINCE,
        screen: "box-status",
      },
      {
        key: "job.failing:fiscal.drain",
        code: "job.failing",
        params: { job: "fiscal.drain" },
        severity: "error",
        since: SINCE,
        screen: "box-status",
      },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { checkTimeHealth, type CommandRunner } from "./time-health.js";

const runnerReturning =
  (stdout: string): CommandRunner =>
  async () => ({ stdout });
const runnerThrowing = (): CommandRunner => async () => {
  const err = new Error("spawn timedatectl ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  throw err;
};

describe("checkTimeHealth", () => {
  it("reports synced when timedatectl says NTPSynchronized=yes", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("yes\n") });
    expect(health).toEqual({ synced: true, source: "timedatectl", warn: false });
  });

  it("warns when timedatectl says NTPSynchronized=no", async () => {
    const health = await checkTimeHealth({ run: runnerReturning("no\n") });
    expect(health).toEqual({ synced: false, source: "timedatectl", warn: true });
  });

  it("degrades to unavailable without warning when timedatectl is absent", async () => {
    const health = await checkTimeHealth({ run: runnerThrowing() });
    expect(health).toEqual({ synced: false, source: "unavailable", warn: false });
  });
});

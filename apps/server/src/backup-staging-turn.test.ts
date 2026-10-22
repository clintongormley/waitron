import { describe, expect, it } from "vitest";
import { createStagingTurn } from "./backup-staging-turn.js";

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** Lets every queued continuation run, so a step that is not blocked has happened. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("createStagingTurn", () => {
  it("runBackup answers its work's value, and a throwing work rethrows and frees the turn", async () => {
    const turn = createStagingTurn();
    await expect(turn.runBackup(async () => 42)).resolves.toBe(42);
    await expect(
      turn.runBackup(async () => {
        throw new Error("the copy failed");
      }),
    ).rejects.toThrow("the copy failed");
    expect(turn.backupRunning()).toBe(false);
    await expect(turn.ifNoBackup(async () => "freed")).resolves.toEqual({
      ran: true,
      value: "freed",
    });
  });

  it("two runs go one after the other, in the order they asked", async () => {
    const turn = createStagingTurn();
    const events: string[] = [];
    const first = deferred();
    const a = turn.runBackup(async () => {
      events.push("a:start");
      await first.promise;
      events.push("a:end");
    });
    const b = turn.runBackup(async () => {
      events.push("b:start");
      events.push("b:end");
    });
    await settle();
    expect(events).toEqual(["a:start"]);
    first.release();
    await Promise.all([a, b]);
    expect(events).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("while a run holds the turn, a deletion answers ran: false at once without running", async () => {
    const turn = createStagingTurn();
    const held = deferred();
    const run = turn.runBackup(() => held.promise);
    await settle();
    expect(turn.backupRunning()).toBe(true);
    let deletionRan = false;
    const answer = await turn.ifNoBackup(async () => {
      deletionRan = true;
    });
    expect(answer).toEqual({ ran: false });
    expect(deletionRan).toBe(false);
    held.release();
    await run;
    expect(turn.backupRunning()).toBe(false);
  });

  it("while a deletion holds the turn, a run waits and is not counted as running", async () => {
    const turn = createStagingTurn();
    const deletion = deferred();
    const run = deferred();
    let runStarted = false;
    const freeing = turn.ifNoBackup(() => deletion.promise);
    const backup = turn.runBackup(async () => {
      runStarted = true;
      await run.promise;
    });
    await settle();
    expect(runStarted).toBe(false);
    expect(turn.backupRunning()).toBe(false);
    deletion.release();
    await expect(freeing).resolves.toEqual({ ran: true, value: undefined });
    await settle();
    expect(runStarted).toBe(true);
    expect(turn.backupRunning()).toBe(true);
    run.release();
    await backup;
    expect(turn.backupRunning()).toBe(false);
  });

  it("two overlapping deletions with no run asked both run, the second after the first", async () => {
    const turn = createStagingTurn();
    const events: string[] = [];
    const first = deferred();
    const d1 = turn.ifNoBackup(async () => {
      events.push("d1:start");
      expect(turn.backupRunning()).toBe(false);
      await first.promise;
      events.push("d1:end");
      return 1;
    });
    const d2 = turn.ifNoBackup(async () => {
      events.push("d2:start");
      expect(turn.backupRunning()).toBe(false);
      return 2;
    });
    await settle();
    expect(events).toEqual(["d1:start"]);
    expect(turn.backupRunning()).toBe(false);
    first.release();
    await expect(d1).resolves.toEqual({ ran: true, value: 1 });
    await expect(d2).resolves.toEqual({ ran: true, value: 2 });
    expect(events).toEqual(["d1:start", "d1:end", "d2:start"]);
    expect(turn.backupRunning()).toBe(false);
  });

  it("a deletion asked while a run waits is skipped, not queued", async () => {
    const turn = createStagingTurn();
    const events: string[] = [];
    const first = deferred();
    const d1 = turn.ifNoBackup(async () => {
      events.push("d1:start");
      await first.promise;
      events.push("d1:end");
    });
    const run = turn.runBackup(async () => {
      events.push("run:start");
    });
    await settle();
    const d2 = await turn.ifNoBackup(async () => {
      events.push("d2:start");
    });
    expect(d2).toEqual({ ran: false });
    expect(events).toEqual(["d1:start"]);
    first.release();
    await Promise.all([d1, run]);
    expect(events).toEqual(["d1:start", "d1:end", "run:start"]);
  });

  it("with nobody holding the turn, a deletion runs and answers its value", async () => {
    const turn = createStagingTurn();
    await expect(turn.ifNoBackup(async () => "done")).resolves.toEqual({
      ran: true,
      value: "done",
    });
    expect(turn.backupRunning()).toBe(false);
  });
});

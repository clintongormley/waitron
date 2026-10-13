import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import { cancellableWait, eachUntilFailure, throwIfCancelled } from "./store-call.js";

const never = () => new Promise<void>(() => {});

describe("throwIfCancelled", () => {
  it("throws the cancellation error for the operation and key once the signal is cancelled", () => {
    let thrown: unknown;
    try {
      throwIfCancelled(AbortSignal.abort(), "list", "venues/");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe("backup.stream_request_failed");
    expect((thrown as AppError).params).toEqual({
      operation: "list",
      key: "venues/",
      status: null,
      name: "AbortError",
    });
  });

  it("does nothing for a signal not cancelled, or none", () => {
    expect(() => throwIfCancelled(new AbortController().signal, "get", "k")).not.toThrow();
    expect(() => throwIfCancelled(undefined, "get", "k")).not.toThrow();
  });
});

describe("cancellableWait", () => {
  it("waits the whole time when nothing cancels it", async () => {
    const waited: number[] = [];
    await cancellableWait(
      async (ms) => {
        waited.push(ms);
      },
      200,
      new AbortController().signal,
    );
    expect(waited).toEqual([200]);
  });

  it("waits with no signal at all", async () => {
    let done = false;
    await cancellableWait(
      async () => {
        done = true;
      },
      200,
      undefined,
    );
    expect(done).toBe(true);
  });

  it("ends a wait that would never end when the signal is cancelled", async () => {
    const controller = new AbortController();
    const waiting = cancellableWait(never, 200, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(waiting).resolves.toBeUndefined();
  });

  it("does not wait at all on a signal already cancelled", async () => {
    let asked = false;
    await cancellableWait(
      () => {
        asked = true;
        return never();
      },
      200,
      AbortSignal.abort(),
    );
    expect(asked).toBe(false);
  });

  it("passes on a wait that fails", async () => {
    await expect(
      cancellableWait(
        () => Promise.reject(new Error("broken clock")),
        200,
        new AbortController().signal,
      ),
    ).rejects.toThrow("broken clock");
  });
});

describe("eachUntilFailure, cancelled", () => {
  it("starts nothing after the cancellation, and answers only once the work in flight has settled", async () => {
    const controller = new AbortController();
    const events: string[] = [];
    const work = async (item: number) => {
      events.push(`start ${item}`);
      if (item === 1) controller.abort();
      // Work that does not stop at the cancellation, as a request already answered would not.
      await delay(50);
      events.push(`end ${item}`);
    };
    await eachUntilFailure([0, 1, 2, 3, 4, 5], 2, work, controller.signal);
    events.push("answered");
    expect(events).toEqual(["start 0", "start 1", "end 0", "end 1", "answered"]);
  });

  it("does every item when nothing cancels it", async () => {
    const done: number[] = [];
    await eachUntilFailure(
      [0, 1, 2],
      2,
      async (item) => {
        done.push(item);
      },
      undefined,
    );
    expect(done.sort()).toEqual([0, 1, 2]);
  });

  it("rejects with the first failure once the work in flight has settled", async () => {
    const events: string[] = [];
    const work = async (item: number) => {
      events.push(`start ${item}`);
      if (item === 0) throw new Error("refused");
      await delay(30);
      events.push(`end ${item}`);
    };
    await expect(eachUntilFailure([0, 1, 2, 3], 2, work, undefined)).rejects.toThrow("refused");
    expect(events).toEqual(["start 0", "start 1", "end 1"]);
  });
});

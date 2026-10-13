import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { AppError } from "@waitron/shared";
import {
  abortableSleep,
  eachUntilFailure,
  sendUnlessCancelled,
  throwIfCancelled,
} from "./store-call.js";

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

// Its cases with a signal are in supervisor.test.ts, which uses it.
describe("abortableSleep with no signal", () => {
  it("sleeps the whole time", async () => {
    const started = performance.now();
    await abortableSleep(30, undefined);
    expect(performance.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe("sendUnlessCancelled", () => {
  const params = (error: unknown) => (error as AppError).params;
  const CANCELLED = { operation: "get", key: "k", status: null, name: "AbortError" };

  it("answers the cancellation at once, while the work is still pending", async () => {
    const controller = new AbortController();
    const pending = sendUnlessCancelled(
      () => new Promise<never>(() => {}),
      controller.signal,
      "get",
      "k",
    );
    controller.abort();
    expect(params(await pending.catch((error: unknown) => error))).toEqual(CANCELLED);
  });

  it("does not start the work on a signal already cancelled", async () => {
    let started = false;
    const answered = sendUnlessCancelled(
      async () => {
        started = true;
      },
      AbortSignal.abort(),
      "get",
      "k",
    );
    expect(params(await answered.catch((error: unknown) => error))).toEqual(CANCELLED);
    expect(started).toBe(false);
  });

  it("passes on the work's own answer or failure when nothing cancels it", async () => {
    const open = new AbortController().signal;
    await expect(sendUnlessCancelled(async () => 1, open, "get", "k")).resolves.toBe(1);
    await expect(
      sendUnlessCancelled(() => Promise.reject(new Error("refused")), open, "get", "k"),
    ).rejects.toThrow("refused");
    await expect(sendUnlessCancelled(async () => 2, undefined, "get", "k")).resolves.toBe(2);
  });

  it("leaves no unhandled failure when the work fails after the cancellation", async () => {
    const controller = new AbortController();
    let fail!: (error: Error) => void;
    const work = new Promise<never>((_resolve, reject) => (fail = reject));
    const pending = sendUnlessCancelled(() => work, controller.signal, "get", "k");
    controller.abort();
    await pending.catch(() => {});
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    fail(new Error("late"));
    await delay(20);
    process.off("unhandledRejection", record);
    expect(unhandled).toEqual([]);
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

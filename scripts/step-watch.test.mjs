import { EventEmitter } from "node:events";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers";
import { afterEach, describe, expect, it } from "vitest";
import { createStepWatch, reportStallAfter, watchFromAnotherThread } from "./step-watch.mjs";

function clock(...readings) {
  return () => readings.shift();
}

const scratch = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A file descriptor to report into, and a way to read what reached it. */
function reportFile() {
  const dir = mkdtempSync(join(tmpdir(), "step-watch-"));
  scratch.push(dir);
  const path = join(dir, "report");
  const fd = openSync(path, "w");
  return {
    fd,
    written: () => statSync(path).size > 0,
    read: () => readFileSync(path, "utf8"),
    close: () => closeSync(fd),
  };
}

/** Holds this thread inside one synchronous SQLite call for as long as `hold` runs. */
function databaseHolding(hold) {
  const db = new DatabaseSync(":memory:");
  db.function("hold", () => {
    hold();
    return 1;
  });
  return { query: () => db.prepare("select hold() as held").get(), close: () => db.close() };
}

function sleepHere(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

describe("createStepWatch", () => {
  it("returns each phase's value and lists every phase with its duration", async () => {
    const watch = createStepWatch({ now: clock(0, 40, 100, 350) });

    expect(await watch.phase("first", async () => "one")).toBe("one");
    expect(await watch.phase("second", () => "two")).toBe("two");

    expect(watch.summary()).toBe("first: 40 ms\nsecond: 250 ms");
  });

  it("lists only the slowest phases, slowest first, under their total, when given a limit", async () => {
    const watch = createStepWatch({ now: clock(0, 30, 30, 40, 40, 90) });
    await watch.phase("middling", () => undefined);
    await watch.phase("quick", () => undefined);
    await watch.phase("slow", () => undefined);

    expect(watch.summary(2)).toBe(
      "3 phases, 90 ms in all; the slowest:\nslow: 50 ms\nmiddling: 30 ms",
    );
  });

  it("records a phase that throws, and lets the error through", async () => {
    const watch = createStepWatch({ now: clock(0, 7) });

    await expect(
      watch.phase("refused", async () => {
        throw new Error("no such table");
      }),
    ).rejects.toThrow("no such table");

    expect(watch.summary()).toBe("refused: 7 ms");
  });

  it("names the phase still running, how long it has run and the process's active resources", async () => {
    const watch = createStepWatch({
      now: clock(0, 5, 10, 1510),
      resources: () => ["Timeout", "FSReqCallback"],
    });
    await watch.phase("done", () => undefined);
    const pending = watch.phase("stuck", () => new Promise(() => {}));

    expect(watch.stalled()).toBe(
      "Stalled in phase stuck after 1500 ms. Active resources: Timeout, FSReqCallback.\nPhases finished before it:\ndone: 5 ms",
    );
    void pending;
  });

  it("says when no phase was running", () => {
    const watch = createStepWatch({ now: clock(), resources: () => [] });

    expect(watch.stalled()).toBe(
      "Stalled between phases. Active resources: none.\nPhases finished before it:\n(none)",
    );
  });

  it("does not blame the last finished phase for a stall after it", async () => {
    const watch = createStepWatch({ now: clock(0, 4), resources: () => [] });
    await watch.phase("finished", () => undefined);

    expect(watch.stalled()).toBe(
      "Stalled between phases. Active resources: none.\nPhases finished before it:\nfinished: 4 ms",
    );
  });

  it("reads the real clock and the process's active resources by default", async () => {
    const watch = createStepWatch();
    const pending = watch.phase(
      "waiting on a timer",
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    expect(watch.stalled()).toMatch(
      /^Stalled in phase waiting on a timer after \d+ ms\. Active resources: .*Timeout/,
    );
    await pending;
    expect(watch.summary()).toMatch(/^waiting on a timer: \d+ ms$/);
  });

  it("replays the phases so far to a new observer, then tells it each phase as it starts and ends", async () => {
    const watch = createStepWatch({ now: clock(0, 3, 10, 12, 20, 25, 30, 31) });
    await watch.phase("done", () => undefined);
    let release;
    const running = watch.phase("running", () => new Promise((resolve) => (release = resolve)));
    const events = [];
    const stop = watch.observe((event) => events.push(event));
    release();
    await running;
    await watch.phase("next", () => undefined);
    stop();
    await watch.phase("unobserved", () => undefined);

    expect(events).toEqual([
      { finished: { label: "done", ms: 3 } },
      { started: "running", at: expect.any(Number) },
      { finished: { label: "running", ms: 2 } },
      { started: "next", at: expect.any(Number) },
      { finished: { label: "next", ms: 5 } },
    ]);
  });
});

describe("watchFromAnotherThread", () => {
  function answeredFlag(value) {
    const flag = new Int32Array(new SharedArrayBuffer(4));
    flag[0] = value;
    return flag;
  }

  function watchdog({ answered = 0 } = {}) {
    const port = new EventEmitter();
    const written = [];
    let fire;
    let delay;
    watchFromAnotherThread(
      port,
      { dueAt: 5000, ms: 3000, graceMs: 1000, answered: answeredFlag(answered), reportTo: 9 },
      {
        write: (fd, text) => written.push([fd, text]),
        now: () => 1000,
        setTimer: (callback, ms) => {
          fire = callback;
          delay = ms;
        },
      },
    );
    return { port, written, fire: () => fire(), delay: () => delay };
  }

  it("writes the phase still running, and the phases before it, when the test's thread has not answered", () => {
    const dog = watchdog();
    dog.port.emit("message", { finished: { label: "core/0008: migrate", ms: 40 } });
    dog.port.emit("message", { started: "core/0009: migrate", at: 400 });
    dog.fire();

    expect(dog.delay()).toBe(4000);
    expect(dog.written).toEqual([
      [
        9,
        "The test's thread has not run its 3000 ms deadline timer 1000 ms after it fell due: something synchronous is holding it. Stalled in phase core/0009: migrate after 600 ms.\nPhases finished before it:\ncore/0008: migrate: 40 ms\n",
      ],
    ]);
  });

  it("does not blame a finished phase for a stall after it", () => {
    const dog = watchdog();
    dog.port.emit("message", { started: "core/0008: migrate", at: 400 });
    dog.port.emit("message", { finished: { label: "core/0008: migrate", ms: 40 } });
    dog.fire();

    expect(dog.written[0][1]).toContain(
      "Stalled between phases.\nPhases finished before it:\ncore/0008: migrate: 40 ms\n",
    );
  });

  it("writes nothing when the test's thread has answered", () => {
    const dog = watchdog({ answered: 1 });
    dog.port.emit("message", { started: "core/0009: migrate", at: 400 });
    dog.fire();

    expect(dog.written).toEqual([]);
  });

  it("writes to the file descriptor with the real clock and timer by default", async () => {
    const report = reportFile();
    try {
      watchFromAnotherThread(new EventEmitter(), {
        dueAt: Date.now() + 10,
        ms: 5,
        graceMs: 5,
        answered: answeredFlag(0),
        reportTo: report.fd,
      });
      const giveUpAt = Date.now() + 5000;
      while (!report.written() && Date.now() < giveUpAt) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      report.close();
    }

    expect(report.read()).toBe(
      "The test's thread has not run its 5 ms deadline timer 5 ms after it fell due: something synchronous is holding it. Stalled between phases.\nPhases finished before it:\n(none)\n",
    );
  });
});

describe("reportStallAfter", () => {
  it("fails with the watch's report when the body outlives the deadline", async () => {
    const watch = createStepWatch({ resources: () => ["Timeout"] });

    await expect(
      reportStallAfter(watch, 20, () => watch.phase("hangs", () => new Promise(() => {}))),
    ).rejects.toThrow(
      /^Still running after \d+ ms, past the 20 ms deadline\. Stalled in phase hangs after \d+ ms\. Active resources: Timeout\./,
    );
  });

  it("says how long the body had really run when the thread reached the timer late", async () => {
    const watch = createStepWatch({ resources: () => [] });

    const error = await reportStallAfter(watch, 20, () =>
      watch.phase("held, then hangs", () => {
        sleepHere(150);
        return new Promise(() => {});
      }),
    ).catch((caught) => caught);

    const [, took] = /^Still running after (\d+) ms, past the 20 ms deadline\./.exec(error.message);
    expect(Number(took)).toBeGreaterThanOrEqual(150);
  });

  it("returns the body's value and clears its timer when the body finishes first", async () => {
    const cleared = [];
    const timers = {
      setTimer: () => "the timer",
      clearTimer: (timer) => cleared.push(timer),
    };

    expect(await reportStallAfter(createStepWatch(), 1000, async () => "migrated", timers)).toBe(
      "migrated",
    );
    expect(cleared).toEqual(["the timer"]);
  });

  it("reports the phase a synchronous call holds the thread in, from another thread, while it still holds it", async () => {
    const report = reportFile();
    let seenWhileHeld;
    const db = databaseHolding(() => {
      const giveUpAt = Date.now() + 5000;
      while (!report.written() && Date.now() < giveUpAt) sleepHere(20);
      seenWhileHeld = report.read();
    });
    const watch = createStepWatch();
    let outcome;
    try {
      await watch.phase("core/0008_before: migrate", () => undefined);
      outcome = await reportStallAfter(
        watch,
        100,
        () => watch.phase("core/0009_held: migrate", db.query),
        { graceMs: 100, reportTo: report.fd },
      ).catch((error) => error);
    } finally {
      db.close();
      report.close();
    }

    expect(seenWhileHeld).toMatch(
      /^The test's thread has not run its 100 ms deadline timer 100 ms after it fell due: something synchronous is holding it\. Stalled in phase core\/0009_held: migrate after \d+ ms\.\nPhases finished before it:\ncore\/0008_before: migrate: \d+ ms\n$/,
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.message).toMatch(/past the 100 ms deadline/);
  });

  it("fails with the watch's report when a synchronous call held the thread past the deadline and then let go", async () => {
    const report = reportFile();
    const db = databaseHolding(() => sleepHere(250));
    const watch = createStepWatch();
    try {
      await expect(
        reportStallAfter(watch, 110, () => watch.phase("core/0009_held: migrate", db.query), {
          reportTo: report.fd,
        }),
      ).rejects.toThrow(
        /^Finished after \d+ ms, past the 110 ms deadline\. 1 phase, \d+ ms in all; the slowest:\ncore\/0009_held: migrate: \d+ ms$/,
      );
    } finally {
      db.close();
      report.close();
    }
    expect(report.read()).toBe("");
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a deadline of %s before running the body",
    async (ms) => {
      let ran = false;
      await expect(
        reportStallAfter(createStepWatch(), ms, () => {
          ran = true;
        }),
      ).rejects.toThrow("The deadline must be a positive finite number of milliseconds");
      expect(ran).toBe(false);
    },
  );
});

import { EventEmitter } from "node:events";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { setTimeout } from "node:timers";
import { MessageChannel } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const monotonicMs = () => Number(process.hrtime.bigint() / 1_000_000n);

const openFileDescriptors = () => readdirSync("/dev/fd").length;

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
    const before = monotonicMs();
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

    const startedAt = events.filter((event) => event.started).map((event) => event.at);
    expect(startedAt.every((at) => at >= before && at <= monotonicMs())).toBe(true);
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
    const timers = [];
    let time = 1000;
    watchFromAnotherThread(
      port,
      {
        startedAt: 1000,
        idleMs: 3000,
        graceMs: 1000,
        answered: answeredFlag(answered),
        reportTo: 9,
      },
      {
        write: (fd, text) => written.push([fd, text]),
        now: () => time,
        setTimer: (callback, ms) => timers.push({ callback, ms }),
        receive: () => undefined,
      },
    );
    return {
      port,
      written,
      at: (now) => (time = now),
      delays: () => timers.map(({ ms }) => ms),
      fireAt: (now) => {
        time = now;
        timers.at(-1).callback();
      },
    };
  }

  it("writes the phase still running, and the phases before it, once the no-progress limit and the grace have passed since the last event", () => {
    const dog = watchdog();
    dog.port.emit("message", { finished: { label: "core/0008: migrate", ms: 40 }, at: 1200 });
    dog.port.emit("message", { started: "core/0009: migrate", at: 1400 });
    dog.fireAt(5000);

    expect(dog.written).toEqual([]);
    dog.fireAt(5400);

    expect(dog.delays()).toEqual([4000, 400]);
    expect(dog.written).toEqual([
      [
        9,
        "The test's thread has not run its 3000 ms no-progress timer 1000 ms after it fell due: something synchronous is holding it. Stalled in phase core/0009: migrate after 4000 ms.\nPhases finished before it:\ncore/0008: migrate: 40 ms\n",
      ],
    ]);
  });

  it("does not blame a finished phase for a stall after it", () => {
    const dog = watchdog();
    dog.port.emit("message", { started: "core/0008: migrate", at: 1400 });
    dog.port.emit("message", { finished: { label: "core/0008: migrate", ms: 40 }, at: 1440 });
    dog.fireAt(5440);

    expect(dog.written[0][1]).toContain(
      "Stalled between phases.\nPhases finished before it:\ncore/0008: migrate: 40 ms\n",
    );
  });

  it("counts from when it read an event that carries no time", () => {
    const dog = watchdog();
    dog.at(2000);
    dog.port.emit("message", { finished: { label: "core/0008: migrate", ms: 40 } });
    dog.fireAt(5000);
    dog.fireAt(6000);

    expect(dog.delays()).toEqual([4000, 1000]);
    expect(dog.written).toHaveLength(1);
  });

  it("counts from its own start, not from a replayed phase that started before it", () => {
    const dog = watchdog();
    dog.port.emit("message", { started: "core/0009: migrate", at: 200 });
    dog.fireAt(5000);

    expect(dog.written[0][1]).toContain("Stalled in phase core/0009: migrate after 4800 ms.");
  });

  it("reads the phases the test's thread already sent when its timer fires before they are delivered", () => {
    const { port1, port2 } = new MessageChannel();
    const written = [];
    try {
      port2.postMessage({ finished: { label: "core/0008: migrate", ms: 40 }, at: 300 });
      port2.postMessage({ started: "core/0009: migrate", at: 400 });
      watchFromAnotherThread(
        port1,
        { startedAt: 0, idleMs: 3000, graceMs: 1000, answered: answeredFlag(0), reportTo: 9 },
        {
          write: (fd, text) => written.push(text),
          now: () => 5000,
          setTimer: (callback) => callback(),
        },
      );
    } finally {
      port1.close();
    }

    expect(written).toEqual([
      "The test's thread has not run its 3000 ms no-progress timer 1000 ms after it fell due: something synchronous is holding it. Stalled in phase core/0009: migrate after 4600 ms.\nPhases finished before it:\ncore/0008: migrate: 40 ms\n",
    ]);
  });

  it("re-arms rather than reports when the events it had not yet read show progress", () => {
    const { port1, port2 } = new MessageChannel();
    const written = [];
    const delays = [];
    try {
      port2.postMessage({ started: "core/0009: migrate", at: 4500 });
      watchFromAnotherThread(
        port1,
        { startedAt: 0, idleMs: 3000, graceMs: 1000, answered: answeredFlag(0), reportTo: 9 },
        {
          write: (fd, text) => written.push(text),
          now: () => 5000,
          setTimer: (callback, ms) => {
            delays.push(ms);
            if (delays.length === 1) callback();
          },
        },
      );
    } finally {
      port1.close();
    }

    expect(written).toEqual([]);
    expect(delays).toEqual([0, 3500]);
  });

  it("arms its timer with no delay, not a negative one, when it starts after the time fell due", () => {
    let delay;
    watchFromAnotherThread(
      new EventEmitter(),
      { startedAt: 0, idleMs: 3000, graceMs: 1000, answered: answeredFlag(0), reportTo: 9 },
      { now: () => 5000, setTimer: (_, ms) => (delay = ms) },
    );

    expect(delay).toBe(0);
  });

  it("writes nothing when the test's thread has answered", () => {
    const dog = watchdog({ answered: 1 });
    dog.port.emit("message", { started: "core/0009: migrate", at: 1400 });
    dog.fireAt(9000);

    expect(dog.written).toEqual([]);
  });

  it("writes to the file descriptor when the time falls due on the shared monotonic clock, by default", async () => {
    const report = reportFile();
    const { port1 } = new MessageChannel();
    const startedAt = monotonicMs();
    let writtenAfter;
    try {
      watchFromAnotherThread(port1, {
        startedAt,
        idleMs: 50,
        graceMs: 50,
        answered: answeredFlag(0),
        reportTo: report.fd,
      });
      const giveUpAt = Date.now() + 5000;
      while (!report.written() && Date.now() < giveUpAt) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      writtenAfter = monotonicMs() - startedAt;
    } finally {
      port1.close();
      report.close();
    }

    expect(writtenAfter).toBeGreaterThanOrEqual(95);
    expect(report.read()).toBe(
      "The test's thread has not run its 50 ms no-progress timer 50 ms after it fell due: something synchronous is holding it. Stalled between phases.\nPhases finished before it:\n(none)\n",
    );
  });
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const threadCpuMs = () => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

describe("reportStallAfter", () => {
  it("passes a body whose phases keep moving, however long it runs in all and however little work it does", async () => {
    const watch = createStepWatch();
    const result = await reportStallAfter(
      watch,
      { workMs: 150, idleMs: 1000 },
      async () => {
        for (const label of ["one", "two", "three", "four", "five"]) {
          await watch.phase(label, () => wait(250));
        }
        return "migrated";
      },
      { cpuNow: () => 0 },
    );

    expect(result).toBe("migrated");
    expect(watch.summary(5)).toMatch(/^5 phases, (\d+) ms in all/);
    expect(Number(/(\d+) ms in all/.exec(watch.summary(5))[1])).toBeGreaterThanOrEqual(1000);
  });

  it("fails naming the phase that stopped when no phase starts or finishes for the no-progress limit", async () => {
    const watch = createStepWatch({ resources: () => ["Timeout"] });

    const error = await reportStallAfter(watch, { workMs: 2000, idleMs: 1000 }, async () => {
      for (const label of ["first", "second", "third", "fourth"]) {
        await watch.phase(label, () => wait(40));
      }
      await watch.phase("hangs", () => new Promise(() => {}));
    }).catch((caught) => caught);

    const [, took, gap] =
      /^Still running after (\d+) ms with no phase started or finished for (\d+) ms, past the 1000 ms no-progress limit\. Stalled in phase hangs after \d+ ms\. Active resources: Timeout\.\nPhases finished before it:\nfirst: \d+ ms\nsecond: \d+ ms\nthird: \d+ ms\nfourth: \d+ ms$/.exec(
        error.message,
      );
    expect(Number(gap)).toBeGreaterThanOrEqual(1000);
    expect(Number(took)).toBeGreaterThanOrEqual(Number(gap) + 160);
  });

  it("says how long the body had really run when the thread reached the timer late", async () => {
    const watch = createStepWatch({ resources: () => [] });

    const error = await reportStallAfter(watch, { workMs: 10_000, idleMs: 20 }, () =>
      watch.phase("held, then hangs", () => {
        sleepHere(150);
        return new Promise(() => {});
      }),
    ).catch((caught) => caught);

    const [, took, gap] =
      /^Still running after (\d+) ms with no phase started or finished for (\d+) ms, past the 20 ms no-progress limit\./.exec(
        error.message,
      );
    expect(Number(took)).toBeGreaterThanOrEqual(150);
    expect(Number(gap)).toBeGreaterThanOrEqual(150);
  });

  it("fails at the phase event that sees the body's processor time past its work budget, even if the body never finishes", async () => {
    let cpu = 0;
    const watch = createStepWatch({ now: clock(0, 5, 5, 9) });

    await expect(
      reportStallAfter(
        watch,
        { workMs: 100, idleMs: 10_000 },
        async () => {
          await watch.phase("light", () => {
            cpu = 40;
          });
          await watch.phase("heavy", () => {
            cpu = 140;
          });
          return new Promise(() => {});
        },
        { cpuNow: () => cpu },
      ),
    ).rejects.toThrow(
      /^Used 140 ms of processor time, past the 100 ms budget\. 2 phases, 9 ms in all; the slowest:\nlight: 5 ms\nheavy: 4 ms$/,
    );
  });

  it("fails when the body's processor time reaches its work budget after the last phase event", async () => {
    let cpu = 10;

    await expect(
      reportStallAfter(
        createStepWatch(),
        { workMs: 100, idleMs: 10_000 },
        async () => {
          cpu = 110;
          return "migrated";
        },
        { cpuNow: () => cpu },
      ),
    ).rejects.toThrow(
      /^Used 100 ms of processor time, past the 100 ms budget\. 0 phases, 0 ms in all; the slowest:\n$/,
    );
  });

  it("rejects with a body's synchronous error, leaving no unhandled rejection, when a phase event had already failed the work budget", async () => {
    const unhandled = [];
    const record = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    let cpu = 0;
    const watch = createStepWatch();
    try {
      await expect(
        reportStallAfter(
          watch,
          { workMs: 100, idleMs: 10_000 },
          () => {
            cpu = 140;
            void watch.phase("over budget", () => undefined);
            throw new Error("the body's own error");
          },
          { cpuNow: () => cpu },
        ),
      ).rejects.toThrow("the body's own error");
      await wait(50);
    } finally {
      process.off("unhandledRejection", record);
    }

    expect(unhandled.map((reason) => reason?.message)).toEqual([]);
  });

  it("measures the test thread's own processor time by default", async () => {
    const watch = createStepWatch();

    const error = await reportStallAfter(watch, { workMs: 100, idleMs: 10_000 }, () =>
      watch.phase("busy", () => {
        const until = threadCpuMs() + 150;
        while (threadCpuMs() < until);
      }),
    ).catch((caught) => caught);

    const [, used] = /^Used (\d+) ms of processor time, past the 100 ms budget\./.exec(
      error.message,
    );
    expect(Number(used)).toBeGreaterThanOrEqual(150);
  });

  it("does not count time spent waiting as work, by default", async () => {
    await expect(
      reportStallAfter(createStepWatch(), { workMs: 100, idleMs: 10_000 }, async () => {
        await wait(300);
        return "migrated";
      }),
    ).resolves.toBe("migrated");
  });

  it("returns the body's value and clears every timer it armed when the body finishes first", async () => {
    const armed = [];
    const cleared = [];
    const timers = {
      setTimer: (_, ms) => armed.push(ms),
      clearTimer: (timer) => cleared.push(timer),
    };
    const watch = createStepWatch();

    expect(
      await reportStallAfter(
        watch,
        { workMs: 5000, idleMs: 1000 },
        () => watch.phase("only", async () => "migrated"),
        timers,
      ),
    ).toBe("migrated");
    expect(armed).toEqual([1000, 1000, 1000]);
    expect(cleared).toEqual([1, 2, 3]);
  });

  it("reports the phase a synchronous call holds the thread in, from another thread, counting from the last phase event", async () => {
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
      outcome = await reportStallAfter(
        watch,
        { workMs: 10_000, idleMs: 1000 },
        async () => {
          // Each wait leaves the limit about 700 ms of room for a paused thread before the body
          // fails short of the held call; together they outlast the limit and the grace, so a
          // watchdog counting from its own start would name a phase before the held call.
          for (const tag of ["0005", "0006", "0007", "0008"]) {
            await watch.phase(`core/${tag}_before: migrate`, () => wait(300));
          }
          return watch.phase("core/0009_held: migrate", db.query);
        },
        { graceMs: 100, reportTo: report.fd },
      ).catch((error) => error);
    } finally {
      db.close();
      report.close();
    }

    expect(seenWhileHeld).toMatch(
      /^The test's thread has not run its 1000 ms no-progress timer 100 ms after it fell due: something synchronous is holding it\. Stalled in phase core\/0009_held: migrate after \d+ ms\.\nPhases finished before it:\ncore\/0005_before: migrate: \d+ ms\ncore\/0006_before: migrate: \d+ ms\ncore\/0007_before: migrate: \d+ ms\ncore\/0008_before: migrate: \d+ ms\n$/,
    );
    expect(outcome).toBeInstanceOf(Error);
    expect(outcome.message).toMatch(/past the 1000 ms no-progress limit/);
  });

  it("fails when a synchronous call held the thread inside a phase past the no-progress limit and then let go", async () => {
    const report = reportFile();
    const db = databaseHolding(() => sleepHere(250));
    const watch = createStepWatch();
    try {
      await expect(
        reportStallAfter(
          watch,
          { workMs: 10_000, idleMs: 110 },
          () => watch.phase("core/0009_held: migrate", db.query),
          { reportTo: report.fd },
        ),
      ).rejects.toThrow(
        /^No phase started or finished for \d+ ms, past the 110 ms no-progress limit, until phase core\/0009_held: migrate finished\. 1 phase, \d+ ms in all; the slowest:\ncore\/0009_held: migrate: \d+ ms$/,
      );
    } finally {
      db.close();
      report.close();
    }
    expect(report.read()).toBe("");
  });

  it("fails when the thread was held between phases past the no-progress limit, at the next phase's start", async () => {
    const watch = createStepWatch();

    await expect(
      reportStallAfter(watch, { workMs: 10_000, idleMs: 110 }, async () => {
        await watch.phase("before", () => undefined);
        sleepHere(250);
        await watch.phase("after", () => undefined);
      }),
    ).rejects.toThrow(
      /^No phase started or finished for (\d+) ms, past the 110 ms no-progress limit, until phase after started\. 1 phase, \d+ ms in all; the slowest:\nbefore: \d+ ms$/,
    );
  });

  it("fails when the thread was held past the no-progress limit after the last phase event", async () => {
    const watch = createStepWatch();

    await expect(
      reportStallAfter(watch, { workMs: 10_000, idleMs: 110 }, async () => {
        await watch.phase("last", () => undefined);
        sleepHere(250);
        return "migrated";
      }),
    ).rejects.toThrow(
      /^No phase started or finished for (\d+) ms, past the 110 ms no-progress limit, before the body finished\. 1 phase, \d+ ms in all; the slowest:\nlast: \d+ ms$/,
    );
  });

  it("writes no report when the body waits without holding the thread and finishes in time", async () => {
    const report = reportFile();
    try {
      await reportStallAfter(createStepWatch(), { workMs: 10_000, idleMs: 1000 }, () => wait(600), {
        graceMs: 1,
        reportTo: report.fd,
      });
    } finally {
      report.close();
    }

    expect(report.read()).toBe("");
  });

  it("has ended its watchdog thread by the time it returns", async () => {
    const limits = { workMs: 1000, idleMs: 1000 };
    await reportStallAfter(createStepWatch(), limits, () => undefined);
    const before = openFileDescriptors();

    await reportStallAfter(createStepWatch(), limits, () => undefined);

    expect(openFileDescriptors()).toBe(before);
  });

  it("warns, and leaves the body's result alone, when the watchdog thread cannot start", async () => {
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => undefined);
    try {
      const result = await reportStallAfter(
        createStepWatch(),
        { workMs: 5000, idleMs: 5000 },
        async () => {
          const giveUpAt = Date.now() + 4000;
          while (warn.mock.calls.length === 0 && Date.now() < giveUpAt) {
            await wait(10);
          }
          return "migrated";
        },
        {
          helper: pathToFileURL(join(import.meta.dirname, "no-such-step-watch.mjs")).href,
          cpuNow: () => 0,
        },
      );

      expect(result).toBe("migrated");
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("no-such-step-watch.mjs"),
        "StepWatchWarning",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a grace period of %s before running the body",
    async (graceMs) => {
      let ran = false;
      await expect(
        reportStallAfter(
          createStepWatch(),
          { workMs: 100, idleMs: 100 },
          () => {
            ran = true;
          },
          { graceMs },
        ),
      ).rejects.toThrow("The grace period must be a positive finite number of milliseconds");
      expect(ran).toBe(false);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses a work budget of %s before running the body",
    async (workMs) => {
      let ran = false;
      await expect(
        reportStallAfter(createStepWatch(), { workMs, idleMs: 100 }, () => {
          ran = true;
        }),
      ).rejects.toThrow("The work budget must be a positive finite number of milliseconds");
      expect(ran).toBe(false);
    },
  );

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, undefined])(
    "refuses a no-progress limit of %s before running the body",
    async (idleMs) => {
      let ran = false;
      await expect(
        reportStallAfter(createStepWatch(), { workMs: 100, idleMs }, () => {
          ran = true;
        }),
      ).rejects.toThrow("The no-progress limit must be a positive finite number of milliseconds");
      expect(ran).toBe(false);
    },
  );
});

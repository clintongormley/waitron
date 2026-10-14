import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Answer,
  FakeAdmin,
  RUN_ID,
  SUFFIX,
  fakeHarness,
  profileEnv,
  rejection,
  sdkError,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import type { AwsReceipt } from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  type AwsRehearsal,
  type AwsRehearsalDeps,
  withAwsRehearsal,
} from "./aws-rehearsal.js";

let dir: string;
let receiptDir: string;
let scratchBase: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-scratch-"));
  receiptDir = join(dir, "receipts");
  scratchBase = await mkdtemp(join(tmpdir(), "aws-rehearsal-scratch-base-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(scratchBase, { recursive: true, force: true });
});

function deps(
  answers: Record<string, Answer> = {},
  extra: Partial<AwsRehearsalDeps> = {},
): Partial<AwsRehearsalDeps> {
  const h = fakeHarness(
    new FakeAdmin({ answers }),
    profileEnv({ credentialsFile, configFile }),
    "2026-10-14T10:00:00.000Z",
  );
  return {
    ...h.deps,
    randomSuffix: () => SUFFIX,
    runId: () => RUN_ID,
    receiptDir,
    isAlive: () => false,
    kill: () => {},
    settleMs: 10,
    scratchBase,
    ...extra,
  };
}

function root(): string {
  return join(scratchBase, `waitron-aws-rehearsal-${RUN_ID}`);
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function receipt(): Promise<AwsReceipt> {
  const text = await readFile(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), "utf8");
  return JSON.parse(text) as AwsReceipt;
}

describe("AwsRehearsal.scratch", () => {
  it("makes a label folder under the run's root and removes the root on success", async () => {
    let folder: string | undefined;
    let existedDuringRun = false;
    await withAwsRehearsal(async (ctx) => {
      folder = await ctx.scratch("loop");
      await writeFile(join(folder, "secrets.env"), "KEY=value\n");
      existedDuringRun = await exists(join(folder, "secrets.env"));
    }, deps());
    expect(folder).toBe(join(root(), "loop"));
    expect(existedDuringRun).toBe(true);
    expect(await exists(root())).toBe(false);
    const { teardown } = await receipt();
    expect(teardown.at(-1)).toEqual({ step: "remove-scratch", outcome: "ok" });
    expect(JSON.stringify(await receipt())).not.toContain(scratchBase);
  });

  it("removes the root when the scenario fails", async () => {
    const thrown = new Error("scenario broke");
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        const folder = await ctx.scratch("archive");
        await writeFile(join(folder, "recovery-kit.txt"), "kit\n");
        throw thrown;
      }, deps()),
    );
    expect(error).toBe(thrown);
    expect(await exists(root())).toBe(false);
    expect((await receipt()).teardown.at(-1)).toEqual({ step: "remove-scratch", outcome: "ok" });
  });

  it("records a skipped step on an owned run that made no scratch, and removes nothing", async () => {
    const removeDir = vi.fn(async () => {});
    await withAwsRehearsal(async () => undefined, deps({}, { removeDir }));
    expect(removeDir).not.toHaveBeenCalled();
    expect((await receipt()).teardown.at(-1)).toEqual({
      step: "remove-scratch",
      outcome: "skipped",
    });
  });

  it("makes no scratch and records no step for a bucket never created", async () => {
    const removeDir = vi.fn(async () => {});
    const scenario = vi.fn(async () => undefined);
    await rejection(
      withAwsRehearsal(
        scenario,
        deps(
          {
            CreateBucket: () => {
              throw sdkError("AccessDenied", 403, 1);
            },
          },
          { removeDir },
        ),
      ),
    );
    expect(scenario).not.toHaveBeenCalled();
    expect(removeDir).not.toHaveBeenCalled();
    expect(await exists(root())).toBe(false);
    const parsed = await receipt();
    expect(parsed.ownership.state).toBe("not-created");
    expect(parsed.teardown).toEqual([]);
  });

  it("fails the run, naming the folder, when the removal fails", async () => {
    const removeDir = vi.fn(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          await ctx.scratch("delete");
        },
        deps({}, { removeDir }),
      ),
    );
    expect(removeDir).toHaveBeenCalledWith(root());
    expect(error.name).toBe("AwsRehearsalFailed");
    expect(error.message).toContain("remove-scratch");
    expect(error.message).toContain(root());
    const parsed = await receipt();
    expect(parsed.teardown.at(-1)).toEqual({
      step: "remove-scratch",
      outcome: "failed",
      errorName: "Error",
      httpStatus: null,
    });
    expect(parsed.remaining).toEqual({ bucket: null, uploadIds: [] });
    expect(JSON.stringify(parsed)).not.toContain(scratchBase);
  });

  it("refuses a second scratch with the same label", async () => {
    let refusal: unknown;
    await withAwsRehearsal(async (ctx) => {
      await ctx.scratch("loop");
      refusal = await ctx.scratch("loop").catch((error: unknown) => error);
    }, deps());
    expect(refusal).toBeInstanceOf(AwsRehearsalRefused);
    expect((refusal as AwsRehearsalRefused).reason).toBe("label-refused");
  });

  it.each(["", "../escape", "a/b", ".hidden", "x".repeat(65)])(
    "refuses the label %j",
    async (label) => {
      let refusal: unknown;
      await withAwsRehearsal(async (ctx) => {
        refusal = await ctx.scratch(label).catch((error: unknown) => error);
      }, deps());
      expect((refusal as AwsRehearsalRefused).reason).toBe("label-refused");
      expect(await exists(root())).toBe(false);
    },
  );

  it("refuses scratch once teardown has started", async () => {
    let kept: AwsRehearsal | undefined;
    await withAwsRehearsal(async (ctx) => {
      kept = ctx;
    }, deps());
    const refusal = await kept!.scratch("late").catch((error: unknown) => error);
    expect((refusal as AwsRehearsalRefused).reason).toBe("teardown-started");
    expect(await exists(root())).toBe(false);
  });

  describe("a scenario still running when teardown starts", () => {
    // Writes `secrets.env` every 5 ms, remaking its folder first, until `stop` or its own signal.
    function writer(honoursSignal: boolean) {
      let stop = false;
      let finished: Promise<void> | undefined;
      const scenario = (ctx: AwsRehearsal): Promise<void> => {
        finished = (async () => {
          const folder = await ctx.scratch("loop");
          while (!stop && !(honoursSignal && ctx.signal.aborted)) {
            await mkdir(folder, { recursive: true });
            await writeFile(join(folder, "secrets.env"), "KEY=value\n");
            await delay(5);
          }
        })();
        return finished;
      };
      return {
        scenario,
        async end() {
          stop = true;
          await finished;
        },
      };
    }

    it("records remove-scratch as failed and names the root when the settle wait runs out", async () => {
      const w = writer(false);
      const error = await rejection(
        withAwsRehearsal(w.scenario, deps({}, { deadlineMs: 30, settleMs: 20 })),
      );
      try {
        expect((await receipt()).teardown.at(-1)).toMatchObject({
          step: "remove-scratch",
          outcome: "failed",
          errorName: "ScenarioStillRunning",
        });
        expect(error.message).toContain(`scratch folder not removed: ${root()}`);
      } finally {
        await w.end();
      }
    });

    it("records remove-scratch as ok when the scenario stops within the settle wait", async () => {
      const w = writer(true);
      const error = await rejection(
        withAwsRehearsal(w.scenario, deps({}, { deadlineMs: 30, settleMs: 1_000 })),
      );
      await w.end();
      expect(error.message).toContain("deadline");
      expect(error.message).not.toContain("scratch folder not removed");
      expect((await receipt()).teardown.at(-1)).toEqual({ step: "remove-scratch", outcome: "ok" });
      expect(await exists(root())).toBe(false);
    });
  });

  it("records remove-scratch as failed when the root is back after the removal", async () => {
    const removeDir = vi.fn(async (path: string) => {
      await rm(path, { recursive: true, force: true });
      await mkdir(path);
    });
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          await ctx.scratch("loop");
        },
        deps({}, { removeDir }),
      ),
    );
    expect(error.message).toContain(`scratch folder not removed: ${root()}`);
    expect((await receipt()).teardown.at(-1)).toEqual({
      step: "remove-scratch",
      outcome: "failed",
      errorName: "ScratchRecreated",
      httpStatus: null,
    });
  });

  it("names the root on the top line when a scenario failure and a removal failure combine", async () => {
    const removeDir = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          await ctx.scratch("loop");
          throw new Error("scenario broke");
        },
        deps({}, { removeDir }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message.split("\n")[0]).toContain(`scratch folder not removed: ${root()}`);
  });

  it("names the root on the top line when a print failure and a removal failure combine", async () => {
    const removeDir = vi.fn(async () => {
      throw new Error("permission denied");
    });
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          await ctx.scratch("loop");
        },
        deps(
          {},
          {
            removeDir,
            print: () => {
              throw new Error("stdout closed");
            },
          },
        ),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toContain(`scratch folder not removed: ${root()}`);
  });

  it("names the root on the top line when the receipt is not written and the removal fails", async () => {
    const removeDir = vi.fn(async () => {
      throw new Error("permission denied");
    });
    // A file where the receipt folder should be, so writing the receipt fails.
    await writeFile(receiptDir, "not a folder");
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          await ctx.scratch("loop");
        },
        deps({}, { removeDir }),
      ),
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).toContain("receipt was not written");
    expect(error.message).toContain(`scratch folder not removed: ${root()}`);
  });
});

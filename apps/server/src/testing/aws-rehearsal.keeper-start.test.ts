import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FakeAdmin,
  type FakeHarness,
  profileEnv,
  RUN_ID,
  rejection,
  SUFFIX,
  fakeHarness,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { journalFileName } from "./aws-rehearsal-journal.js";
import type { AwsReceipt } from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  type AwsRehearsalDeps,
  keeperEnv,
  withAwsRehearsal,
} from "./aws-rehearsal.js";

let dir: string;
let receiptDir: string;
let scratchBase: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-rehearsal-keeper-start-"));
  receiptDir = join(dir, "receipts");
  scratchBase = await mkdtemp(join(tmpdir(), "aws-rehearsal-keeper-start-base-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(scratchBase, { recursive: true, force: true });
});

function harness(extra: Partial<AwsRehearsalDeps> = {}): FakeHarness {
  const h = fakeHarness(
    new FakeAdmin(),
    profileEnv({ credentialsFile, configFile }),
    "2026-10-14T10:00:00.000Z",
  );
  h.deps = {
    ...h.deps,
    randomSuffix: () => SUFFIX,
    runId: () => RUN_ID,
    receiptDir,
    isAlive: () => false,
    kill: () => {},
    deadlineMs: 60_000,
    settleMs: 10,
    teardownMs: 30_000,
    scratchBase,
    ...extra,
  };
  return h;
}

const receiptPath = (): string => join(receiptDir, `aws-rehearsal-${RUN_ID}.json`);

async function receipt(): Promise<AwsReceipt> {
  return JSON.parse(await readFile(receiptPath(), "utf8")) as AwsReceipt;
}

describe("withAwsRehearsal — starting the keeper", () => {
  it("starts it with the journal's path once the journal is written and before CreateBucket", async () => {
    const seen: { path: string; journals: number; state?: string; sent: string[] }[] = [];
    const h: FakeHarness = harness({
      startKeeper: async (path) => {
        seen.push({
          path,
          journals: h.journals.length,
          state: h.journals.at(-1)?.state,
          sent: h.fake.names(),
        });
        return { keeperPid: null, end: () => {} };
      },
    });
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(seen).toEqual([
      {
        path: join(receiptDir, journalFileName(RUN_ID)),
        journals: 1,
        state: "creating",
        sent: [],
      },
    ]);
  });

  it("hands the keeper the explicit environment, not the whole one", async () => {
    const envs: Record<string, string>[] = [];
    const h = harness({
      startKeeper: async (_path, env) => {
        envs.push({ ...env } as Record<string, string>);
        return { keeperPid: null, end: () => {} };
      },
    });
    h.deps.env = { ...h.deps.env, SOMETHING_ELSE: "not passed" };
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(envs).toEqual([keeperEnv(h.deps.env!)]);
    expect(envs[0]).not.toHaveProperty("SOMETHING_ELSE");
  });

  it.each([
    ["refuses", new AwsRehearsalRefused("keeper-unavailable", "the keeper did not start")],
    ["throws", new Error("spawn failed")],
  ])("refuses the run before CreateBucket when starting the keeper %s", async (_how, error) => {
    const h = harness({
      startKeeper: async () => {
        throw error;
      },
    });
    const refusal = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect(refusal).toBeInstanceOf(AwsRehearsalRefused);
    expect((refusal as AwsRehearsalRefused).reason).toBe("keeper-unavailable");
    expect(h.fake.names()).toEqual([]);
    expect(existsSync(receiptPath())).toBe(false);
  });

  it("carries the keeper's pid and readiness in every later journal", async () => {
    const h = harness({
      startKeeper: async () => ({ keeperPid: 7777, end: () => {} }),
    });
    await withAwsRehearsal(async (ctx) => {
      ctx.trackChild(4242);
    }, h.deps);
    expect(h.journals[0]).toMatchObject({ keeperPid: null, ready: null });
    const later = h.journals.slice(1);
    expect(later.length).toBeGreaterThan(2);
    for (const journal of later) expect(journal).toMatchObject({ keeperPid: 7777, ready: true });
  });

  it.each([
    ["passes", async () => undefined],
    [
      "fails",
      async () => {
        throw new Error("scenario failed");
      },
    ],
  ])(
    "ends the keeper's pipe once, after the journal is marked finished, when the run %s",
    async (_how, scenario) => {
      const ends: (string | undefined)[] = [];
      const h: FakeHarness = harness({
        startKeeper: async () => ({
          keeperPid: 7777,
          end: () => ends.push(h.journals.at(-1)?.state),
        }),
      });
      await withAwsRehearsal(scenario, h.deps).catch(() => undefined);
      expect(ends).toEqual(["finished"]);
    },
  );
});

describe("keeperEnv", () => {
  it("keeps only the names the keeper needs, and only those set", () => {
    expect(
      keeperEnv({
        WAITRON_RUN_AWS_REHEARSAL: "1",
        AWS_PROFILE: "waitron-rehearsal",
        AWS_REGION: "eu-north-1",
        AWS_SHARED_CREDENTIALS_FILE: "/c",
        AWS_CONFIG_FILE: "/f",
        TMPDIR: "/t",
        PATH: "/bin",
        HOME: "/h",
        AWS_SECRET_ACCESS_KEY: "never",
        AWS_ACCESS_KEY_ID: "never",
        WAITRON_AWS_REHEARSAL_RECEIPT_DIR: "/r",
        NODE_OPTIONS: "--inspect",
      }),
    ).toEqual({
      WAITRON_RUN_AWS_REHEARSAL: "1",
      AWS_PROFILE: "waitron-rehearsal",
      AWS_REGION: "eu-north-1",
      AWS_SHARED_CREDENTIALS_FILE: "/c",
      AWS_CONFIG_FILE: "/f",
      TMPDIR: "/t",
      PATH: "/bin",
      HOME: "/h",
    });
    expect(keeperEnv({ PATH: "/bin", HOME: undefined })).toEqual({ PATH: "/bin" });
  });
});

describe("withAwsRehearsal — a local endpoint", () => {
  const ENDPOINT = "http://127.0.0.1:47999";

  it("gives it to the admin client and to bucketConfig, and skips the preflight", async () => {
    const h = harness({ endpoint: ENDPOINT });
    let config: unknown;
    await withAwsRehearsal(async (ctx) => {
      config = ctx.bucketConfig(ctx.prefix("loop"));
    }, h.deps);
    expect(h.createAdminClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-north-1" }),
      ENDPOINT,
    );
    expect(config).toMatchObject({ endpoint: ENDPOINT });
    expect(h.fake.names()).not.toContain("GetBucketEncryption");
    expect(h.fake.names()).not.toContain("GetBucketVersioning");
    const skipped = (await receipt()).events.filter((event) => event.phase === "preflight");
    expect(skipped).toEqual([
      { scenario: "lifecycle", phase: "preflight", api: "GetBucketEncryption", outcome: "skipped" },
      { scenario: "lifecycle", phase: "preflight", api: "GetBucketVersioning", outcome: "skipped" },
    ]);
    expect(h.journals[0]).toMatchObject({ endpoint: ENDPOINT });
  });

  it("without one, sends the preflight and gives bucketConfig no endpoint", async () => {
    const h = harness();
    let config: object | undefined;
    await withAwsRehearsal(async (ctx) => {
      config = ctx.bucketConfig(ctx.prefix("loop"));
    }, h.deps);
    expect(h.createAdminClient).toHaveBeenCalledWith(
      expect.objectContaining({ region: "eu-north-1" }),
      undefined,
    );
    expect(config).not.toHaveProperty("endpoint");
    expect(h.fake.names()).toContain("GetBucketEncryption");
    expect(h.fake.names()).toContain("GetBucketVersioning");
  });
});

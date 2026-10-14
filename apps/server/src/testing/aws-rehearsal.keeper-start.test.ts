import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG,
  FakeAdmin,
  type FakeHarness,
  profileEnv,
  RUN_ID,
  rejection,
  SUFFIX,
  fakeHarness,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { journalFileName, writeJournal } from "./aws-rehearsal-journal.js";
import { startKeeper } from "./aws-rehearsal-keeper-start.js";
import type { AwsReceipt } from "./aws-rehearsal-receipt.js";
import {
  AwsRehearsalRefused,
  type AwsRehearsalDeps,
  cleanupFromReceipt,
  keeperEnv,
  loadRehearsalProfile,
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

describe("withAwsRehearsal — the journal of a run whose keeper did not start", () => {
  it("is removed, having been in the receipt folder while the keeper was being started", async () => {
    const path = join(receiptDir, journalFileName(RUN_ID));
    const seen: boolean[] = [];
    const h = harness({
      journal: writeJournal,
      startKeeper: async () => {
        seen.push(existsSync(path));
        throw new Error("spawn failed");
      },
    });
    const refusal = await rejection(withAwsRehearsal(async () => undefined, h.deps));
    expect((refusal as AwsRehearsalRefused).reason).toBe("keeper-unavailable");
    expect(seen).toEqual([true]);
    expect(existsSync(path)).toBe(false);
  });
});

describe("an S3 endpoint taken from outside the run", () => {
  const LOCAL = "http://127.0.0.1:9";
  const SHAPES: [string, Record<string, string>, string][] = [
    ["AWS_ENDPOINT_URL_S3", { AWS_ENDPOINT_URL_S3: LOCAL }, CONFIG],
    ["AWS_ENDPOINT_URL", { AWS_ENDPOINT_URL: LOCAL }, CONFIG],
    ["endpoint_url in the profile", {}, `${CONFIG}endpoint_url = ${LOCAL}\n`],
    ["services in the profile", {}, `${CONFIG}services = local-s3\n`],
  ];

  async function shaped(variables: Record<string, string>, config: string): Promise<FakeHarness> {
    await writeFile(configFile, config);
    const h = harness();
    h.deps.env = { ...h.deps.env, ...variables };
    return h;
  }

  it.each(SHAPES)("loadRehearsalProfile refuses %s", async (_label, variables, config) => {
    const h = await shaped(variables, config);
    const refusal = await rejection(loadRehearsalProfile(h.deps.env!, h.deps as AwsRehearsalDeps));
    expect((refusal as AwsRehearsalRefused).reason).toBe("endpoint-unsupported");
    expect(refusal.message).not.toContain(LOCAL);
  });

  it.each(SHAPES)(
    "withAwsRehearsal refuses %s before any client is built",
    async (_label, variables, config) => {
      const h = await shaped(variables, config);
      const starts: string[] = [];
      h.deps.startKeeper = async (path) => {
        starts.push(path);
        return { keeperPid: null, end: () => {} };
      };
      const refusal = await rejection(withAwsRehearsal(async () => undefined, h.deps));
      expect((refusal as AwsRehearsalRefused).reason).toBe("endpoint-unsupported");
      expect(h.createAdminClient).not.toHaveBeenCalled();
      expect(starts).toEqual([]);
      expect(h.journals).toEqual([]);
    },
  );

  it.each(SHAPES)(
    "cleanupFromReceipt refuses %s before any client is built",
    async (_label, variables, config) => {
      const h = await shaped(variables, config);
      const refusal = await rejection(
        cleanupFromReceipt(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), h.deps),
      );
      expect((refusal as AwsRehearsalRefused).reason).toBe("endpoint-unsupported");
      expect(h.createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("allows a run when neither variable is set, or one is empty, and the profile names no endpoint", async () => {
    const h = await shaped({ AWS_ENDPOINT_URL: "", AWS_ENDPOINT_URL_S3: "" }, CONFIG);
    await withAwsRehearsal(async () => undefined, h.deps);
    expect(h.fake.names()).toContain("CreateBucket");
  });
});

describe("startKeeper, the default", () => {
  const MARK_READY =
    'import { writeFileSync } from "node:fs";\n' +
    'const journal = process.argv[process.argv.indexOf("--journal") + 1];\n' +
    "const ready = () => writeFileSync(journal, JSON.stringify({ ready: true, keeperPid: process.pid }));\n";

  async function launcher(name: string, body: string): Promise<string> {
    const path = join(dir, `${name}.mjs`);
    await writeFile(path, MARK_READY + body);
    return path;
  }

  const journalPath = (): string => join(dir, "journal.json");
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

  it("resolves with the keeper's pid once the journal says ready and the launcher has exited 0", async () => {
    const marker = join(dir, "exited");
    const script = await launcher(
      "slow-exit",
      `ready();\nsetTimeout(() => { writeFileSync(${JSON.stringify(marker)}, ""); process.exit(0); }, 500);\n`,
    );
    const handle = await startKeeper(journalPath(), env, { script, readyMs: 10_000 });
    expect(handle.keeperPid).toBeGreaterThan(1);
    expect(existsSync(marker)).toBe(true);
    handle.end();
  }, 20_000);

  it.each([
    ["exits non-zero before saying ready", "process.exit(3);\n"],
    ["says ready but exits non-zero", "ready();\nprocess.exit(1);\n"],
  ])(
    "refuses keeper-unavailable when the launcher %s",
    async (_how, body) => {
      const script = await launcher("fails", body);
      const refusal = await rejection(startKeeper(journalPath(), env, { script, readyMs: 10_000 }));
      expect((refusal as AwsRehearsalRefused).reason).toBe("keeper-unavailable");
      expect(refusal.message).toContain("the keeper's launcher failed");
    },
    20_000,
  );

  it("refuses keeper-unavailable when the journal never says ready within the wait", async () => {
    const script = await launcher("silent", "process.exit(0);\n");
    const started = Date.now();
    const refusal = await rejection(startKeeper(journalPath(), env, { script, readyMs: 1_500 }));
    expect((refusal as AwsRehearsalRefused).reason).toBe("keeper-unavailable");
    expect(refusal.message).toContain("did not report ready within 1500 ms");
    expect(Date.now() - started).toBeGreaterThanOrEqual(1_500);
  }, 20_000);
});

import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type Answer,
  BUCKET,
  FakeAdmin,
  RUN_ID,
  SUFFIX,
  fakeHarness,
  ok,
  profileEnv,
  rejection,
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
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  const files = await writeProfileFiles("aws-rehearsal-uploads-");
  dir = files.dir;
  receiptDir = join(dir, "receipts");
  env = profileEnv(files);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function harness(fake: FakeAdmin, extra: Partial<AwsRehearsalDeps> = {}) {
  const h = fakeHarness(fake, env, "2026-10-14T10:00:00.000Z");
  return {
    ...h,
    deps: {
      ...h.deps,
      randomSuffix: () => SUFFIX,
      runId: () => RUN_ID,
      receiptDir,
      isAlive: () => false,
      kill: () => {},
      settleMs: 10,
      ...extra,
    } satisfies Partial<AwsRehearsalDeps>,
  };
}

const ISSUED = `rehearsal-${RUN_ID}/archive/`;

/** Runs `scenario` against `fake`, returning the commands it sent itself. */
async function during<T>(
  fake: FakeAdmin,
  scenario: (ctx: AwsRehearsal) => Promise<T>,
  extra: Partial<AwsRehearsalDeps> = {},
): Promise<{ result: T; sent: FakeAdmin["calls"] }> {
  let start = 0;
  let end = 0;
  const result = await withAwsRehearsal(async (ctx) => {
    start = fake.calls.length;
    try {
      return await scenario(ctx);
    } finally {
      end = fake.calls.length;
    }
  }, harness(fake, extra).deps);
  return { result, sent: fake.calls.slice(start, end) };
}

async function receipt(): Promise<AwsReceipt> {
  return JSON.parse(
    await readFile(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), "utf8"),
  ) as AwsReceipt;
}

describe("ctx.ownedUploads", () => {
  it("lists only the unfinished uploads under the prefix, in the owned bucket", async () => {
    const fake = new FakeAdmin({
      uploads: [
        ["id-a", `${ISSUED}archives/venue-1/a.enc`],
        ["id-other", `rehearsal-${RUN_ID}/loop/x.ltx`],
        ["id-b", `${ISSUED}archives/venue-1/b.enc`],
      ],
    });
    const { result, sent } = await during(fake, async (ctx) => {
      expect(ctx.prefix("archive")).toBe(ISSUED);
      return ctx.ownedUploads(ISSUED);
    });
    expect(result).toEqual([
      { key: `${ISSUED}archives/venue-1/a.enc`, uploadId: "id-a" },
      { key: `${ISSUED}archives/venue-1/b.enc`, uploadId: "id-b" },
    ]);
    expect(sent.map((call) => call.name)).toEqual(["ListMultipartUploads"]);
    expect(sent[0]!.input).toEqual({ Bucket: BUCKET, Prefix: ISSUED });
    expect(sent[0]!.signal).toBeInstanceOf(AbortSignal);
    const events = (await receipt()).events.filter((event) => event.phase === "inventory");
    expect(events).toEqual([
      expect.objectContaining({ api: "ListMultipartUploads", outcome: "ok" }),
    ]);
  });

  it("accepts a path below an issued prefix", async () => {
    const below = `${ISSUED}archives/venue-1/`;
    const fake = new FakeAdmin({
      uploads: [
        ["id-a", `${below}a.enc`],
        ["id-c", `${ISSUED}archives/venue-2/c.enc`],
      ],
    });
    const { result, sent } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      return ctx.ownedUploads(below);
    });
    expect(result).toEqual([{ key: `${below}a.enc`, uploadId: "id-a" }]);
    expect(sent[0]!.input).toEqual({ Bucket: BUCKET, Prefix: below });
  });

  it.each([
    ["a prefix never issued", `rehearsal-${RUN_ID}/other/`],
    ["the bucket root", ""],
    ["a prefix that only starts an issued one", `rehearsal-${RUN_ID}/arch`],
  ])("refuses %s before any command", async (_label, prefix) => {
    const fake = new FakeAdmin();
    const { result, sent } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      return rejection(ctx.ownedUploads(prefix));
    });
    expect(result).toBeInstanceOf(AwsRehearsalRefused);
    expect((result as AwsRehearsalRefused).reason).toBe("prefix-not-issued");
    expect(sent).toEqual([]);
  });

  it("follows the pages, every one naming the owned bucket and the prefix", async () => {
    const fake = new FakeAdmin({
      uploadsPageSize: 1,
      uploads: [
        ["id-a", `${ISSUED}a.enc`],
        ["id-b", `${ISSUED}b.enc`],
        ["id-c", `${ISSUED}c.enc`],
      ],
    });
    const { result, sent } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      return ctx.ownedUploads(ISSUED);
    });
    expect(result.map((upload) => upload.uploadId)).toEqual(["id-a", "id-b", "id-c"]);
    expect(sent.map((call) => call.input)).toEqual([
      { Bucket: BUCKET, Prefix: ISSUED },
      { Bucket: BUCKET, Prefix: ISSUED, KeyMarker: `${ISSUED}a.enc`, UploadIdMarker: "id-a" },
      { Bucket: BUCKET, Prefix: ISSUED, KeyMarker: `${ISSUED}b.enc`, UploadIdMarker: "id-b" },
    ]);
  });

  it("fails on a repeated marker", async () => {
    const repeating: Answer = () => ({
      ...ok(),
      IsTruncated: true,
      NextKeyMarker: `${ISSUED}a.enc`,
      NextUploadIdMarker: "id-a",
      Uploads: [{ Key: `${ISSUED}a.enc`, UploadId: "id-a" }],
    });
    const fake = new FakeAdmin();
    const { result, sent } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      const listing = fake.answers.ListMultipartUploads!;
      fake.answers.ListMultipartUploads = repeating;
      try {
        return await rejection(ctx.ownedUploads(ISSUED));
      } finally {
        fake.answers.ListMultipartUploads = listing;
      }
    });
    expect(result.name).toBe("AwsRehearsalFailed");
    expect(result.message).toMatch(/^ListMultipartUploads failed: /);
    expect(sent).toHaveLength(2);
  });

  it("fails when the listing is refused, naming the refusal", async () => {
    const fake = new FakeAdmin();
    const { result } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      const listing = fake.answers.ListMultipartUploads!;
      fake.answers.ListMultipartUploads = () => {
        throw Object.assign(new Error("denied"), {
          name: "AccessDenied",
          $metadata: { httpStatusCode: 403 },
        });
      };
      try {
        return await rejection(ctx.ownedUploads(ISSUED));
      } finally {
        fake.answers.ListMultipartUploads = listing;
      }
    });
    expect(result.name).toBe("AwsRehearsalFailed");
    expect(result.message).toBe("ListMultipartUploads failed: AccessDenied");
  });

  it("is refused once teardown has started", async () => {
    const fake = new FakeAdmin();
    let ctx: AwsRehearsal | undefined;
    await rejection(
      withAwsRehearsal(
        (given) => {
          ctx = given;
          given.prefix("archive");
          return new Promise<never>(() => {});
        },
        harness(fake, { deadlineMs: 20 }).deps,
      ),
    );
    const before = fake.calls.length;
    const refusal = await rejection(ctx!.ownedUploads(ISSUED));
    expect((refusal as AwsRehearsalRefused).reason).toBe("teardown-started");
    expect(fake.calls.length).toBe(before);
  });

  it("sends nothing but ListMultipartUploads for the owned bucket", async () => {
    const fake = new FakeAdmin({ uploadsPageSize: 1, uploads: [["id-a", `${ISSUED}a.enc`]] });
    const { sent } = await during(fake, async (ctx) => {
      ctx.prefix("archive");
      return ctx.ownedUploads(ISSUED);
    });
    expect(sent.length).toBeGreaterThan(0);
    for (const call of sent) {
      expect(call.name).toBe("ListMultipartUploads");
      expect(call.input.Bucket).toBe(BUCKET);
    }
    expect(fake.names()).not.toContain("ListBuckets");
  });
});

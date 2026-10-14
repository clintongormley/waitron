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
  sdkError,
  writeProfileFiles,
} from "./aws-rehearsal-fake.js";
import { AWS_REHEARSAL_LIMITS } from "./aws-rehearsal-limits.js";
import type { AwsReceipt, AwsReceiptEvent } from "./aws-rehearsal-receipt.js";
import { type AwsRehearsal, AwsRehearsalRefused, withAwsRehearsal } from "./aws-rehearsal.js";
import {
  LISTING_DENIAL_POLL_MS,
  type ListAnswer,
  type ListingDenialDeps,
  listingDenialPolicy,
  withListingDenied,
} from "./aws-listing-denial.js";

const RUN_ROOT = `rehearsal-${RUN_ID}/`;
const LABEL_PREFIX = `${RUN_ROOT}pause/`;
const EXACT = `${LABEL_PREFIX}gen/0001/l0/`;
const ARN = `arn:aws:s3:::${BUCKET}`;

// The commands the runner's own lifecycle sends, which the fake answers by default.
const LIFECYCLE = [
  "CreateBucket",
  "PutObject",
  "GetObject",
  "GetBucketEncryption",
  "GetBucketVersioning",
  "ListMultipartUploads",
  "AbortMultipartUpload",
  "DeleteBucketPolicy",
  "ListObjectsV2",
  "DeleteObjects",
  "DeleteObject",
  "DeleteBucket",
];

let dir: string;
let receiptDir: string;
let credentialsFile: string;
let configFile: string;

beforeEach(async () => {
  ({ dir, credentialsFile, configFile } = await writeProfileFiles("aws-listing-denial-"));
  receiptDir = join(dir, "receipts");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Statement {
  Sid: string;
  Effect: string;
  Principal: string;
  Action: unknown;
  Resource: unknown;
  Condition: unknown;
}

function parsePolicy(document: string): { Version: string; Statement: Statement[] } {
  return JSON.parse(document) as { Version: string; Statement: Statement[] };
}

/** IAM's StringLike for one value: `*` any run, `?` one character, case-sensitive; an absent key never matches. */
function stringLike(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  const source = [...pattern]
    .map((char) =>
      char === "*" ? ".*" : char === "?" ? "." : char.replace(/[.+^${}()|[\]\\/]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${source}$`, "s").test(value);
}

/** Whether the policy's single statement denies an `s3:ListBucket` on BUCKET whose `s3:prefix` is `prefix`. */
function denies(document: string, action: string, prefix: string | undefined): boolean {
  const [statement] = parsePolicy(document).Statement;
  const pattern = (statement!.Condition as { StringLike: { "s3:prefix": string } }).StringLike[
    "s3:prefix"
  ];
  return (
    statement!.Effect === "Deny" &&
    statement!.Action === action &&
    statement!.Resource === ARN &&
    stringLike(pattern, prefix)
  );
}

interface Clock {
  at: number;
}

interface Lister {
  deps: ListingDenialDeps;
  clock: Clock;
  prefixes: string[];
  signals: AbortSignal[];
}

/** Answers in turn, the last one repeating; each sleep moves the clock by its length. */
function lister(answers: ListAnswer[], log: string[] = []): Lister {
  const clock = { at: 0 };
  const prefixes: string[] = [];
  const signals: AbortSignal[] = [];
  let next = 0;
  return {
    clock,
    prefixes,
    signals,
    deps: {
      async list(prefix, signal) {
        prefixes.push(prefix);
        signals.push(signal);
        const answer = answers[Math.min(next, answers.length - 1)]!;
        next += 1;
        log.push(answer.ok ? "list:ok" : `list:${answer.status}`);
        return answer;
      },
      now: () => clock.at,
      async sleep(ms, signal) {
        signal.throwIfAborted();
        clock.at += ms;
      },
    },
  };
}

const OK: ListAnswer = { ok: true };
const DENIED: ListAnswer = { ok: false, status: 403, errorName: "AccessDenied" };

function harness(log: string[] = [], answers: Record<string, Answer> = {}) {
  const fake = new FakeAdmin({
    answers: {
      PutBucketPolicy: () => {
        log.push("put");
        return ok(204);
      },
      DeleteBucketPolicy: () => {
        log.push("delete");
        return ok(204);
      },
      ...answers,
    },
  });
  const h = fakeHarness(
    fake,
    profileEnv({ credentialsFile, configFile }),
    "2026-10-14T10:00:00.000Z",
  );
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
    },
  };
}

async function receipt(): Promise<AwsReceipt> {
  const text = await readFile(join(receiptDir, `aws-rehearsal-${RUN_ID}.json`), "utf8");
  return JSON.parse(text) as AwsReceipt;
}

function denialEvents(events: AwsReceiptEvent[]): AwsReceiptEvent[] {
  return events.filter(
    (event) => event.phase === "listing-denial" || event.phase.startsWith("deny-"),
  );
}

describe("listingDenialPolicy", () => {
  const document = listingDenialPolicy(BUCKET, EXACT);

  it("is one Deny of s3:ListBucket on the owned bucket for the exact prefix and below", () => {
    const parsed = parsePolicy(document);
    expect(Object.keys(parsed)).toEqual(["Version", "Statement"]);
    expect(parsed.Version).toBe("2012-10-17");
    expect(parsed.Statement).toHaveLength(1);
    const [statement] = parsed.Statement;
    expect(Object.keys(statement!).sort()).toEqual(
      ["Action", "Condition", "Effect", "Principal", "Resource", "Sid"].sort(),
    );
    expect(statement!.Effect).toBe("Deny");
    expect(statement!.Principal).toBe("*");
    expect(statement!.Action).toBe("s3:ListBucket");
    expect(statement!.Resource).toBe(ARN);
    expect(statement!.Condition).toEqual({ StringLike: { "s3:prefix": `${EXACT}*` } });
  });

  it("matches the exact prefix and what is under it, and nothing above or beside it", () => {
    expect(denies(document, "s3:ListBucket", EXACT)).toBe(true);
    expect(denies(document, "s3:ListBucket", `${EXACT}0001.ltx`)).toBe(true);
    expect(denies(document, "s3:ListBucket", "")).toBe(false);
    expect(denies(document, "s3:ListBucket", RUN_ROOT)).toBe(false);
    expect(denies(document, "s3:ListBucket", LABEL_PREFIX)).toBe(false);
    expect(denies(document, "s3:ListBucket", `${LABEL_PREFIX}gen/0001/l1/`)).toBe(false);
    expect(denies(document, "s3:ListBucket", EXACT.toUpperCase())).toBe(false);
    expect(denies(document, "s3:ListBucket", undefined)).toBe(false);
  });

  it("denies no other action", () => {
    for (const action of [
      "s3:DeleteBucketPolicy",
      "s3:PutBucketPolicy",
      "s3:DeleteObject",
      "s3:GetObject",
    ]) {
      expect(denies(document, action, EXACT)).toBe(false);
    }
  });
});

describe("ctx.bucketPolicy", () => {
  function statementWith(change: Record<string, unknown>): string {
    const parsed = parsePolicy(listingDenialPolicy(BUCKET, EXACT));
    return JSON.stringify({ ...parsed, Statement: [{ ...parsed.Statement[0], ...change }] });
  }
  const withPrefix = (prefix: string) =>
    statementWith({ Condition: { StringLike: { "s3:prefix": `${prefix}*` } } });
  const refusedDocuments: [string, string][] = [
    ["another bucket", listingDenialPolicy("waitron-rehearsal-waitron-zzzzzzzzzzzz", EXACT)],
    ["the bucket's objects", statementWith({ Resource: `${ARN}/*` })],
    ["an Allow", statementWith({ Effect: "Allow" })],
    ["s3:*", statementWith({ Action: "s3:*" })],
    ["a second action", statementWith({ Action: ["s3:ListBucket", "s3:GetObject"] })],
    ["a NotAction", statementWith({ NotAction: "s3:GetObject" })],
    ["a named principal", statementWith({ Principal: { AWS: "*" } })],
    ["a prefix outside the run", withPrefix("rehearsal-other-run/pause/gen/")],
    ["a prefix outside the issued labels", withPrefix(`${RUN_ROOT}other/gen/`)],
    ["the label prefix itself", withPrefix(LABEL_PREFIX)],
    ["a * inside the prefix", withPrefix(`${LABEL_PREFIX}g*n/`)],
    ["a ? inside the prefix", withPrefix(`${LABEL_PREFIX}g?n/`)],
    ["a policy variable", withPrefix(`${LABEL_PREFIX}\${aws:username}/`)],
    [
      "a prefix with no trailing *",
      statementWith({ Condition: { StringLike: { "s3:prefix": EXACT } } }),
    ],
    [
      "another condition operator",
      statementWith({ Condition: { StringEquals: { "s3:prefix": `${EXACT}*` } } }),
    ],
    [
      "a second condition key",
      statementWith({
        Condition: { StringLike: { "s3:prefix": `${EXACT}*`, "s3:delimiter": "/" } },
      }),
    ],
    [
      "a second statement",
      (() => {
        const parsed = parsePolicy(listingDenialPolicy(BUCKET, EXACT));
        return JSON.stringify({ ...parsed, Statement: [parsed.Statement[0], parsed.Statement[0]] });
      })(),
    ],
    [
      "an extra top-level key",
      JSON.stringify({ ...parsePolicy(listingDenialPolicy(BUCKET, EXACT)), Id: "x" }),
    ],
    [
      "another version",
      JSON.stringify({ ...parsePolicy(listingDenialPolicy(BUCKET, EXACT)), Version: "2008-10-17" }),
    ],
    [
      "a duplicated key",
      listingDenialPolicy(BUCKET, EXACT).replace(
        '"Action":"s3:ListBucket"',
        '"Action":"s3:*","Action":"s3:ListBucket"',
      ),
    ],
    ["text that is not JSON", "not json"],
  ];

  it.each(refusedDocuments)("refuses %s before sending anything", async (_, document) => {
    const h = harness();
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.prefix("pause");
        await ctx.bucketPolicy.put(document);
      }, h.deps),
    );
    expect(error).toBeInstanceOf(AwsRehearsalRefused);
    expect((error as AwsRehearsalRefused).reason).toBe("policy-refused");
    expect(h.fake.names()).not.toContain("PutBucketPolicy");
  });

  it("puts the exact document on the owned bucket and removes it, recording both", async () => {
    const h = harness();
    await withAwsRehearsal(async (ctx) => {
      ctx.prefix("pause");
      await ctx.bucketPolicy.put(listingDenialPolicy(ctx.bucket, EXACT));
      await ctx.bucketPolicy.remove();
    }, h.deps);
    const put = h.fake.calls.find((call) => call.name === "PutBucketPolicy")!;
    expect(put.input).toEqual({ Bucket: BUCKET, Policy: listingDenialPolicy(BUCKET, EXACT) });
    expect(denialEvents((await receipt()).events)).toEqual([
      expect.objectContaining({ api: "PutBucketPolicy", phase: "listing-denial", outcome: "ok" }),
      expect.objectContaining({
        api: "DeleteBucketPolicy",
        phase: "listing-denial",
        outcome: "ok",
      }),
    ]);
  });

  it("names only the api and a vetted error name when a send fails", async () => {
    const h = harness([], {
      PutBucketPolicy: () => {
        throw sdkError("MalformedPolicy", 400);
      },
    });
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.prefix("pause");
        await ctx.bucketPolicy.put(listingDenialPolicy(ctx.bucket, EXACT));
      }, h.deps),
    );
    expect(error.name).toBe("AwsRehearsalFailed");
    expect(error.message).toBe("PutBucketPolicy failed: MalformedPolicy");
  });

  it("refuses once teardown has begun", async () => {
    const h = harness();
    let kept: AwsRehearsal | undefined;
    await withAwsRehearsal(async (ctx) => {
      ctx.prefix("pause");
      kept = ctx;
    }, h.deps);
    for (const attempt of [
      () => kept!.bucketPolicy.put(listingDenialPolicy(BUCKET, EXACT)),
      () => kept!.bucketPolicy.remove(),
    ]) {
      const error = await rejection(attempt());
      expect((error as AwsRehearsalRefused).reason).toBe("teardown-started");
    }
    expect(h.fake.names()).not.toContain("PutBucketPolicy");
  });
});

describe("withListingDenied", () => {
  async function run(
    answers: ListAnswer[],
    work: () => Promise<void> = async () => {},
    adminAnswers: Record<string, Answer> = {},
  ) {
    const log: string[] = [];
    const h = harness(log, adminAnswers);
    const l = lister(answers, log);
    let seen: string[] = [];
    let error: Error | undefined;
    try {
      await withAwsRehearsal(async (ctx) => {
        ctx.prefix("pause");
        try {
          await withListingDenied(
            ctx,
            EXACT,
            async () => {
              log.push("work");
              await work();
            },
            l.deps,
          );
        } finally {
          seen = [...log];
        }
      }, h.deps);
    } catch (thrown) {
      error = thrown as Error;
    }
    return { h, l, log: seen, error, events: denialEvents((await receipt()).events) };
  }

  it("puts the policy, waits for a 403, runs the work, removes the policy and waits for a listing", async () => {
    const { h, l, log, error, events } = await run([OK, OK, DENIED, DENIED, OK]);
    expect(error).toBeUndefined();
    expect(log).toEqual([
      "put",
      "list:ok",
      "list:ok",
      "list:403",
      "work",
      "delete",
      "list:403",
      "list:ok",
    ]);
    expect(l.prefixes.every((prefix) => prefix === EXACT)).toBe(true);
    expect(l.clock.at).toBe(3 * LISTING_DENIAL_POLL_MS);
    expect(events).toEqual([
      expect.objectContaining({ api: "PutBucketPolicy", phase: "listing-denial", outcome: "ok" }),
      {
        scenario: "listing-denial",
        phase: "deny-negative-control",
        api: "ListObjectsV2",
        httpStatus: 403,
        errorName: "AccessDenied",
        attempts: 3,
        elapsedMs: 2 * LISTING_DENIAL_POLL_MS,
        outcome: "ok",
      },
      expect.objectContaining({
        api: "DeleteBucketPolicy",
        phase: "listing-denial",
        outcome: "ok",
      }),
      {
        scenario: "listing-denial",
        phase: "deny-positive-control",
        api: "ListObjectsV2",
        attempts: 2,
        elapsedMs: LISTING_DENIAL_POLL_MS,
        outcome: "ok",
      },
    ]);
    const names = h.fake.names();
    for (const name of names) {
      expect([...LIFECYCLE, "PutBucketPolicy"]).toContain(name);
      expect(name).not.toMatch(/iam|sts|kms|role|user|key/i);
    }
  });

  it("does not take a 401 refusal for a 403, and calls the refusal unmeasured when no 403 comes", async () => {
    const work = vi.fn(async () => {});
    const unauthorised: ListAnswer = { ok: false, status: 401, errorName: "AccessDenied" };
    const { l, log, error, events } = await run([unauthorised, OK], work);
    expect(work).not.toHaveBeenCalled();
    expect(error?.message).toMatch(/unmeasured/);
    expect(log.filter((entry) => entry === "list:401")).toHaveLength(1);
    expect(log.slice(-2)).toEqual(["delete", "list:ok"]);
    const unmeasured = events.find((event) => event.phase === "deny-unmeasured");
    expect(unmeasured).toMatchObject({ outcome: "failed", api: "ListObjectsV2" });
    expect(unmeasured!.attempts).toBe(
      AWS_REHEARSAL_LIMITS.denialControlMs / LISTING_DENIAL_POLL_MS,
    );
    expect(l.clock.at).toBeLessThanOrEqual(AWS_REHEARSAL_LIMITS.denialControlMs);
    expect(events.some((event) => event.phase === "deny-negative-control")).toBe(false);
  });

  it("records a refusal's status and name from the answer", async () => {
    const odd: ListAnswer = { ok: false, status: 500, errorName: "InternalError" };
    const { events } = await run([odd]);
    expect(events.find((event) => event.phase === "deny-unmeasured")).toMatchObject({
      httpStatus: 500,
      errorName: "InternalError",
    });
  });

  it("removes the policy and runs the positive control when the work throws, then throws the work's error", async () => {
    const failure = new Error("the work failed");
    const { log, error, events } = await run([DENIED, OK], async () => {
      throw failure;
    });
    expect(error).toBe(failure);
    expect(log).toEqual(["put", "list:403", "work", "delete", "list:ok"]);
    expect(events.find((event) => event.phase === "deny-positive-control")).toMatchObject({
      outcome: "ok",
    });
  });

  it("keeps the work's error and attaches a later control failure as its cause", async () => {
    const failure = new Error("the work failed");
    const { error } = await run([DENIED], async () => {
      throw failure;
    });
    expect(error).toBe(failure);
    expect((failure.cause as Error).message).toMatch(/unresolved/);
  });

  it("keeps the frozen work's error first and still reports a later control failure", async () => {
    const failure = Object.freeze(new Error("the work failed"));
    const { error } = await run([DENIED], async () => {
      throw failure;
    });
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors as Error[];
    expect(errors[0]).toBe(failure);
    expect(errors[1]!.message).toMatch(/unresolved/);
    expect(error!.message).toMatch(/^the work failed/);
  });

  /**
   * Answers from `before` until the policy is removed and from `after` once it is, the last of each
   * repeating. The first sleep of the `late` control wakes a whole budget late.
   */
  function lateWaking(
    log: string[],
    before: ListAnswer[],
    after: ListAnswer[],
    late: "negative" | "positive",
  ): ListingDenialDeps {
    let at = 0;
    const listed = { before: 0, after: 0 };
    let overslept = false;
    const removed = () => log.includes("delete");
    return {
      async list() {
        const phase = removed() ? "after" : "before";
        const answers = phase === "after" ? after : before;
        const answer = answers[Math.min(listed[phase], answers.length - 1)]!;
        listed[phase] += 1;
        log.push(answer.ok ? "list:ok" : `list:${answer.status}`);
        return answer;
      },
      now: () => at,
      async sleep(ms) {
        const inLate = (late === "positive") === removed();
        at += ms + (inLate && !overslept ? AWS_REHEARSAL_LIMITS.denialControlMs : 0);
        if (inLate) overslept = true;
      },
    };
  }

  it.each([
    [
      "negative",
      [OK, DENIED],
      [OK],
      "deny-unmeasured",
      "the listing refusal is unmeasured: no 403 within 60000 ms (last answer success)",
      ["list:ok", "list:ok"],
    ],
    [
      "positive",
      [DENIED],
      [DENIED, OK],
      "deny-positive-control",
      "listing denial unresolved: the policy was removed, but the listing still answered 403 after 60000 ms",
      ["list:403", "list:403"],
    ],
  ] as const)(
    "starts no %s-control listing once a late wake-up has spent the budget",
    async (late, before, after, phase, message, lists) => {
      const log: string[] = [];
      const h = harness(log);
      const error = await rejection(
        withAwsRehearsal(async (ctx) => {
          ctx.prefix("pause");
          await withListingDenied(
            ctx,
            EXACT,
            async () => {},
            lateWaking(log, [...before], [...after], late),
          );
        }, h.deps),
      );
      expect(error.message).toBe(message);
      expect(log.filter((entry) => entry.startsWith("list"))).toEqual(lists);
      const events = denialEvents((await receipt()).events);
      expect(events.find((event) => event.phase === phase)).toMatchObject({
        outcome: "failed",
        attempts: 1,
        elapsedMs: LISTING_DENIAL_POLL_MS + AWS_REHEARSAL_LIMITS.denialControlMs,
      });
    },
  );

  it("names the unresolved state when the listing never comes back", async () => {
    const { error, events } = await run([DENIED]);
    expect(error?.message).toBe(
      "listing denial unresolved: the policy was removed, but the listing still answered 403 after 60000 ms",
    );
    expect(events.find((event) => event.phase === "deny-positive-control")).toMatchObject({
      outcome: "failed",
      httpStatus: 403,
      errorName: "AccessDenied",
    });
  });

  it("names a failed removal and does not wait for a listing it cannot get", async () => {
    const { error, log } = await run([DENIED], async () => {}, {
      DeleteBucketPolicy: (_, fake) => {
        // Teardown's own removal is the second; it succeeds.
        if (fake.names().filter((name) => name === "DeleteBucketPolicy").length === 1) {
          throw sdkError("AccessDenied", 403);
        }
        return ok(204);
      },
    });
    expect(error?.message).toBe(
      "listing denial unresolved: removing the policy failed (DeleteBucketPolicy failed: AccessDenied); the listing last answered 403",
    );
    expect(log.at(-1)).toBe("work");
  });

  it("names the removal and the last listing answer when the positive control itself fails", async () => {
    const log: string[] = [];
    const h = harness(log);
    const l = lister([DENIED, { ok: false, status: 500, errorName: "InternalError" }], log);
    const error = await rejection(
      withAwsRehearsal(async (ctx) => {
        ctx.prefix("pause");
        const deps: ListingDenialDeps = {
          ...l.deps,
          async list(prefix, signal) {
            if (log.slice(log.indexOf("delete")).includes("list:500")) {
              throw new Error("the listing broke");
            }
            return l.deps.list(prefix, signal);
          },
        };
        await withListingDenied(ctx, EXACT, async () => {}, deps);
      }, h.deps),
    );
    expect(error.message).toBe(
      "listing denial unresolved: the policy was removed, but the positive control did not finish (the listing broke); the listing last answered 500",
    );
  });

  it.each([
    ["an empty prefix", ""],
    ["the label prefix alone", LABEL_PREFIX],
  ])(
    "refuses %s at the policy put, before any listing or work, even with its own lister",
    async (_, prefix) => {
      const log: string[] = [];
      const h = harness(log);
      const l = lister([DENIED, OK], log);
      let seen: string[] = [];
      const error = await rejection(
        withAwsRehearsal(async (ctx) => {
          ctx.prefix("pause");
          try {
            await withListingDenied(
              ctx,
              prefix,
              async () => {
                log.push("work");
              },
              l.deps,
            );
          } finally {
            seen = [...log];
          }
        }, h.deps),
      );
      expect(error).toBeInstanceOf(AwsRehearsalRefused);
      expect((error as AwsRehearsalRefused).reason).toBe("policy-refused");
      expect(seen).toEqual([]);
      expect(l.prefixes).toEqual([]);
      expect(h.fake.names()).not.toContain("PutBucketPolicy");
    },
  );

  it("stops polling when the rehearsal's signal aborts", async () => {
    const outside = new AbortController();
    const log: string[] = [];
    const h = harness(log);
    const l = lister([OK], log);
    const error = await rejection(
      withAwsRehearsal(
        async (ctx) => {
          ctx.prefix("pause");
          const deps: ListingDenialDeps = {
            ...l.deps,
            async list(prefix, signal) {
              if (log.filter((entry) => entry === "list:ok").length === 1) outside.abort();
              return l.deps.list(prefix, signal);
            },
          };
          await withListingDenied(ctx, EXACT, async () => {}, deps);
        },
        { ...h.deps, signal: outside.signal },
      ),
    );
    expect(error.message).toMatch(/stopped/);
    expect(log.filter((entry) => entry.startsWith("list"))).toEqual(["list:ok", "list:ok"]);
    expect(log).not.toContain("work");
    expect(l.signals.every((signal) => signal.aborted)).toBe(true);
  });
});

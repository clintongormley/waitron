import { describe, expect, it } from "vitest";
import { RECEIPT_APIS } from "./aws-rehearsal-receipt.js";
import { AwsRehearsalRefused } from "./aws-rehearsal-refused.js";
import { AwsRehearsalRefused as Reexported } from "./aws-rehearsal.js";
import {
  AWS_REHEARSAL_NONCE_KEY,
  createRequestPlan,
  LIFECYCLE_APIS,
  planRefusal,
  SCENARIO_APIS,
  type RequestPlan,
} from "./aws-request-plan.js";

const BUCKET = "waitron-rehearsal-waitron-abcdefghijkl";
const OTHER_REHEARSAL = "waitron-rehearsal-waitron-zzzzzzzzzzzz";
const FOREIGN = "someone-elses-bucket-7731";
const PREFIX = "rehearsal-run1/loop/";
const OUTSIDE_KEY = "rehearsal-run1/secret-outside-key";
const OUTSIDE_PREFIX = "unissued-prefix-value/";

function plan(apis: readonly string[] = SCENARIO_APIS, issued = new Set([PREFIX])): RequestPlan {
  return createRequestPlan({ bucket: BUCKET, apis, prefixes: () => issued });
}

function refusedDetail(detail: string | null): string {
  expect(detail).not.toBeNull();
  for (const value of [OUTSIDE_KEY, OUTSIDE_PREFIX, FOREIGN, PREFIX]) {
    expect(detail).not.toContain(value);
  }
  return detail!;
}

describe("the API lists", () => {
  it("are subsets of the receipt's API list", () => {
    for (const api of [...SCENARIO_APIS, ...LIFECYCLE_APIS]) {
      expect(RECEIPT_APIS as readonly string[]).toContain(api);
    }
  });

  it("name exactly the object-level and lifecycle APIs", () => {
    expect([...SCENARIO_APIS].sort()).toEqual(
      [
        "GetObject",
        "PutObject",
        "ListObjectsV2",
        "DeleteObject",
        "DeleteObjects",
        "HeadObject",
        "GetBucketLocation",
        "CreateMultipartUpload",
        "UploadPart",
        "CompleteMultipartUpload",
        "AbortMultipartUpload",
        "ListMultipartUploads",
      ].sort(),
    );
    expect([...LIFECYCLE_APIS].sort()).toEqual(
      [
        "CreateBucket",
        "PutObject",
        "GetObject",
        "GetBucketEncryption",
        "GetBucketVersioning",
        "PutBucketPolicy",
        "DeleteBucketPolicy",
        "ListMultipartUploads",
        "AbortMultipartUpload",
        "ListObjectsV2",
        "DeleteObjects",
        "DeleteObject",
        "DeleteBucket",
      ].sort(),
    );
  });

  it("re-exports the refusal class from the runner's module", () => {
    expect(Reexported).toBe(AwsRehearsalRefused);
  });

  it("keeps the ownership marker's key", () => {
    expect(AWS_REHEARSAL_NONCE_KEY).toBe(".waitron-rehearsal-owner");
  });
});

describe("createRequestPlan", () => {
  it("accepts a declared list of object-level APIs", () => {
    expect(() => plan(["GetObject", "PutObject"])).not.toThrow();
  });

  it.each(["CreateBucket", "DeleteBucket", "PutBucketPolicy", "GetBucketEncryption"])(
    "refuses a declared bucket-level API (%s) when the plan is made",
    (api) => {
      let caught: unknown;
      try {
        plan(["GetObject", api]);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AwsRehearsalRefused);
      expect((caught as AwsRehearsalRefused).reason).toBe("plan-refused");
      expect((caught as Error).message).toContain(api);
    },
  );

  it("refuses a declared API that is no S3 API the receipt knows, without naming it", () => {
    let caught: unknown;
    try {
      plan(["SelectObjectContent"]);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AwsRehearsalRefused);
    expect((caught as AwsRehearsalRefused).reason).toBe("plan-refused");
    expect((caught as Error).message).not.toContain("SelectObjectContent");
  });
});

describe("planRefusal — any sender", () => {
  it("refuses an API name outside the receipt's list, naming it", () => {
    for (const sender of ["runner", "scenario"] as const) {
      const detail = refusedDetail(planRefusal(plan(), sender, "PutBucketAcl", { Bucket: BUCKET }));
      expect(detail).toBe("PutBucketAcl is not an S3 API the rehearsal knows");
    }
  });

  it("refuses another rehearsal bucket, naming it", () => {
    const detail = refusedDetail(
      planRefusal(plan(), "scenario", "GetObject", { Bucket: OTHER_REHEARSAL, Key: `${PREFIX}a` }),
    );
    expect(detail).toContain(OTHER_REHEARSAL);
    expect(detail).toContain("GetObject");
  });

  it("refuses a foreign bucket without naming it", () => {
    for (const sender of ["runner", "scenario"] as const) {
      const detail = refusedDetail(
        planRefusal(plan(), sender, "DeleteBucket", { Bucket: FOREIGN }),
      );
      expect(detail).toContain("a bucket this run did not create");
    }
  });

  it("refuses a request that names no bucket", () => {
    refusedDetail(planRefusal(plan(), "scenario", "GetObject", { Key: `${PREFIX}a` }));
  });
});

describe("planRefusal — the runner", () => {
  it("allows each lifecycle API on the run's bucket", () => {
    for (const api of LIFECYCLE_APIS) {
      const input: Record<string, unknown> = { Bucket: BUCKET };
      if (api === "PutObject" || api === "GetObject") input.Key = AWS_REHEARSAL_NONCE_KEY;
      if (api === "DeleteObject") input.Key = "anything/the-run-left";
      expect(planRefusal(plan([]), "runner", api, input)).toBeNull();
    }
  });

  it("refuses an API outside the lifecycle list", () => {
    const detail = refusedDetail(planRefusal(plan(), "runner", "HeadObject", { Bucket: BUCKET }));
    expect(detail).toContain("HeadObject");
  });

  it.each(["PutObject", "GetObject"])("refuses a %s of a key other than the marker", (api) => {
    const detail = refusedDetail(
      planRefusal(plan(), "runner", api, { Bucket: BUCKET, Key: OUTSIDE_KEY }),
    );
    expect(detail).toContain(api);
  });
});

describe("planRefusal — a scenario", () => {
  it("allows a declared keyed API under an issued prefix", () => {
    expect(
      planRefusal(plan(), "scenario", "PutObject", { Bucket: BUCKET, Key: `${PREFIX}gen/1` }),
    ).toBeNull();
  });

  it("refuses an undeclared API", () => {
    const detail = refusedDetail(
      planRefusal(plan(["GetObject"]), "scenario", "PutObject", {
        Bucket: BUCKET,
        Key: `${PREFIX}a`,
      }),
    );
    expect(detail).toContain("PutObject");
  });

  it("refuses DeleteBucket on the run's own bucket", () => {
    const detail = refusedDetail(
      planRefusal(plan(), "scenario", "DeleteBucket", { Bucket: BUCKET }),
    );
    expect(detail).toContain("DeleteBucket");
  });

  it("refuses a key in the bucket outside every issued prefix", () => {
    refusedDetail(
      planRefusal(plan(), "scenario", "GetObject", { Bucket: BUCKET, Key: OUTSIDE_KEY }),
    );
  });

  it("refuses a keyed API with no key", () => {
    refusedDetail(planRefusal(plan(), "scenario", "HeadObject", { Bucket: BUCKET }));
  });

  it("refuses the marker key", () => {
    refusedDetail(
      planRefusal(plan(), "scenario", "GetObject", {
        Bucket: BUCKET,
        Key: AWS_REHEARSAL_NONCE_KEY,
      }),
    );
  });

  it("counts a prefix issued after the plan was made", () => {
    const issued = new Set([PREFIX]);
    const live = plan(SCENARIO_APIS, issued);
    const later = "rehearsal-run1/later/";
    expect(
      planRefusal(live, "scenario", "GetObject", { Bucket: BUCKET, Key: `${later}x` }),
    ).not.toBeNull();
    issued.add(later);
    expect(
      planRefusal(live, "scenario", "GetObject", { Bucket: BUCKET, Key: `${later}x` }),
    ).toBeNull();
  });

  it("allows a DeleteObjects list wholly under issued prefixes", () => {
    expect(
      planRefusal(plan(), "scenario", "DeleteObjects", {
        Bucket: BUCKET,
        Delete: { Objects: [{ Key: `${PREFIX}a` }, { Key: `${PREFIX}b` }] },
      }),
    ).toBeNull();
  });

  it("refuses a DeleteObjects list with one key outside", () => {
    const detail = refusedDetail(
      planRefusal(plan(), "scenario", "DeleteObjects", {
        Bucket: BUCKET,
        Delete: { Objects: [{ Key: `${PREFIX}a` }, { Key: OUTSIDE_KEY }] },
      }),
    );
    expect(detail).toContain("DeleteObjects");
  });

  it("refuses a DeleteObjects request with no key list", () => {
    refusedDetail(planRefusal(plan(), "scenario", "DeleteObjects", { Bucket: BUCKET }));
    refusedDetail(
      planRefusal(plan(), "scenario", "DeleteObjects", { Bucket: BUCKET, Delete: { Objects: [] } }),
    );
  });

  it.each(["ListObjectsV2", "ListMultipartUploads"])(
    "allows a %s listing under an issued prefix",
    (api) => {
      expect(
        planRefusal(plan(), "scenario", api, { Bucket: BUCKET, Prefix: `${PREFIX}gen/` }),
      ).toBeNull();
    },
  );

  it.each(["ListObjectsV2", "ListMultipartUploads"])(
    "refuses a %s listing outside every issued prefix",
    (api) => {
      refusedDetail(
        planRefusal(plan(), "scenario", api, { Bucket: BUCKET, Prefix: OUTSIDE_PREFIX }),
      );
    },
  );

  it.each(["ListObjectsV2", "ListMultipartUploads"])(
    "refuses a %s listing with no prefix",
    (api) => {
      const detail = refusedDetail(planRefusal(plan(), "scenario", api, { Bucket: BUCKET }));
      expect(detail).toContain(api);
    },
  );

  it("allows GetBucketLocation, which carries no key", () => {
    expect(planRefusal(plan(), "scenario", "GetBucketLocation", { Bucket: BUCKET })).toBeNull();
  });
});

describe("planRefusal — a scenario's dot path segments", () => {
  const DOT_KEYS = [
    `${PREFIX}../x`,
    `${PREFIX}./x`,
    `${PREFIX}a/../b`,
    `${PREFIX}a/..`,
    `${PREFIX}.`,
  ];

  it.each(DOT_KEYS)("refuses the key %s, which starts under an issued prefix", (key) => {
    const detail = refusedDetail(
      planRefusal(plan(), "scenario", "PutObject", { Bucket: BUCKET, Key: key }),
    );
    expect(detail).toBe("no key in a scenario's PutObject may have a . or .. path segment");
    expect(detail).not.toContain(key);
  });

  it("refuses a DeleteObjects list with one dot-segment key", () => {
    const detail = planRefusal(plan(), "scenario", "DeleteObjects", {
      Bucket: BUCKET,
      Delete: { Objects: [{ Key: `${PREFIX}a` }, { Key: `${PREFIX}../b` }] },
    });
    expect(detail).toBe("no key in a scenario's DeleteObjects may have a . or .. path segment");
  });

  it.each(["ListObjectsV2", "ListMultipartUploads"])(
    "refuses a %s prefix with a dot segment",
    (api) => {
      const detail = planRefusal(plan(), "scenario", api, {
        Bucket: BUCKET,
        Prefix: `${PREFIX}../`,
      });
      expect(detail).toBe(`no prefix in a scenario's ${api} may have a . or .. path segment`);
    },
  );

  it.each([`${PREFIX}a..b`, `${PREFIX}.hidden`, `${PREFIX}...`, `${PREFIX}a./b`])(
    "allows the key %s, whose dots are not a whole segment",
    (key) => {
      expect(planRefusal(plan(), "scenario", "PutObject", { Bucket: BUCKET, Key: key })).toBeNull();
    },
  );
});

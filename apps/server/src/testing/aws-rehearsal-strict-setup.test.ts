import { Readable } from "node:stream";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import awsRehearsalConfig from "../../vitest.aws-rehearsal.config.js";
import { createRequestPlan } from "./aws-request-plan.js";
import { ARCHIVE_APIS, DELETE_APIS, LOOP_APIS, PAUSE_APIS } from "./aws-rehearsal-plans.js";
import { openRequestScope, uninstallSendGate } from "./aws-send-gate.js";

const BUCKET = "waitron-rehearsal-waitron-abcdefghijkl";
const PREFIX = "rehearsal-run1/loop/";

function recording() {
  let handled = 0;
  const client = new S3Client({
    region: "eu-north-1",
    credentials: { accessKeyId: "AKIAEXAMPLE0000", secretAccessKey: "not-a-real-secret" },
    requestHandler: {
      async handle() {
        handled += 1;
        return {
          response: { statusCode: 200, headers: { etag: '"v1"' }, body: Readable.from([]) },
        };
      },
    },
  });
  return { client, handled: () => handled };
}

afterAll(() => {
  uninstallSendGate();
});

describe("the AWS rehearsal's strict setup", () => {
  it("is a setup file of the AWS rehearsal config", () => {
    expect(awsRehearsalConfig.test?.setupFiles).toContain(
      "src/testing/aws-rehearsal-strict-setup.ts",
    );
  });

  it("refuses a request sent outside a run once loaded, and still lets a planned one through inside", async () => {
    const before = recording();
    await before.client.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}a`, Body: "x" }),
    );
    expect(before.handled()).toBe(1);

    await import("./aws-rehearsal-strict-setup.js");
    const outside = recording();
    await expect(
      outside.client.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}a`, Body: "x" })),
    ).rejects.toThrow("PutObject was sent outside a rehearsal run");
    expect(outside.handled()).toBe(0);

    const scope = openRequestScope({
      plan: createRequestPlan({
        bucket: BUCKET,
        apis: ["PutObject"],
        prefixes: () => new Set([PREFIX]),
      }),
      mode: "enforce",
    });
    await scope.run(() =>
      outside.client.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${PREFIX}a`, Body: "x" })),
    );
    expect(outside.handled()).toBe(1);
  });
});

describe("the AWS rehearsals' API lists", () => {
  it.each([
    ["loop", LOOP_APIS],
    ["pause", PAUSE_APIS],
    ["archive", ARCHIVE_APIS],
    ["delete", DELETE_APIS],
  ])("the %s list makes a plan", (_, apis) => {
    expect(() =>
      createRequestPlan({ bucket: BUCKET, apis, prefixes: () => new Set() }),
    ).not.toThrow();
  });
});

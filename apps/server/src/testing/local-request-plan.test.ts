import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterAll, describe, expect, it } from "vitest";
import { uninstallSendGate } from "./aws-send-gate.js";
import { runUnderPlan } from "./local-request-plan.js";

const BUCKET = "local-bucket";
const PREFIX = "local-run/loop/";

function recording() {
  let handled = 0;
  const client = new S3Client({
    region: "us-east-1",
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

const put = (key: string) => new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: "x" });
const options = { bucket: BUCKET, apis: ["PutObject"] as const, prefixes: [PREFIX] };

afterAll(() => {
  uninstallSendGate();
});

describe("runUnderPlan", () => {
  it("sends a planned request and returns the body's value", async () => {
    const { client, handled } = recording();
    await expect(
      runUnderPlan(options, async () => {
        await client.send(put(`${PREFIX}a`));
        return "done";
      }),
    ).resolves.toBe("done");
    expect(handled()).toBe(1);
  });

  it("fails naming the API when the body swallows a refused request, which never reaches the handler", async () => {
    const { client, handled } = recording();
    await expect(
      runUnderPlan({ ...options, apis: [] }, async () => {
        await client.send(put(`${PREFIX}a`)).catch(() => undefined);
      }),
    ).rejects.toThrow(
      "1 unplanned request(s) refused before sending; the first: PutObject is not among the scenario's declared APIs",
    );
    expect(handled()).toBe(0);
  });

  it("refuses a request sent from inside the scope after the body has ended", async () => {
    const { client, handled } = recording();
    let late: Promise<unknown> | undefined;
    await runUnderPlan(options, async () => {
      late = sleep(20).then(() => client.send(put(`${PREFIX}b`)));
      late.catch(() => undefined);
    });
    await expect(late).rejects.toThrow("PutObject was sent after the run has ended");
    expect(handled()).toBe(0);
  });

  it("lets a request made outside any scope through", async () => {
    const { client, handled } = recording();
    await runUnderPlan(options, async () => undefined);
    await client.send(put("anywhere"));
    expect(handled()).toBe(1);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  errorXml,
  loopbackBucket,
  type LoopbackBucket,
} from "@waitron/stream/testing/loopback-bucket.js";
import { settingsBucketProbe } from "./stream-api.js";

let bucket: LoopbackBucket | undefined;
afterEach(async () => {
  await bucket?.close();
  bucket = undefined;
});

/**
 * A bucket on 127.0.0.1 that honours both write conditions and answers a batch delete with
 * `batchStatus`; everything else it answers as S3 would.
 */
async function bucketAnsweringBatch(batchStatus: number, code: string) {
  const etags = new Map<string, string>();
  let writes = 0;
  const opened: LoopbackBucket = await loopbackBucket({
    answer: (seen, _request, response) => {
      if (seen.kind === "deleteMany") {
        response.writeHead(batchStatus, { "content-type": "application/xml" });
        response.end(errorXml(code));
        return true;
      }
      if (seen.kind !== "put") return false;
      const current = opened.objects.has(seen.key) ? etags.get(seen.key) : undefined;
      const ifMatch = seen.headers["if-match"];
      if (
        (seen.headers["if-none-match"] === "*" && current !== undefined) ||
        (ifMatch !== undefined && ifMatch !== current)
      ) {
        response.writeHead(412, { "content-type": "application/xml" });
        response.end(errorXml("PreconditionFailed"));
        return true;
      }
      writes += 1;
      const etag = `"v${writes}"`;
      etags.set(seen.key, etag);
      opened.objects.set(seen.key, { body: seen.body!, lastModified: new Date() });
      response.writeHead(200, { etag });
      response.end();
      return true;
    },
  });
  bucket = opened;
  return opened;
}

describe("the Backups screen's bucket check", () => {
  it("refuses a bucket whose batch delete is refused, as the daily clean-up would be", async () => {
    const opened = await bucketAnsweringBatch(400, "MalformedXML");
    await expect(settingsBucketProbe(opened.config, AbortSignal.timeout(10_000))).resolves.toEqual({
      ok: false,
      reason: "batch_delete_refused",
      detail: "MalformedXML (400)",
    });
    expect(opened.objects.size).toBe(0);
  });

  it("passes a bucket that answers the batch delete 501, deleting the test file on its own", async () => {
    const opened = await bucketAnsweringBatch(501, "NotImplemented");
    await expect(settingsBucketProbe(opened.config, AbortSignal.timeout(10_000))).resolves.toEqual({
      ok: true,
    });
    expect(opened.seen.map((seen) => seen.kind).slice(-3)).toEqual(["deleteMany", "delete", "get"]);
    expect(opened.objects.size).toBe(0);
  });
});

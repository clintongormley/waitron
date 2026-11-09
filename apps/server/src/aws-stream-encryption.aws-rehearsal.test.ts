import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createBucketClient } from "@waitron/stream";
import { rehearsalLifecycle } from "./testing/aws-rehearsal.js";
import { LOOP_APIS } from "./testing/aws-rehearsal-plans.js";
import { resolveLitestream } from "./testing/s3-test-server.js";
import { runStreamLoopScenario } from "./testing/stream-loop-scenario.js";
import { trackedSpawn } from "./testing/transport-gate.js";

describe("AWS rehearsal: encrypted copies and the production recovery pack", () => {
  const rehearsal = rehearsalLifecycle({ apis: LOOP_APIS });
  afterAll(async () => rehearsal?.stop());

  it("enables customer keys through Save, rotates and restores the PDF to a fresh box", async () => {
    const litestream = await resolveLitestream(process.env);
    if (!litestream.ok) throw new Error(`install pinned Litestream: ${litestream.reason}`);
    await rehearsal.run(async (ctx) => {
      const prefix = ctx.prefix("encryption");
      const bucket = ctx.bucketConfig(prefix);
      const client = createBucketClient(bucket);
      const started = performance.now();
      try {
        await expect(
          client.send(
            new PutObjectCommand({
              Bucket: bucket.bucket,
              Key: `${prefix}blocked-keyed-write`,
              Body: "default-block control",
              SSECustomerAlgorithm: "AES256",
              SSECustomerKey: randomBytes(32).toString("base64"),
            }),
          ),
        ).rejects.toMatchObject({ $metadata: { httpStatusCode: 403 } });
        ctx.record({
          scenario: "encryption",
          phase: "default-blocked",
          outcome: "refused",
          elapsedMs: performance.now() - started,
          httpStatus: 403,
        });
      } finally {
        client.destroy();
      }
      expect(await ctx.prepareBucketEncryption(prefix)).toEqual({ ok: true });
      ctx.record({ scenario: "encryption", phase: "save-controls", outcome: "ok" });
      const scratch = await ctx.scratch("encrypted-loop");
      await runStreamLoopScenario({
        bucket,
        scratch,
        litestreamBin: litestream.bin,
        signal: ctx.signal,
        describeTransport: () => `Amazon S3, region ${ctx.region}`,
        record: (event) => ctx.record({ scenario: "loop", ...event }),
        serverSeams: { spawn: trackedSpawn((pid) => ctx.trackChild(pid)) },
        useRecoveryPack: true,
      });
      expect((await stat(join(scratch, "rotated-recovery-pack.pdf"))).size).toBeGreaterThan(1000);
      ctx.record({ scenario: "encryption", phase: "pdf-rotation-restore", outcome: "ok" });
    });
  });
});

// A rehearsal run against a local S3 server that stops at a named point and waits to be killed, for
// `src/aws-rehearsal-interrupt.e2e.test.ts`. Never pointed at Amazon: `--endpoint` must be loopback.
//
// Usage: node --import <tsx loader> src/testing/aws-rehearsal-interrupt-driver.ts \
//          --endpoint http://127.0.0.1:<port> --receipt-dir <dir> --point <point>
// The profile comes from the environment, as a real run's does.
//
// Stdout: `RUN {"runId","bucket","scratch","sleepPid"}` once the scenario has made everything, then
// `POINT <point>`; the driver then waits until it is killed or its deadline ends the run.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CreateMultipartUploadCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createBucketClient } from "@waitron/stream";
import { withAwsRehearsal } from "./aws-rehearsal.js";

/** The points a driver can stop at. */
export const INTERRUPT_POINTS = ["mid-scenario"] as const;
export type InterruptPoint = (typeof INTERRUPT_POINTS)[number];

export const INTERRUPT_APIS = ["PutObject", "CreateMultipartUpload"] as const;

/** Short, so a keeper's ceiling (twice their sum) stays inside a test's bound. */
export const DRIVER_DEADLINE_MS = 60_000;
export const DRIVER_SETTLE_MS = 1_000;
export const DRIVER_TEARDOWN_MS = 10_000;

export interface DriverArgs {
  endpoint: string;
  receiptDir: string;
  point: InterruptPoint;
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/;

export function parseDriverArgs(argv: readonly string[]): DriverArgs | null {
  const values = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 2) {
    const name = argv[at]!;
    const value = argv[at + 1];
    if (!["--endpoint", "--receipt-dir", "--point"].includes(name) || value === undefined) {
      return null;
    }
    if (values.has(name)) return null;
    values.set(name, value);
  }
  const endpoint = values.get("--endpoint");
  const receiptDir = values.get("--receipt-dir");
  const point = values.get("--point");
  if (endpoint === undefined || !LOOPBACK.test(endpoint)) return null;
  if (receiptDir === undefined || receiptDir === "") return null;
  if (!(INTERRUPT_POINTS as readonly string[]).includes(point ?? "")) return null;
  return { endpoint, receiptDir, point: point as InterruptPoint };
}

async function drive(args: DriverArgs): Promise<void> {
  await withAwsRehearsal(
    async (ctx) => {
      const prefix = ctx.prefix("interrupt");
      const client = createBucketClient(ctx.bucketConfig(prefix));
      for (const name of ["a.txt", "b.txt"]) {
        await client.send(
          new PutObjectCommand({ Bucket: ctx.bucket, Key: `${prefix}${name}`, Body: "x" }),
        );
      }
      const uploadKey = `${prefix}unfinished.bin`;
      const upload = await client.send(
        new CreateMultipartUploadCommand({ Bucket: ctx.bucket, Key: uploadKey }),
      );
      ctx.trackUpload(uploadKey, upload.UploadId!);
      // Its own process group, so a Ctrl-C to the run's group leaves it for the keeper to stop.
      const sleep = spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
      sleep.unref();
      ctx.trackChild(sleep.pid!);
      const secrets = await ctx.scratch("secrets");
      await writeFile(join(secrets, "secrets.env"), "NOT_A_REAL_SECRET=1\n", { mode: 0o600 });
      process.stdout.write(
        `RUN ${JSON.stringify({
          runId: ctx.runId,
          bucket: ctx.bucket,
          scratch: join(secrets, ".."),
          sleepPid: sleep.pid,
        })}\n`,
      );
      process.stdout.write(`POINT ${args.point}\n`);
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      client.destroy();
    },
    {
      endpoint: args.endpoint,
      receiptDir: args.receiptDir,
      apis: INTERRUPT_APIS,
      deadlineMs: DRIVER_DEADLINE_MS,
      settleMs: DRIVER_SETTLE_MS,
      teardownMs: DRIVER_TEARDOWN_MS,
    },
  );
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = parseDriverArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      "usage: aws-rehearsal-interrupt-driver.ts --endpoint <loopback url> --receipt-dir <dir> --point <point>",
    );
    process.exit(2);
  }
  try {
    await drive(args);
    process.exit(0);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "the driver failed");
    process.exit(1);
  }
}

// A rehearsal run against a local S3 server that stops at a named point and waits to be killed, for
// `src/aws-rehearsal-interrupt.e2e.test.ts`. Never pointed at Amazon: `--endpoint` must be loopback.
//
// Usage: node --import <tsx loader> src/testing/aws-rehearsal-interrupt-driver.ts \
//          --endpoint http://127.0.0.1:<port> --receipt-dir <dir> --point <point> \
//          [--teardown-ms <ms>] [--other-bucket <name>]
// The profile comes from the environment, as a real run's does. `--other-bucket` is required by the
// `unplanned` point and refused with any other.
//
// Stdout: `RUN {"runId","bucket","scratch","sleepPid"}` once the scenario has made what its point
// needs, then `POINT <point>`. Then, by point:
// - `after-setup`, `mid-scenario`: waits until it is killed or its deadline ends the run;
// - `teardown`: the scenario returns, so the runner's own teardown starts;
// - `uncaught-error`: on SIGUSR2 a timer throws, which nothing catches;
// - `unplanned`: the scenario has sent `DeleteBucket` for `--other-bucket` and returns; after the
//   run, a `GetBucketLocation` of that bucket is sent outside it and `CONTROL <outcome>` printed.
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  GetBucketLocationCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { type BucketConfig, createBucketClient, nameOf } from "@waitron/stream";
import { type AwsRehearsal, withAwsRehearsal } from "./aws-rehearsal.js";

/** The points a driver can stop at. */
export const INTERRUPT_POINTS = [
  "after-setup",
  "mid-scenario",
  "teardown",
  "uncaught-error",
  "unplanned",
] as const;
export type InterruptPoint = (typeof INTERRUPT_POINTS)[number];

export const INTERRUPT_APIS = ["PutObject", "CreateMultipartUpload"] as const;

/** Short, so a keeper's ceiling (twice their sum) stays inside a test's bound. */
export const DRIVER_DEADLINE_MS = 60_000;
export const DRIVER_SETTLE_MS = 1_000;
export const DRIVER_TEARDOWN_MS = 10_000;

export const UNCAUGHT_MESSAGE = "thrown from a timer mid-scenario";

export interface DriverArgs {
  endpoint: string;
  receiptDir: string;
  point: InterruptPoint;
  teardownMs: number;
  otherBucket?: string;
}

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost):[1-9][0-9]{0,4}$/;
const MILLISECONDS = /^[1-9][0-9]{0,5}$/;
const BUCKET_NAME = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const FLAGS = ["--endpoint", "--receipt-dir", "--point", "--teardown-ms", "--other-bucket"];

export function parseDriverArgs(argv: readonly string[]): DriverArgs | null {
  const values = new Map<string, string>();
  for (let at = 0; at < argv.length; at += 2) {
    const name = argv[at]!;
    const value = argv[at + 1];
    if (!FLAGS.includes(name) || value === undefined) return null;
    if (values.has(name)) return null;
    values.set(name, value);
  }
  const endpoint = values.get("--endpoint");
  const receiptDir = values.get("--receipt-dir");
  const point = values.get("--point");
  const teardownMs = values.get("--teardown-ms");
  const otherBucket = values.get("--other-bucket");
  if (endpoint === undefined || !LOOPBACK.test(endpoint)) return null;
  if (receiptDir === undefined || receiptDir === "") return null;
  if (!(INTERRUPT_POINTS as readonly string[]).includes(point ?? "")) return null;
  if (teardownMs !== undefined && !MILLISECONDS.test(teardownMs)) return null;
  if ((point === "unplanned") !== (otherBucket !== undefined)) return null;
  if (otherBucket !== undefined && !BUCKET_NAME.test(otherBucket)) return null;
  return {
    endpoint,
    receiptDir,
    point: point as InterruptPoint,
    teardownMs: teardownMs === undefined ? DRIVER_TEARDOWN_MS : Number(teardownMs),
    ...(otherBucket === undefined ? {} : { otherBucket }),
  };
}

function untilStopped(signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

/**
 * The scenario every point runs, reporting its lines through `say`. Returns the scenario's bucket
 * config, which `unplanned` uses after the run.
 */
export async function interruptScenario(
  ctx: AwsRehearsal,
  point: InterruptPoint,
  say: (line: string) => void,
  otherBucket?: string,
): Promise<BucketConfig> {
  const prefix = ctx.prefix("interrupt");
  const config = ctx.bucketConfig(prefix);
  const client = createBucketClient(config);
  const run = (scratch: string | null, sleepPid: number | null): void =>
    say(`RUN ${JSON.stringify({ runId: ctx.runId, bucket: ctx.bucket, scratch, sleepPid })}`);
  try {
    if (point === "after-setup") {
      run(null, null);
      say(`POINT ${point}`);
      await untilStopped(ctx.signal);
      return config;
    }
    if (point === "unplanned") {
      run(null, null);
      try {
        await client.send(new DeleteBucketCommand({ Bucket: otherBucket }));
        say("SENT DeleteBucket");
      } catch (error) {
        // Swallowed: the run must fail from the gate's own count of refusals.
        say(`REFUSED ${nameOf(error)}`);
      }
      say(`POINT ${point}`);
      return config;
    }
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
    if (point === "uncaught-error") {
      process.once("SIGUSR2", () =>
        setTimeout(() => {
          throw new Error(UNCAUGHT_MESSAGE);
        }, 0),
      );
    }
    run(join(secrets, ".."), sleep.pid!);
    say(`POINT ${point}`);
    if (point === "teardown") return config;
    await untilStopped(ctx.signal);
    return config;
  } finally {
    client.destroy();
  }
}

async function drive(args: DriverArgs): Promise<void> {
  const say = (line: string): void => void process.stdout.write(`${line}\n`);
  let config: BucketConfig | undefined;
  try {
    await withAwsRehearsal(
      async (ctx) => {
        config = await interruptScenario(ctx, args.point, say, args.otherBucket);
      },
      {
        endpoint: args.endpoint,
        receiptDir: args.receiptDir,
        apis: INTERRUPT_APIS,
        deadlineMs: DRIVER_DEADLINE_MS,
        settleMs: DRIVER_SETTLE_MS,
        teardownMs: args.teardownMs,
      },
    );
  } finally {
    if (args.otherBucket !== undefined && config !== undefined) {
      // Outside every run: the gate lets it through, so the server's log shows it.
      const client = createBucketClient(config);
      try {
        await client.send(new GetBucketLocationCommand({ Bucket: args.otherBucket }));
        say("CONTROL sent");
      } catch (error) {
        say(`CONTROL ${nameOf(error)}`);
      } finally {
        client.destroy();
      }
    }
  }
}

if (
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const args = parseDriverArgs(process.argv.slice(2));
  if (args === null) {
    console.error(
      "usage: aws-rehearsal-interrupt-driver.ts --endpoint <loopback url> --receipt-dir <dir> " +
        "--point <point> [--teardown-ms <ms>] [--other-bucket <name>, with --point unplanned only]",
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

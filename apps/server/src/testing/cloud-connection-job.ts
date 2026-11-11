import { cloudConnectionJob } from "../cloud-worker.js";
import { runTestJob } from "./run-job.js";

export function runCloudConnectionForTest(
  options: Parameters<typeof cloudConnectionJob>[0] & {
    signal: AbortSignal;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  return runTestJob(
    cloudConnectionJob(options),
    options.signal,
    options.sleep ? { sleep: options.sleep } : {},
  ).done;
}

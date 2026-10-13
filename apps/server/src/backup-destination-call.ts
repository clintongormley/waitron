import { AppError } from "@waitron/shared";
import type { StorageCall } from "./storage-backend.js";
import "./errors.js";

/**
 * Runs one destination's work under its own signal, aborted when `parent` aborts or `timeoutMs`
 * passes. It answers only once `work` settles, never on the timer alone, so the caller does not
 * remove a file a transfer is still reading. A failure after either abort is answered as that abort,
 * coded, whatever the destination threw for it (a folder destination throws an uncoded
 * `AbortError`); a value `work` answers is kept even when the timer has fired.
 */
export async function withDestinationCall<T>(
  parent: AbortSignal,
  timeoutMs: number,
  work: (call: StorageCall) => Promise<T>,
): Promise<T> {
  if (parent.aborted) throw new AppError("backup.destination_cancelled", {});
  const controller = new AbortController();
  let timedOut = false;
  const onParentAbort = () => controller.abort(parent.reason);
  parent.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new AppError("backup.destination_timed_out", { timeoutMs }));
  }, timeoutMs);
  try {
    return await work({ signal: controller.signal });
  } catch (error) {
    if (parent.aborted) throw new AppError("backup.destination_cancelled", {});
    if (timedOut) throw new AppError("backup.destination_timed_out", { timeoutMs });
    throw error;
  } finally {
    clearTimeout(timer);
    parent.removeEventListener("abort", onParentAbort);
  }
}

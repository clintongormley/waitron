import { setTimeout as delay } from "node:timers/promises";
import type { CloudConnection } from "./cloud-client.js";
/** Machine activity never extends a person's management session. */
export async function runCloudWorker(options: {
  connection: CloudConnection;
  signal: AbortSignal;
  isPrimary: () => boolean;
  onError?: (error: unknown) => void;
  staffHostname?: string;
  onStaffCertificate?: () => unknown;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const sleep = options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  while (!options.signal.aborted) {
    try {
      if (options.isPrimary()) {
        const status = await options.connection.refresh(options.signal);
        if (
          options.staffHostname &&
          status.installation?.state === "active" &&
          !options.signal.aborted &&
          options.isPrimary()
        ) {
          const ready = await options.connection.staffCertificate(
            options.staffHostname,
            options.signal,
          );
          if (ready && !options.signal.aborted && options.isPrimary())
            await options.onStaffCertificate?.();
        }
      }
    } catch (error) {
      if (!options.signal.aborted) options.onError?.(error);
    }
    if (options.signal.aborted) return;
    try {
      await sleep(60000, options.signal);
    } catch (error) {
      if (!options.signal.aborted) throw error;
    }
  }
}

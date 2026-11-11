import type { CloudConnection } from "./cloud-client.js";
import type { JobDefinition } from "./job-runner.js";

export function cloudConnectionJob(options: {
  connection: CloudConnection;
  isPrimary: () => boolean;
  onError?: (error: unknown) => void;
  staffHostname?: string;
  onStaffCertificate?: (signal: AbortSignal) => unknown;
}): JobDefinition {
  return {
    name: "cloud.connection",
    applies: () => true,
    minSleepMs: 60_000,
    maxSleepMs: 60_000,
    backoff: { firstMs: 60_000, maxMs: 60_000 },
    async pass({ signal }) {
      try {
        if (options.isPrimary()) {
          const status = await options.connection.refresh(signal);
          if (
            options.staffHostname &&
            status.installation?.state === "active" &&
            !signal.aborted &&
            options.isPrimary()
          ) {
            const ready = await options.connection.staffCertificate(options.staffHostname, signal);
            if (ready && !signal.aborted && options.isPrimary())
              await options.onStaffCertificate?.(signal);
          }
        } else await options.connection.syncTunnel();
      } catch (error) {
        if (!signal.aborted) {
          options.onError?.(error);
          throw error;
        }
      }
      return { nextDueAt: null };
    },
  };
}

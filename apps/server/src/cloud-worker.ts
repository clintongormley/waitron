import { codeOf } from "@waitron/server-kit";
import type { CloudConnection } from "./cloud-client.js";
import type { JobDefinition } from "./job-runner.js";

export function cloudConnectionJob(options: {
  connection: CloudConnection;
  isPrimary: () => boolean;
  onError?: (error: unknown) => void;
  onEmergencyError?: (error: unknown, level: "info" | "warn") => void;
  onGuestMenu?: (signal: AbortSignal) => unknown;
  onGuestMenuError?: (error: unknown) => void;
  managementOrigin?: string;
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
          const status = await options.connection.refresh(signal).catch((error: unknown) => {
            const code = codeOf(error);
            if (
              signal.aborted ||
              (code !== "cloud.tunnel_plan_required" && code !== "cloud.tunnel_refused")
            )
              throw error;
            options.onError?.(error);
            return options.connection.status();
          });
          if (
            options.managementOrigin &&
            status.installation?.state === "active" &&
            !signal.aborted &&
            options.isPrimary()
          ) {
            try {
              await options.connection.emergency(options.managementOrigin, signal);
            } catch (error) {
              if (!signal.aborted)
                options.onEmergencyError?.(
                  error,
                  codeOf(error) === "cloud.unavailable" ? "info" : "warn",
                );
            }
          }
          if (status.installation?.state === "active" && !signal.aborted && options.isPrimary()) {
            try {
              await options.onGuestMenu?.(signal);
            } catch (error) {
              if (!signal.aborted) options.onGuestMenuError?.(error);
            }
          }
          if (
            options.onStaffCertificate &&
            status.installation?.state === "active" &&
            !signal.aborted &&
            options.isPrimary()
          ) {
            const ready = await options.connection.staffCertificate(signal);
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

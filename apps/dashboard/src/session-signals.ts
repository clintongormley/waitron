import { createRequest, type FetchLike } from "@waitron/dashboard-kit";

export interface SessionSignals {
  reportError: (code: string, status?: number) => void;
  reportActivity: () => void;
}

const SESSION_CODES = new Set([
  "management_session.expired",
  "management_session.required",
  "person.suspended",
]);

/**
 * A box in setup mode (after a reset) serves no `/management-api`, so every read answers a bare
 * 404 that decodes as `server.internal`; only setup mode answers `/setup-api/status` with
 * `provisioned: false`.
 */
export function createSessionSignals({
  fetchImpl,
  target = window,
  minProbeIntervalMs = 10_000,
  probeTimeLimitMs = 10_000,
  now = Date.now,
}: {
  fetchImpl: FetchLike;
  target?: EventTarget;
  minProbeIntervalMs?: number;
  probeTimeLimitMs?: number;
  now?: () => number;
}): SessionSignals {
  let probing = false;
  let lastProbeAt: number | undefined;
  let resetReported = false;

  const invalid = (code: string): void => {
    target.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
  };

  // No `onError`: a failed probe must never report into these signals.
  const request = createRequest({ fetchImpl });

  const probe = async (): Promise<void> => {
    probing = true;
    lastProbeAt = now();
    try {
      const body = await request<unknown>("/setup-api/status", "GET", undefined, {
        passive: true,
        timeLimitMs: probeTimeLimitMs,
      });
      if ((body as { provisioned?: unknown } | null | undefined)?.provisioned === false) {
        resetReported = true;
        invalid("node.reset");
      }
    } catch {
      // A refused, failed or timed-out probe says nothing about the box; the next 404 asks again.
    } finally {
      probing = false;
    }
  };

  return {
    reportError(code, status) {
      if (SESSION_CODES.has(code)) {
        invalid(code);
        return;
      }
      if (status !== 404 || code !== "server.internal") return;
      if (resetReported || probing) return;
      if (lastProbeAt !== undefined && now() - lastProbeAt < minProbeIntervalMs) return;
      void probe();
    },
    reportActivity() {
      target.dispatchEvent(new Event("waitron-session-active"));
    },
  };
}

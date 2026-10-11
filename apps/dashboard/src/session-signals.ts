type FetchLike = (path: string, init: RequestInit) => Promise<Response>;

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
  now = Date.now,
}: {
  fetchImpl: FetchLike;
  target?: EventTarget;
  minProbeIntervalMs?: number;
  now?: () => number;
}): SessionSignals {
  let probing = false;
  let lastProbeAt: number | undefined;
  let resetReported = false;

  const invalid = (code: string): void => {
    target.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
  };

  const probe = async (): Promise<void> => {
    probing = true;
    lastProbeAt = now();
    try {
      const response = await fetchImpl("/setup-api/status", {
        method: "GET",
        credentials: "same-origin",
      });
      if (!response.ok) return;
      const body: unknown = await response.json();
      if (
        !resetReported &&
        body !== null &&
        typeof body === "object" &&
        !Array.isArray(body) &&
        (body as { provisioned?: unknown }).provisioned === false
      ) {
        resetReported = true;
        invalid("node.reset");
      }
    } catch {
      // A failed probe says nothing about the box; the next 404 asks again.
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

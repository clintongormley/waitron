export interface SessionSignals {
  reportError: (code: string, status?: number) => void;
  reportActivity: () => void;
}

const SESSION_CODES = new Set([
  "management_session.expired",
  "management_session.required",
  "node.reset",
  "person.suspended",
]);

export function createSessionSignals({
  target = window,
}: { target?: EventTarget } = {}): SessionSignals {
  return {
    reportError(code) {
      if (SESSION_CODES.has(code)) {
        target.dispatchEvent(new CustomEvent("waitron-session-invalid", { detail: { code } }));
      }
    },
    reportActivity() {
      target.dispatchEvent(new Event("waitron-session-active"));
    },
  };
}

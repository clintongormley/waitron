export interface SessionEpoch {
  current(): number;
  advance(): number;
}

export function createSessionEpoch(): SessionEpoch {
  let generation = 0;
  return { current: () => generation, advance: () => ++generation };
}

export interface SessionSignals {
  reportError: (code: string, status?: number, generation?: number) => void;
  reportActivity: (path?: string, generation?: number) => void;
}

const SESSION_CODES = new Set([
  "management_session.expired",
  "management_session.required",
  "node.reset",
  "person.suspended",
]);

export function createSessionSignals({
  target = window,
  sessionGeneration,
}: { target?: EventTarget; sessionGeneration?: () => number } = {}): SessionSignals {
  return {
    reportError(code, _status, generation = sessionGeneration?.()) {
      if (SESSION_CODES.has(code)) {
        target.dispatchEvent(
          new CustomEvent("waitron-session-invalid", {
            detail: { code, ...(generation === undefined ? {} : { generation }) },
          }),
        );
      }
    },
    reportActivity(_path, generation = sessionGeneration?.()) {
      target.dispatchEvent(
        generation === undefined
          ? new Event("waitron-session-active")
          : new CustomEvent("waitron-session-active", { detail: { generation } }),
      );
    },
  };
}

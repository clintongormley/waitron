import type { DiagnosticsLog } from "./log.js";

export interface ErrorTarget {
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}

function codeOf(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null && "code" in value) {
    const c = (value as { code: unknown }).code;
    if (typeof c === "string") return c;
  }
  return undefined;
}

/** Attaches best-effort crash capture to an injected target (the app passes `window`). Every handler
 * is wrapped so a malformed event can never surface a second error out of the logger itself. */
export function installErrorCapture(target: ErrorTarget, log: DiagnosticsLog): void {
  target.addEventListener("error", (ev) => {
    try {
      const e = ev as { message?: unknown; error?: { name?: unknown; stack?: unknown } };
      log.record("error", "window.error", {
        ...(typeof e?.error?.name === "string" ? { name: e.error.name } : {}),
        ...(typeof e?.message === "string" ? { message: e.message } : {}),
        ...(typeof e?.error?.stack === "string" ? { stack: e.error.stack } : {}),
      });
    } catch {
      /* never break the app */
    }
  });
  target.addEventListener("unhandledrejection", (ev) => {
    try {
      const reason = (ev as { reason?: unknown })?.reason;
      const code = codeOf(reason);
      const name =
        typeof (reason as { name?: unknown })?.name === "string"
          ? (reason as { name: string }).name
          : undefined;
      log.record("error", "window.unhandledrejection", {
        ...(code !== undefined ? { code } : {}),
        ...(name !== undefined ? { name } : {}),
      });
    } catch {
      /* never break the app */
    }
  });
}

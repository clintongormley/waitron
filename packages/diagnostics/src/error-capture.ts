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

/** Records one crash event, swallowing anything the build or the record throws so a malformed event
 * can never surface a second error out of the logger itself. */
function safeRecord(
  log: DiagnosticsLog,
  event: string,
  build: () => Record<string, unknown>,
): void {
  try {
    log.record("error", event, build());
  } catch {
    /* never break the app */
  }
}

/** Attaches best-effort crash capture to an injected target (the app passes `window`). */
export function installErrorCapture(target: ErrorTarget, log: DiagnosticsLog): void {
  target.addEventListener("error", (ev) =>
    safeRecord(log, "window.error", () => {
      const e = ev as { message?: unknown; error?: { name?: unknown; stack?: unknown } };
      return {
        ...(typeof e?.error?.name === "string" ? { name: e.error.name } : {}),
        ...(typeof e?.message === "string" ? { message: e.message } : {}),
        ...(typeof e?.error?.stack === "string" ? { stack: e.error.stack } : {}),
      };
    }),
  );
  target.addEventListener("unhandledrejection", (ev) =>
    safeRecord(log, "window.unhandledrejection", () => {
      const reason = ev as { reason?: { name?: unknown; message?: unknown; stack?: unknown } };
      const r = reason?.reason;
      const code = codeOf(r);
      return {
        ...(code !== undefined ? { code } : {}),
        ...(typeof r?.name === "string" ? { name: r.name } : {}),
        ...(typeof r?.message === "string" ? { message: r.message } : {}),
        ...(typeof r?.stack === "string" ? { stack: r.stack } : {}),
      };
    }),
  );
}

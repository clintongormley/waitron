import type { Context, MiddlewareHandler } from "hono";
import { AppError } from "@waitron/shared";
import "./errors.js";

export interface HandoverGate {
  middleware: MiddlewareHandler;
  close(deps: { allowed: (c: Context) => boolean; self?: Context }): void;
  isClosed(): boolean;
  settled(limitMs: number): Promise<{ remaining: readonly { method: string; path: string }[] }>;
}

/**
 * Counts the requests inside while open; once closed, refuses every request `allowed` does not name.
 * A Hono middleware is not inside a route's error boundary, so the refusal is written in the
 * boundary's response shape directly rather than thrown.
 */
export function createHandoverGate(): HandoverGate {
  const inside = new Set<Context>();
  const atZero = new Set<() => void>();
  let allowed: ((c: Context) => boolean) | null = null;

  const leave = (c: Context): void => {
    if (!inside.delete(c) || inside.size > 0) return;
    for (const wake of atZero) wake();
  };

  return {
    middleware: async (c, next) => {
      if (allowed !== null) {
        if (allowed(c)) return next();
        const err = new AppError("handover.stepping_down", {});
        return c.json({ error: { code: err.code, params: err.params } }, 503, {
          "Cache-Control": "no-store",
        });
      }
      inside.add(c);
      try {
        await next();
      } finally {
        leave(c);
      }
    },
    close: ({ allowed: names, self }) => {
      allowed = names;
      if (self !== undefined) leave(self);
    },
    isClosed: () => allowed !== null,
    settled: (limitMs) =>
      new Promise((resolve) => {
        if (inside.size === 0) {
          resolve({ remaining: [] });
          return;
        }
        const wake = (): void => {
          clearTimeout(timer);
          atZero.delete(wake);
          resolve({ remaining: [] });
        };
        const timer = setTimeout(() => {
          atZero.delete(wake);
          resolve({
            remaining: [...inside].map((c) => ({ method: c.req.method, path: c.req.path })),
          });
        }, limitMs);
        atZero.add(wake);
      }),
  };
}

import type { Context, MiddlewareHandler } from "hono";
import { AppError, FALLBACK_LOCALE, isDashboardPath } from "@waitron/shared";
import { boxPageAnswer, renderLogoBoxPage } from "./guide-pages.js";
import { escapeHtml } from "./html-page.js";
import { STANDING_DOWN_PAGE_WORDS } from "./i18n/restricted-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import "./errors.js";

export interface HandoverGate {
  middleware: MiddlewareHandler;
  readonly closed: AbortSignal;
  close(deps: { allowed: (c: Context) => boolean; self?: Context }): void;
  isClosed(): boolean;
  settled(limitMs: number): Promise<{ remaining: readonly { method: string; path: string }[] }>;
}

export function steppingDownResponse(c: Context): Response {
  const err = new AppError("handover.stepping_down", {});
  c.set("refusalCode", err.code);
  return c.json({ error: { code: err.code, params: err.params } }, 503, {
    "Cache-Control": "no-store",
  });
}

/** The paths `restrictedPageRoute` serves once the box has restarted, so a refresh lands there. */
function isPersonPage(c: Context): boolean {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return false;
  const path = c.req.path;
  return path === "/till" || path.startsWith("/till/") || isDashboardPath(path);
}

function standingDownPage(c: Context): Response {
  c.set("refusalCode", "handover.stepping_down");
  const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
  const text = STANDING_DOWN_PAGE_WORDS[locale];
  c.header("Vary", "Accept-Language");
  c.header("Refresh", "5");
  return boxPageAnswer(
    c,
    renderLogoBoxPage(
      locale,
      text.title,
      `<h1>${escapeHtml(text.title)}</h1>
<p>${escapeHtml(text.body)}</p>
<p>${escapeHtml(text.restarting)}</p>`,
    ),
    503,
    "no-store",
  );
}

/**
 * Counts the requests inside while open; once closed, refuses every request `allowed` does not name.
 * A Hono middleware is not inside a route's error boundary, so the refusal is written in the
 * boundary's response shape directly rather than thrown.
 *
 * The gate runs ahead of the start's own CORS layer, so a closed gate applies `cors` itself to an
 * `/api/*` refusal and answers that path's preflight: without them a till on another box's page
 * cannot read the refusal and sees a failed request instead. An origin list that cannot be read
 * leaves the refusal without CORS headers rather than turning it into an error.
 */
export function createHandoverGate(deps: { cors?: MiddlewareHandler } = {}): HandoverGate {
  const closed = new AbortController();
  const inside = new Set<Context>();
  const atZero = new Set<() => void>();
  let allowed: ((c: Context) => boolean) | null = null;

  const refuse = async (c: Context): Promise<Response> => {
    if (isPersonPage(c)) return standingDownPage(c);
    const cors = deps.cors;
    if (cors === undefined || !c.req.path.startsWith("/api/")) return steppingDownResponse(c);
    try {
      const preflight = await cors(c, async () => {
        c.res = steppingDownResponse(c);
      });
      return preflight ?? c.res;
    } catch {
      return steppingDownResponse(c);
    }
  };

  const leave = (c: Context): void => {
    if (!inside.delete(c) || inside.size > 0) return;
    for (const wake of atZero) wake();
  };

  return {
    closed: closed.signal,
    middleware: async (c, next) => {
      if (allowed !== null) {
        if (allowed(c)) return next();
        return refuse(c);
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
      closed.abort();
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

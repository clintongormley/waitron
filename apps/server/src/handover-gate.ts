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
  /** `successorKnown` (default true) says whether another box is known to run the venue now. */
  close(deps: { allowed: (c: Context) => boolean; self?: Context; successorKnown?: boolean }): void;
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

/**
 * The paths `restrictedPageRoute` answers, so the standing-down page's own asking lands on that page
 * once the box has restarted restricted.
 */
function isPersonPage(c: Context): boolean {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") return false;
  const path = c.req.path;
  return path === "/till" || path.startsWith("/till/") || isDashboardPath(path);
}

const STANDING_DOWN_HEADER = "X-Waitron-Standing-Down";

// Asks by script rather than a `Refresh` header: in Chromium, a refresh that lands while the
// restarting box has no listener leaves its own error page, which never asks again. An unmarked
// 502, 503 or 504 keeps it asking too: a gateway in front of a box with no listener may give one.
const ASK_AGAIN_SCRIPT = `(() => {
  const here = location.pathname + location.search;
  const ask = async () => {
    try {
      const response = await fetch(here, { cache: "no-store", headers: { accept: "text/html" }, signal: AbortSignal.timeout(5000) });
      if (response.headers.get("${STANDING_DOWN_HEADER.toLowerCase()}") === null && ![502, 503, 504].includes(response.status))
        return location.replace(here);
    } catch {}
    setTimeout(ask, 5000);
  };
  setTimeout(ask, 5000);
})();`;

function standingDownPage(c: Context, successorKnown: boolean): Response {
  c.set("refusalCode", "handover.stepping_down");
  const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
  const text = STANDING_DOWN_PAGE_WORDS[locale];
  c.header("Vary", "Accept-Language");
  c.header(STANDING_DOWN_HEADER, "1");
  const successor = successorKnown ? `<p>${escapeHtml(text.body)}</p>\n` : "";
  return boxPageAnswer(
    c,
    renderLogoBoxPage(
      locale,
      text.title,
      `<h1>${escapeHtml(text.title)}</h1>
${successor}<p>${escapeHtml(text.restarting)}</p>
<script>${ASK_AGAIN_SCRIPT}</script>`,
    ),
    503,
    "no-store",
    { inline: [ASK_AGAIN_SCRIPT], connectSelf: true },
  );
}

/**
 * Counts the requests inside while open; once closed, refuses every request `allowed` does not name:
 * a GET or HEAD of a till or dashboard page gets the standing-down page, anything else the
 * boundary's JSON refusal (an `/api/*` preflight aside, below). A Hono middleware is not inside a
 * route's error boundary, so both are written directly rather than thrown.
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
  let successorKnown = true;

  const refuse = async (c: Context): Promise<Response> => {
    if (isPersonPage(c)) return standingDownPage(c, successorKnown);
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
    close: ({ allowed: names, self, successorKnown: known = true }) => {
      allowed = names;
      successorKnown = known;
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

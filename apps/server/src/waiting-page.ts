import type { Context, Hono } from "hono";
import {
  FALLBACK_LOCALE,
  isAppError,
  isDashboardPath,
  type SupportedLocale,
} from "@waitron/shared";
import { WAITING_PAGE_WORDS } from "./i18n/waiting-page.js";
import { codeOf } from "@waitron/server-kit";
import { errnoOf } from "./errno.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml, renderDocument } from "./html-page.js";
import { boxFormHead } from "./guide-pages.js";

/** A failure's log fields: an app error's log-only `reason` when it carries one, else its errno. */
export function failureFields(error: unknown): Record<string, string | null> {
  if (isAppError(error) && error.reason !== undefined)
    return { errorCode: codeOf(error), reason: error.reason };
  return { errorCode: codeOf(error), errno: errnoOf(error) ?? null };
}

export function otherBoxPhrase(names: readonly (string | null)[], locale: SupportedLocale): string {
  const text = WAITING_PAGE_WORDS[locale];
  const shown = [...new Set(names.map((name) => name ?? text.otherBox))];
  return shown.length === 0
    ? text.otherBox
    : new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
}

const WAITING_HEADER = "X-Waitron-Waiting";

export function pageReturnPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  const url = new URL(value, "http://local");
  if (
    url.origin !== "http://local" ||
    !(isDashboardPath(value) || /^\/till(?:\/|$)/.test(url.pathname))
  )
    return "/";
  return url.pathname + url.search;
}

function leaveWhenDone(destination: string): string {
  return `<script>
(() => {
  const destination = ${JSON.stringify(destination).replaceAll("<", "\\u003c")};
  const ask = async () => {
    try {
      const response = await fetch(destination, { cache: "no-store", headers: { accept: "text/html" }, signal: AbortSignal.timeout(5000) });
      if (response.ok && response.headers.get("${WAITING_HEADER.toLowerCase()}") === null)
        return location.replace(destination);
    } catch {}
    setTimeout(ask, 5000);
  };
  setTimeout(ask, 5000);
})();
</script>
`;
}

/** The waiting page, with `section` (escaped HTML, such as the carry-on form) below its body. */
export function renderWaitingPage(
  other: string,
  locale: SupportedLocale,
  section = "",
  destination = "/",
): string {
  const text = WAITING_PAGE_WORDS[locale];
  return renderDocument(
    locale,
    `${text.title[0]}${other}${text.title[1]}`,
    `<p>${escapeHtml(text.body[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(text.body[1])}</p>
${section}${leaveWhenDone(pageReturnPath(destination))}`,
    boxFormHead(),
  );
}

/**
 * Draws what the page shows below its body for this request (the carry-on form or why not), or a
 * whole `page` in place of the waiting page.
 */
export type WaitingPageSection = (
  c: Context,
  other: string,
  locale: SupportedLocale,
) => Promise<string | { page: string }>;

/** The page a person opening a box that waits for its peers sees; the addresses are read per request. */
export function waitingPageRoute(
  names: () => Promise<readonly (string | null)[]>,
  log: Logger,
  section?: WaitingPageSection,
): (app: Hono) => void {
  return (app) => {
    app.get("*", async (c, next) => {
      const path = c.req.path;
      if (
        path !== "/" &&
        (!(isDashboardPath(path) || /^\/till(?:\/|$)/.test(path)) ||
          !(c.req.header("Accept") ?? "").includes("text/html"))
      )
        return next();
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      c.header(WAITING_HEADER, "1");
      let shown: readonly (string | null)[] = [];
      try {
        shown = await names();
      } catch (error) {
        log("warn", "waiting_page.names_failed", { errorCode: codeOf(error) });
      }
      const other = otherBoxPhrase(shown, locale);
      let below: string | { page: string } = "";
      if (section !== undefined) {
        try {
          below = await section(c, other, locale);
        } catch (error) {
          log("warn", "waiting_page.section_failed", failureFields(error));
          below = `<p>${escapeHtml(WAITING_PAGE_WORDS[locale].carryOn.unavailable)}</p>\n`;
        }
      }
      return c.html(
        typeof below === "string"
          ? renderWaitingPage(
              other,
              locale,
              below,
              new URL(c.req.url).pathname + new URL(c.req.url).search,
            )
          : below.page,
      );
    });
  };
}

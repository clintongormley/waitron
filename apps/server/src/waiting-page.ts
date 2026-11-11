import { inArray } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { nodes, type Database } from "@waitron/db";
import { FALLBACK_LOCALE, isAppError, type SupportedLocale } from "@waitron/shared";
import { WAITING_PAGE_WORDS } from "./i18n/waiting-page.js";
import { codeOf } from "@waitron/server-kit";
import { errnoOf } from "./errno.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml, renderDocument } from "./html-page.js";

/** A failure's log fields: an app error's log-only `reason` when it carries one, else its errno. */
export function failureFields(error: unknown): Record<string, string | null> {
  if (isAppError(error) && error.reason !== undefined)
    return { errorCode: codeOf(error), reason: error.reason };
  return { errorCode: codeOf(error), errno: errnoOf(error) ?? null };
}

/** Each box's name from this box's `nodes` rows, or `null` where it has no row or no name. */
export async function readPeerNames(
  venue: Database,
  ids: readonly string[],
): Promise<(string | null)[]> {
  if (ids.length === 0) return [];
  const rows = await venue
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(inArray(nodes.id, [...ids]));
  const named = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => {
    const name = named.get(id);
    return name === undefined || name === "" ? null : name;
  });
}

/** The other boxes as one phrase: their names joined, or "the other box" where none has one. */
export function otherBoxPhrase(names: readonly (string | null)[], locale: SupportedLocale): string {
  const text = WAITING_PAGE_WORDS[locale];
  const shown = [...new Set(names.map((name) => name ?? text.otherBox))];
  return shown.length === 0
    ? text.otherBox
    : new Intl.ListFormat(locale, { type: "conjunction" }).format(shown);
}

/** The waiting page, with `section` (escaped HTML, such as the carry-on form) below its body. */
export function renderWaitingPage(other: string, locale: SupportedLocale, section = ""): string {
  const text = WAITING_PAGE_WORDS[locale];
  return renderDocument(
    locale,
    `${text.title[0]}${other}${text.title[1]}`,
    `<p>${escapeHtml(text.body[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(text.body[1])}</p>
${section}`,
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

/** The page a person opening a box that waits for its peers sees; `names` is read per request. */
export function waitingPageRoute(
  names: () => Promise<readonly (string | null)[]>,
  log: Logger,
  section?: WaitingPageSection,
): (app: Hono) => void {
  return (app) => {
    app.get("/", async (c) => {
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
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
        typeof below === "string" ? renderWaitingPage(other, locale, below) : below.page,
      );
    });
  };
}

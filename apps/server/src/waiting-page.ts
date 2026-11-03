import { inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { nodes, type Database } from "@waitron/db";
import { FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";
import { WAITING_PAGE_WORDS } from "./i18n/waiting-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import { escapeHtml } from "./recovery-surface.js";

/** Each box's name from this box's `nodes` rows, or its id where it has no row or no name. */
export async function readPeerNames(venue: Database, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await venue
    .select({ id: nodes.id, name: nodes.name })
    .from(nodes)
    .where(inArray(nodes.id, [...ids]));
  const named = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => {
    const name = named.get(id);
    return name === undefined || name === "" ? id : name;
  });
}

function renderPage(names: readonly string[], locale: SupportedLocale): string {
  const text = WAITING_PAGE_WORDS[locale];
  const other =
    names.length === 0
      ? text.otherBox
      : new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
  const title = `${text.title[0]}${other}${text.title[1]}`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>:root { color-scheme: light dark; } h1, p { overflow-wrap: anywhere; }</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(text.body[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(text.body[1])}</p>
</body>
</html>
`;
}

/** The page a person opening a box that waits for its peers sees. */
export function waitingPageRoute(names: readonly string[]): (app: Hono) => void {
  return (app) => {
    app.get("/", (c) => {
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      return c.html(renderPage(names, locale));
    });
  };
}

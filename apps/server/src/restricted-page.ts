import { and, asc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { nodes, readVenue, type Database, type NodeDatabase } from "@waitron/db";
import { initialState } from "@waitron/handover";
import {
  nodeHandoverEvents,
  readHandoverOperation,
  readHandoverRestriction,
} from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { AppError, FALLBACK_LOCALE, type SupportedLocale } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml } from "./recovery-surface.js";
import {
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_STEP_WORDS,
  type RestrictedStepKind,
} from "./i18n/restricted-page.js";
import { knownZone } from "./venue-time-zone.js";

export interface RestrictedPageDeps {
  venue: Database;
  node: NodeDatabase;
  nodeId: string;
  log: Logger;
}

interface Step {
  /** A handover state's name, or another event's kind, as `node_handover_events.kind` recorded it. */
  kind: string;
  at: Date;
}

interface RestrictedView {
  successor: string;
  steps: Step[];
  timeZone: string;
}

/** `Object.hasOwn`: the kind is read from a file, and `toString` must not find an inherited value. */
function stepText(kind: string, locale: SupportedLocale): string {
  if (!Object.hasOwn(RESTRICTED_STEP_WORDS, kind)) return kind;
  return RESTRICTED_STEP_WORDS[kind as RestrictedStepKind][locale];
}

/**
 * Outside a transaction: `withTransaction` takes the write lock and drains `change_log`, and this
 * box writes nothing to venue.db (`boot.restricted-quiet.test.ts`).
 */
async function readTimeZone(venue: Database): Promise<string> {
  try {
    return knownZone((await readVenue(venue)).timeZone);
  } catch (error) {
    if (error instanceof AppError && error.code === "venue.not_found") return "UTC";
    throw error;
  }
}

async function readView(deps: RestrictedPageDeps): Promise<RestrictedView> {
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  // A fault in Waitron: this page is mounted only on a start that found the restriction.
  if (restriction === null) throw new Error(`no handover restriction for node ${deps.nodeId}`);
  const [row] = await deps.venue
    .select({ name: nodes.name })
    .from(nodes)
    .where(eq(nodes.id, restriction.successorNodeId));
  const steps: Step[] = [];
  const operation =
    restriction.operationId === null
      ? null
      : await readHandoverOperation(deps.node, deps.nodeId, restriction.operationId);
  if (operation !== null) {
    // The first state is written with the operation's row; only later ones are events.
    steps.push({
      kind: initialState(operation.role, operation.scenario),
      at: operation.createdAt,
    });
    const events = await deps.node
      .select({ kind: nodeHandoverEvents.kind, at: nodeHandoverEvents.recordedAt })
      .from(nodeHandoverEvents)
      .where(
        and(
          eq(nodeHandoverEvents.nodeId, deps.nodeId),
          eq(nodeHandoverEvents.operationId, operation.operationId),
        ),
      )
      .orderBy(asc(sql`rowid`));
    steps.push(...events);
  }
  return {
    successor: row === undefined || row.name === "" ? restriction.successorNodeId : row.name,
    steps,
    timeZone: await readTimeZone(deps.venue),
  };
}

function renderPage(view: RestrictedView, locale: SupportedLocale): string {
  const text = RESTRICTED_PAGE_WORDS[locale];
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: view.timeZone,
  });
  const steps =
    view.steps.length === 0
      ? ""
      : `<h2>${escapeHtml(text.progress)}</h2>
<ul>
${view.steps
  .map(
    (step) => `<li>${escapeHtml(`${when.format(step.at)}: ${stepText(step.kind, locale)}`)}</li>`,
  )
  .join("\n")}
</ul>
`;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(text.title)}</title>
<style>:root { color-scheme: light dark; } p, li { overflow-wrap: anywhere; }</style>
</head>
<body>
<h1>${escapeHtml(text.title)}</h1>
<p>${escapeHtml(text.body[0])}<strong>${escapeHtml(view.successor)}</strong>${escapeHtml(text.body[1])}</p>
${steps}
</body>
</html>
`;
}

function renderFailure(locale: SupportedLocale): string {
  const heading = RESTRICTED_PAGE_WORDS[locale].failed;
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(heading)}</title>
<style>:root { color-scheme: light dark; }</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
</body>
</html>
`;
}

/** The page a person opening a stepped-down box sees. It offers nothing to do: none is needed. */
export function restrictedPageRoute(deps: RestrictedPageDeps): (app: Hono) => void {
  return (app) => {
    app.get("/", async (c) => {
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      try {
        return c.html(renderPage(await readView(deps), locale));
      } catch (error) {
        deps.log("error", "restricted_page.failed", {
          errorCode: codeOf(error),
          requestId: c.get("requestId"),
        });
        return c.html(renderFailure(locale), 500);
      }
    });
  };
}

import type { ReturnState } from "./return-records.js";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import {
  nodes,
  readNodeMembership,
  readVenue,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import { initialState } from "@waitron/handover";
import {
  nodeHandoverEvents,
  readHandoverOperation,
  readHandoverRestriction,
} from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { AppError, FALLBACK_LOCALE, isDashboardPath, type SupportedLocale } from "@waitron/shared";
import { handoverPageOf } from "./handover-status-api.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml, httpsLinkLine } from "./html-page.js";
import { boxPageAnswer, renderLogoBoxPage } from "./guide-pages.js";
import {
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_RETURN_WORDS,
  RESTRICTED_STEP_WORDS,
  type RestrictedStepKind,
} from "./i18n/restricted-page.js";
import { knownZone } from "./venue-time-zone.js";

export interface RestrictedPageDeps {
  venue: Database;
  node: NodeDatabase;
  nodeId: string;
  log: Logger;
  returnState?(): ReturnState;
}

interface Step {
  /** A handover state's name, or another event's kind, as `node_handover_events.kind` recorded it. */
  kind: string;
  at: Date;
}

interface RestrictedView {
  returnState: ReturnState;
  successor: string;
  successorUrl?: string;
  steps: Step[];
  timeZone: string;
  handoverPage?: string;
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

/** A link's address, or none when reading it fails: the page stands without its links. */
async function linkOrNone(
  deps: RestrictedPageDeps,
  requestId: string,
  event: string,
  read: () => Promise<string | undefined>,
): Promise<string | undefined> {
  try {
    return await read();
  } catch (error) {
    deps.log("warn", event, { errorCode: codeOf(error), requestId });
    return undefined;
  }
}

async function readView(deps: RestrictedPageDeps, requestId: string): Promise<RestrictedView> {
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
  // The successor's own entry, never the chart's serving primary: this box's chart can still name itself.
  const successorUrl = await linkOrNone(
    deps,
    requestId,
    "restricted_page.successor_link_failed",
    async () =>
      (await readNodeMembership(deps.venue))?.body.nodes.find(
        (entry) => entry.nodeId === restriction.successorNodeId,
      )?.contactUrl,
  );
  return {
    successorUrl,
    successor: row === undefined || row.name === "" ? restriction.successorNodeId : row.name,
    steps,
    timeZone: await readTimeZone(deps.venue),
    handoverPage:
      operation === null
        ? undefined
        : await linkOrNone(deps, requestId, "restricted_page.progress_link_failed", () =>
            handoverPageOf({ db: deps.venue }, operation),
          ),
    returnState: deps.returnState?.() ?? "waiting",
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
  return renderLogoBoxPage(
    locale,
    text.title,
    `<h1>${escapeHtml(text.title)}</h1>
<p>${escapeHtml(text.body[0])}<strong>${escapeHtml(view.successor)}</strong>${escapeHtml(text.body[1])}</p>
${httpsLinkLine(view.successorUrl, text.openSuccessor)}
${view.handoverPage === undefined || !/^https?:\/\//.test(view.handoverPage) ? "" : `<p><a href="${escapeHtml(view.handoverPage)}">${escapeHtml(text.progress)}</a></p>`}
${steps}
<p>${escapeHtml(RESTRICTED_RETURN_WORDS[locale][view.returnState])}</p>`,
  );
}

function renderFailure(locale: SupportedLocale): string {
  const heading = RESTRICTED_PAGE_WORDS[locale].failed;
  return renderLogoBoxPage(locale, heading, `<h1>${escapeHtml(heading)}</h1>`);
}

/** The page a person opening a stepped-down box sees, at its own, the till's and the dashboard's pages. */
export function restrictedPageRoute(deps: RestrictedPageDeps): (app: Hono) => void {
  return (app) => {
    app.get("*", async (c, next) => {
      const path = c.req.path;
      if (path !== "/till" && !path.startsWith("/till/") && !isDashboardPath(path)) return next();
      const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      try {
        return boxPageAnswer(
          c,
          renderPage(await readView(deps, c.get("requestId")), locale),
          200,
          "no-store",
        );
      } catch (error) {
        deps.log("error", "restricted_page.failed", {
          errorCode: codeOf(error),
          requestId: c.get("requestId"),
        });
        return boxPageAnswer(c, renderFailure(locale), 500, "no-store");
      }
    });
  };
}

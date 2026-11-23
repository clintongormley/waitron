import type { ReturnState } from "./return-records.js";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { initialState } from "@waitron/handover";
import {
  nodeHandoverEvents,
  readHandoverEvents,
  readHandoverOperation,
  readHandoverRestriction,
} from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { FALLBACK_LOCALE, isDashboardPath, type SupportedLocale } from "@waitron/shared";
import { handoverPageOf } from "./handover-status-api.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { escapeHtml, httpsLinkLine } from "./html-page.js";
import { boxPageAnswer, renderLogoBoxPage } from "./guide-pages.js";
import {
  RESTRICTED_PAGE_WORDS,
  RESTRICTED_RESET_WORDS,
  RESTRICTED_RETURN_WORDS,
  RESTRICTED_MAIN_BOX_WORDS,
  RESTRICTED_STEP_WORDS,
  type RestrictedStepKind,
} from "./i18n/restricted-page.js";
import type { ReplacedResetMarker } from "./replaced-reset.js";
import { venueTimeZoneIn } from "./venue-time-zone.js";

export interface RestrictedPageDeps {
  venue: Database;
  node: NodeDatabase;
  nodeId: string;
  log: Logger;
  returnState?(): ReturnState;
  /** Whether this box has saved a reset the main box ordered, so it restarts shortly. */
  resetOrdered?(): boolean;
  resetPhase?(): Promise<ReplacedResetMarker["phase"] | null>;
}

interface Step {
  /** A handover state's name, or another event's kind, as `node_handover_events.kind` recorded it. */
  kind: string;
  at: Date;
}

export type Successor =
  { kind: "id"; id: string } | { kind: "host"; host: string; main: boolean; contactUrl: string };

interface RestrictedView {
  returnState: ReturnState;
  successor: Successor;
  successorUrl?: string;
  steps: Step[];
  timeZone: string;
  handoverPage?: string;
  reset?: "ordered" | "setAsideRefused";
}

/** `Object.hasOwn`: the kind is read from a file, and `toString` must not find an inherited value. */
function stepText(kind: string, locale: SupportedLocale): string {
  if (!Object.hasOwn(RESTRICTED_STEP_WORDS, kind)) return kind;
  return RESTRICTED_STEP_WORDS[kind as RestrictedStepKind][locale];
}

function webHost(contactUrl: string): string | undefined {
  if (!URL.canParse(contactUrl)) return undefined;
  const url = new URL(contactUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url.host === "" ? undefined : url.host;
}

/** Each box by its address in the held chart, or null where the chart has no usable address. */
export async function readBoxAddresses(
  venue: Database,
  ids: readonly string[],
): Promise<(string | null)[]> {
  if (ids.length === 0) return [];
  const chart = await readNodeMembership(venue);
  return ids.map((id) => {
    const entry = chart?.body.nodes.find((node) => node.nodeId === id);
    return (entry === undefined ? undefined : webHost(entry.contactUrl)) ?? null;
  });
}

/**
 * The box this one handed over to, named by its address in the held chart, never its venue name
 * (a spare's is "<main box's name> (standby)"), or by its id where the chart has no usable address.
 * It is called the main box when the chart lists it as the serving primary, or lists it as standby
 * (`serving-secondary`, a chart older than the takeover) while this box holds a confirmed return to
 * it: the receiver confirms only while its own chart names it main (`return-clash-acceptance.ts`).
 * Listed `sell-only` or `evicted`, it gets no role, whatever this box holds.
 */
export async function readSuccessor(
  deps: Pick<RestrictedPageDeps, "venue" | "node" | "nodeId">,
  successorNodeId: string,
  held?: { readonly operationId: string | null } | null,
): Promise<Successor> {
  const entry = (await readNodeMembership(deps.venue))?.body.nodes.find(
    (node) => node.nodeId === successorNodeId,
  );
  const host = entry === undefined ? undefined : webHost(entry.contactUrl);
  if (host === undefined || entry === undefined) return { kind: "id", id: successorNodeId };
  const { contactUrl } = entry;
  if (entry.standing === "serving-primary") return { kind: "host", host, main: true, contactUrl };
  if (entry.standing !== "serving-secondary")
    return { kind: "host", host, main: false, contactUrl };
  const restriction =
    held === undefined ? await readHandoverRestriction(deps.node, deps.nodeId) : held;
  const confirmed =
    restriction !== null &&
    (
      await readHandoverEvents(deps.node, deps.nodeId, restriction.operationId, "return_confirmed")
    ).some((event) => event.detail.destinationNodeId === successorNodeId);
  return { kind: "host", host, main: confirmed, contactUrl };
}

/** The successor as HTML: its address in bold, then its role where it is known to be main. */
export function successorText(successor: Successor, locale: SupportedLocale): string {
  if (successor.kind === "id") return `<strong>${escapeHtml(successor.id)}</strong>`;
  const role = successor.main ? ` (${escapeHtml(RESTRICTED_MAIN_BOX_WORDS[locale])})` : "";
  return `<strong>${escapeHtml(successor.host)}</strong>${role}`;
}

async function readOrWarn<T>(
  deps: RestrictedPageDeps,
  requestId: string,
  event: string,
  read: () => Promise<T | undefined>,
): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    deps.log("warn", event, { errorCode: codeOf(error), requestId });
    return undefined;
  }
}

async function resetLine(
  deps: RestrictedPageDeps,
  requestId: string,
): Promise<RestrictedView["reset"]> {
  const phase = await readOrWarn(
    deps,
    requestId,
    "restricted_page.reset_marker_unreadable",
    async () => (await deps.resetPhase?.()) ?? undefined,
  );
  if (phase === "set_aside_refused") return "setAsideRefused";
  return deps.resetOrdered?.() === true ? "ordered" : undefined;
}

async function readView(deps: RestrictedPageDeps, requestId: string): Promise<RestrictedView> {
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  // A fault in Waitron: this page is mounted only on a start that found the restriction.
  if (restriction === null) throw new Error(`no handover restriction for node ${deps.nodeId}`);
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
  const successor = (await readOrWarn(
    deps,
    requestId,
    "restricted_page.successor_link_failed",
    () => readSuccessor(deps, restriction.successorNodeId, restriction),
  )) ?? { kind: "id", id: restriction.successorNodeId };
  return {
    successorUrl: successor.kind === "host" ? successor.contactUrl : undefined,
    successor,
    steps,
    // Outside a transaction: `withTransaction` takes the write lock and drains `change_log`, and
    // this box writes nothing to venue.db (`boot.restricted-quiet.test.ts`).
    timeZone: await venueTimeZoneIn(deps.venue),
    handoverPage:
      operation === null
        ? undefined
        : await readOrWarn(deps, requestId, "restricted_page.progress_link_failed", () =>
            handoverPageOf({ db: deps.venue }, operation),
          ),
    returnState: deps.returnState?.() ?? "waiting",
    reset: await resetLine(deps, requestId),
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
<p>${escapeHtml(text.body[0])}${successorText(view.successor, locale)}${escapeHtml(text.body[1])}</p>
${httpsLinkLine(view.successorUrl, text.openSuccessor)}
${view.handoverPage === undefined || !/^https?:\/\//.test(view.handoverPage) ? "" : `<p><a href="${escapeHtml(view.handoverPage)}">${escapeHtml(text.progress)}</a></p>`}
${steps}
<p>${escapeHtml(view.reset === undefined ? RESTRICTED_RETURN_WORDS[locale][view.returnState] : RESTRICTED_RESET_WORDS[locale][view.reset])}</p>`,
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

import type { ReturnState } from "./return-records.js";
import type { Hono } from "hono";
import { readNodeMembership, type Database, type NodeDatabase } from "@waitron/db";
import { isOpen } from "@waitron/handover";
import {
  readHandoverEvents,
  readHandoverOperation,
  readHandoverRestriction,
  type HandoverOperation,
  type HandoverRestriction,
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
} from "./i18n/restricted-page.js";
import { mainBoxToAsk } from "./main-box-answer.js";
import type { ReplacedResetMarker } from "./replaced-reset.js";

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

export type Successor =
  { kind: "id"; id: string } | { kind: "host"; host: string; main: boolean; contactUrl: string };

interface RestrictedView {
  returnState: ReturnState;
  successorUrl?: string;
  handoverPage?: string;
  reset?: "ordered" | "setAsideRefused";
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

/**
 * The taking-over box's page for an open planned handover, offered until this box sees that the
 * handover finished: a confirmed return or a payment-clash receipt (that box answers a return only
 * once activated, `return-records-api.ts`), a recorded `return_confirmed` event, or a held chart
 * naming a box other than this one main (the taking-over box names itself main in the transaction
 * that activates it, `handover-activation.ts`).
 */
async function progressPage(
  deps: RestrictedPageDeps,
  operation: HandoverOperation,
  restriction: HandoverRestriction,
  chart: Awaited<ReturnType<typeof readNodeMembership>> | undefined,
  returnState: ReturnState,
): Promise<string | undefined> {
  if (operation.scenario !== "controlled" || !isOpen(operation.state)) return undefined;
  if (returnState === "confirmed" || returnState === "clash") return undefined;
  const confirmed = await readHandoverEvents(
    deps.node,
    deps.nodeId,
    operation.operationId,
    "return_confirmed",
  );
  if (confirmed.length > 0) return undefined;
  const current = chart === undefined ? await readNodeMembership(deps.venue) : chart;
  if (!mainBoxToAsk(deps.nodeId, current, restriction).fromRestriction) return undefined;
  return await handoverPageOf({ db: deps.venue }, operation);
}

async function readView(deps: RestrictedPageDeps, requestId: string): Promise<RestrictedView> {
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  // A fault in Waitron: this page is mounted only on a start that found the restriction.
  if (restriction === null) throw new Error(`no handover restriction for node ${deps.nodeId}`);
  const operation =
    restriction.operationId === null
      ? null
      : await readHandoverOperation(deps.node, deps.nodeId, restriction.operationId);
  // The rule the return sender uses to choose the box it sends to (`return-records.ts`).
  const read = await readOrWarn(
    deps,
    requestId,
    "restricted_page.successor_link_failed",
    async () => {
      const chart = await readNodeMembership(deps.venue);
      return { chart, mainBox: mainBoxToAsk(deps.nodeId, chart, restriction) };
    },
  );
  const returnState = deps.returnState?.() ?? "waiting";
  return {
    successorUrl: read?.mainBox.target?.contactUrl,
    handoverPage:
      operation === null
        ? undefined
        : await readOrWarn(deps, requestId, "restricted_page.progress_link_failed", () =>
            progressPage(deps, operation, restriction, read?.chart, returnState),
          ),
    returnState,
    reset: await resetLine(deps, requestId),
  };
}

function renderPage(view: RestrictedView, locale: SupportedLocale): string {
  const text = RESTRICTED_PAGE_WORDS[locale];
  const line =
    view.reset !== undefined
      ? RESTRICTED_RESET_WORDS[locale][view.reset]
      : view.returnState === "confirmed"
        ? undefined
        : RESTRICTED_RETURN_WORDS[locale][view.returnState];
  return renderLogoBoxPage(
    locale,
    text.title,
    `<h1>${escapeHtml(text.title)}</h1>
${httpsLinkLine(view.successorUrl, text.openDashboard)}
${line === undefined ? "" : `<p>${escapeHtml(line)}</p>`}
${view.handoverPage === undefined || !/^https?:\/\//.test(view.handoverPage) ? "" : `<p><a href="${escapeHtml(view.handoverPage)}">${escapeHtml(text.progress)}</a></p>`}`,
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

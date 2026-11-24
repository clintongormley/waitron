import type { ReturnState } from "./return-records.js";
import type { Context, Hono } from "hono";
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
import { BOX_FORM_STYLE, boxPageAnswer, renderLogoBoxPage } from "./guide-pages.js";
import { codeInput, emailInput } from "./carry-on.js";
import { isSecure } from "./encrypted-connection.js";
import { passwordInput } from "./recovery-start-again.js";
import {
  RESTRICTED_DOWNLOAD_WORDS,
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

/** Why `POST /old-box-data` answered the page instead of the workbook. */
export type OldBoxDownloadRefusal =
  | "insecure"
  | "otherPage"
  | "wipeUnderWay"
  | "fieldsMissing"
  | "busy"
  | "throttled"
  | "signInRefused"
  | "totpRequired"
  | "notPermitted"
  | "failed";

/** The download section's state after a refused download: the refusal and the email kept. */
export interface OldBoxDownloadState {
  refusal: OldBoxDownloadRefusal;
  email: string;
  retryAfterSeconds?: number;
  /** Whether the refused form held the authenticator code field. */
  askCode?: boolean;
}

interface RestrictedView {
  returnState: ReturnState;
  /** Whether this box handed over in a planned handover, not an emergency switch. */
  planned: boolean;
  download?: OldBoxDownloadState;
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

async function readRestriction(
  deps: Pick<RestrictedPageDeps, "node" | "nodeId">,
): Promise<{ restriction: HandoverRestriction; operation: HandoverOperation | null }> {
  const restriction = await readHandoverRestriction(deps.node, deps.nodeId);
  // A fault in Waitron: this page is mounted only on a start that found the restriction.
  if (restriction === null) throw new Error(`no handover restriction for node ${deps.nodeId}`);
  const operation =
    restriction.operationId === null
      ? null
      : await readHandoverOperation(deps.node, deps.nodeId, restriction.operationId);
  return { restriction, operation };
}

const isPlanned = (operation: HandoverOperation | null) => operation?.scenario === "controlled";

/** Whether this box was replaced by a planned handover rather than an emergency switch. */
export async function readPlannedHandover(
  deps: Pick<RestrictedPageDeps, "node" | "nodeId">,
): Promise<boolean> {
  return isPlanned((await readRestriction(deps)).operation);
}

async function readView(
  deps: RestrictedPageDeps,
  requestId: string,
  download?: OldBoxDownloadState,
): Promise<RestrictedView> {
  const { restriction, operation } = await readRestriction(deps);
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
    planned: isPlanned(operation),
    reset: await resetLine(deps, requestId),
    ...(download === undefined ? {} : { download }),
  };
}

/** What the download form shows after a refusal: fields marked beside them, the bottom line. */
function downloadMessages(
  download: OldBoxDownloadState | undefined,
  words: (typeof RESTRICTED_DOWNLOAD_WORDS)[SupportedLocale],
): { email?: string; password?: string; totp?: string; message?: string; askCode: boolean } {
  if (download === undefined) return { askCode: false };
  const shown = refusalMessages(download, words);
  return { ...shown, askCode: shown.askCode === true || download.askCode === true };
}

function refusalMessages(
  download: OldBoxDownloadState,
  words: (typeof RESTRICTED_DOWNLOAD_WORDS)[SupportedLocale],
): { email?: string; password?: string; totp?: string; message?: string; askCode?: true } {
  switch (download.refusal) {
    case "insecure":
    case "wipeUnderWay":
      return {};
    case "fieldsMissing":
      // The route keeps the email it read; with one kept, the password was the missing field.
      return {
        ...(download.email === ""
          ? { email: words.emailMissing }
          : { password: words.passwordMissing }),
        message: words.fixFields,
      };
    case "totpRequired":
      return { totp: words.totpRequired, message: words.fixFields, askCode: true };
    case "throttled":
      return {
        message: words.throttled(Math.max(1, Math.ceil((download.retryAfterSeconds ?? 60) / 60))),
      };
    default:
      return { message: words[download.refusal] };
  }
}

function downloadSection(view: RestrictedView, locale: SupportedLocale, secure: boolean): string {
  const words = RESTRICTED_DOWNLOAD_WORDS[locale];
  const heading = `<h2>${escapeHtml(words.heading)}</h2>\n`;
  if (view.reset === "ordered" || view.download?.refusal === "wipeUnderWay") {
    const alert = view.download === undefined ? "" : ' role="alert"';
    return `<section>\n${heading}<p${alert}>${escapeHtml(words.wipeUnderWay)}</p>\n</section>`;
  }
  const intro = `<p>${escapeHtml(view.planned ? words.planned : words.emergency)}</p>\n`;
  if (!secure)
    return `<section>\n${heading}${intro}<p>${escapeHtml(words.insecure)}</p>\n</section>`;
  const shown = downloadMessages(view.download, words);
  const error = (field: "email" | "password" | "totp") =>
    shown[field] === undefined
      ? ""
      : `<p id="old-box-data-${field}-error">${escapeHtml(shown[field])}</p>\n`;
  const invalid = (field: "email" | "password" | "totp") =>
    shown[field] === undefined
      ? ""
      : ` aria-invalid="true" aria-describedby="old-box-data-${field}-error"`;
  const code = shown.askCode
    ? `<p><label for="old-box-data-totp">${escapeHtml(words.totp)} <span class="required">*</span></label></p>
<p>${codeInput("old-box-data-totp", invalid("totp"), true)}</p>\n${error("totp")}`
    : "";
  const bottom =
    shown.message === undefined
      ? ""
      : `<p id="old-box-data-message" role="alert">${escapeHtml(shown.message)}</p>\n`;
  return `<section>
${heading}${intro}<form method="post" action="/old-box-data" class="box-form">
<p><label for="old-box-data-email">${escapeHtml(words.email)} <span class="required">*</span></label></p>
<p>${emailInput("old-box-data-email", view.download?.email ?? "", invalid("email"))}</p>
${error("email")}<p><label for="old-box-data-password">${escapeHtml(words.password)} <span class="required">*</span></label></p>
<p>${passwordInput(invalid("password"), "old-box-data-password")}</p>
${error("password")}${code}${bottom}<p><button type="submit">${escapeHtml(words.action)}</button></p>
</form>
</section>`;
}

/** The replaced box's page, its download section included. */
export function renderRestrictedPage(
  view: RestrictedView,
  locale: SupportedLocale,
  secure: boolean,
): string {
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
${view.handoverPage === undefined || !/^https?:\/\//.test(view.handoverPage) ? "" : `<p><a href="${escapeHtml(view.handoverPage)}">${escapeHtml(text.progress)}</a></p>`}
${downloadSection(view, locale, secure)}`,
    BOX_FORM_STYLE,
  );
}

function renderFailure(locale: SupportedLocale): string {
  const heading = RESTRICTED_PAGE_WORDS[locale].failed;
  return renderLogoBoxPage(locale, heading, `<h1>${escapeHtml(heading)}</h1>`);
}

/** The restricted page as this request's answer, with the download section's state when given. */
export async function restrictedPageAnswer(
  deps: RestrictedPageDeps,
  c: Context,
  status: 200 | 400 | 401 | 403 | 409 | 429 | 500,
  download?: OldBoxDownloadState,
): Promise<Response> {
  const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
  c.header("Cache-Control", "no-store");
  c.header("Vary", "Accept-Language");
  try {
    return boxPageAnswer(
      c,
      renderRestrictedPage(await readView(deps, c.get("requestId"), download), locale, isSecure(c)),
      status,
      "no-store",
      { inline: [], connectSelf: false, formSelf: true },
    );
  } catch (error) {
    deps.log("error", "restricted_page.failed", {
      errorCode: codeOf(error),
      requestId: c.get("requestId"),
    });
    return boxPageAnswer(c, renderFailure(locale), 500, "no-store");
  }
}

/** The page a person opening a stepped-down box sees, at its own, the till's and the dashboard's pages. */
export function restrictedPageRoute(deps: RestrictedPageDeps): (app: Hono) => void {
  return (app) => {
    app.get("*", async (c, next) => {
      const path = c.req.path;
      if (path !== "/till" && !path.startsWith("/till/") && !isDashboardPath(path)) return next();
      return restrictedPageAnswer(deps, c, 200);
    });
  };
}

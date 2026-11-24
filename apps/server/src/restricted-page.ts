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
import type { OldBoxDataDeps } from "./old-box-data-page.js";
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
  | "passkeyRefused"
  | "passkeyExpired"
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
  /** The refused form's `returnTo`, as posted; only the waiting page draws one. */
  returnTo?: string;
  /** Whether the passkey form was posted: its line is drawn above that form's button instead. */
  passkey?: true;
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
 * handover finished: a confirmed return, a payment-clash receipt, or working hours refused after
 * that box took every invoice batch (it answers a return only once activated,
 * `return-records-api.ts`), a recorded `return_confirmed` event, or a held chart naming a box other
 * than this one main (the taking-over box names itself main in the transaction that activates it,
 * `handover-activation.ts`).
 */
async function progressPage(
  deps: RestrictedPageDeps,
  operation: HandoverOperation,
  restriction: HandoverRestriction,
  chart: Awaited<ReturnType<typeof readNodeMembership>> | undefined,
  returnState: ReturnState,
): Promise<string | undefined> {
  if (operation.scenario !== "controlled" || !isOpen(operation.state)) return undefined;
  if (returnState === "confirmed" || returnState === "clash" || returnState === "hours-refused")
    return undefined;
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

/**
 * Offers a passkey sign-in where the browser can make one: asks this box for a challenge, has the
 * browser answer it, and posts the answer as the passkey form's one field. Its words come from the
 * button's `data-failed`, so one script serves every language. A wipe that began after the page was
 * drawn answers 409, and the page is fetched again to say so.
 */
const PASSKEY_SCRIPT = `(() => {
  const button = document.getElementById("old-box-data-passkey");
  const form = document.getElementById("old-box-data-passkey-form");
  if (!button || !form || !window.PublicKeyCredential) return;
  button.hidden = false;
  const text = (buffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  const bytes = (value) =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const clear = () => {
    document.getElementById("old-box-data-message")?.remove();
    document.getElementById("old-box-data-passkey-message")?.remove();
    // A field's mark goes with the line above the button that explained it.
    const section = form.closest("section");
    for (const error of section.querySelectorAll('[id$="-error"]')) error.remove();
    for (const field of section.querySelectorAll("[aria-invalid]")) {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    }
  };
  const say = (line) => {
    clear();
    const alert = document.createElement("p");
    alert.id = "old-box-data-passkey-message";
    alert.setAttribute("role", "alert");
    alert.textContent = line;
    button.parentElement.before(alert);
  };
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const reply = await fetch("/old-box-data/passkey-options", { method: "POST", cache: "no-store" });
      if (reply.status === 409) {
        // A fresh GET: reload() of a page a refused form drew would post that form again.
        location.assign(location.pathname);
        return;
      }
      if (!reply.ok) throw new Error("options refused");
      const options = await reply.json();
      const credential = await navigator.credentials.get({
        publicKey: { challenge: bytes(options.challenge), rpId: options.rpId, userVerification: "required", timeout: options.timeout },
      });
      if (!credential) throw new Error("no passkey");
      const answer = credential.response;
      form.elements.passkey.value = JSON.stringify({
        id: credential.id,
        rawId: text(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: text(answer.clientDataJSON),
          authenticatorData: text(answer.authenticatorData),
          signature: text(answer.signature),
          userHandle: answer.userHandle ? text(answer.userHandle) : undefined,
        },
        clientExtensionResults: {},
      });
      clear();
      form.submit();
    } catch {
      say(button.dataset.failed);
    }
    // submit() returns before the answer arrives, and a downloaded workbook leaves this page in
    // place; a press while the workbook is still being made is answered "busy", as the password
    // form's is.
    button.disabled = false;
  });
})();`;

/** Whether the download section draws its sign-in forms, rather than only a sentence. */
function drawsDownloadForm(view: RestrictedView, secure: boolean): boolean {
  return secure && !wiping(view);
}

const wiping = (view: RestrictedView) =>
  view.reset === "ordered" || view.download?.refusal === "wipeUnderWay";

function downloadSection(view: RestrictedView, locale: SupportedLocale, secure: boolean): string {
  const words = RESTRICTED_DOWNLOAD_WORDS[locale];
  const heading = `<h2>${escapeHtml(words.heading)}</h2>\n`;
  if (wiping(view)) {
    const alert = view.download === undefined ? "" : ' role="alert"';
    return `<section>\n${heading}<p${alert}>${escapeHtml(words.wipeUnderWay)}</p>\n</section>`;
  }
  return `<section>\n${downloadForm(
    view.planned ? words.planned : words.emergency,
    locale,
    secure,
    view.download,
    undefined,
    true,
  )}</section>`;
}

/**
 * The download block, unwrapped so the page drawing it chooses its section: its heading,
 * `introText`, then the form, or over HTTP why not. The form carries `returnTo` when given;
 * `withPasskey` adds the passkey form and its script, which the page's answer must allow.
 */
export function downloadForm(
  introText: string,
  locale: SupportedLocale,
  secure: boolean,
  download?: OldBoxDownloadState,
  returnTo?: string,
  withPasskey = false,
): string {
  const words = RESTRICTED_DOWNLOAD_WORDS[locale];
  const heading = `<h2>${escapeHtml(words.heading)}</h2>\n`;
  const intro = `<p>${escapeHtml(introText)}</p>\n`;
  if (!secure) return `${heading}${intro}<p>${escapeHtml(words.insecure)}</p>\n`;
  const drawn = downloadMessages(download, words);
  // A refused passkey post's line goes above the passkey button, where the script draws its own.
  const fromPasskey = withPasskey && download?.passkey === true;
  const shown = fromPasskey ? { askCode: false } : drawn;
  const passkeyLine = fromPasskey ? drawn.message : undefined;
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
  const passkeyForm = withPasskey
    ? `<form method="post" action="/old-box-data" class="box-form" id="old-box-data-passkey-form">
<input type="hidden" name="passkey">
${passkeyLine === undefined ? "" : `<p id="old-box-data-passkey-message" role="alert">${escapeHtml(passkeyLine)}</p>\n`}<p><button type="button" class="secondary" id="old-box-data-passkey" data-failed="${escapeHtml(words.passkeyCancelled)}" hidden>${escapeHtml(words.passkeyAction)}</button></p>
</form>
<script>${PASSKEY_SCRIPT}</script>
`
    : "";
  return `${heading}${intro}<form method="post" action="/old-box-data" class="box-form">
${returnTo === undefined ? "" : `<input type="hidden" name="returnTo" value="${escapeHtml(returnTo)}">\n`}<p><label for="old-box-data-email">${escapeHtml(words.email)} <span class="required">*</span></label></p>
<p>${emailInput("old-box-data-email", download?.email ?? "", invalid("email"))}</p>
${error("email")}<p><label for="old-box-data-password">${escapeHtml(words.password)} <span class="required">*</span></label></p>
<p>${passwordInput(invalid("password"), "old-box-data-password")}</p>
${error("password")}${code}${bottom}<p><button type="submit">${escapeHtml(words.action)}</button></p>
</form>
${passkeyForm}`;
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
/** The download route's settings on the restricted page, whose refusals answer this page again. */
export function restrictedDownloadDeps(
  page: RestrictedPageDeps,
): Pick<OldBoxDataDeps, "venue" | "log" | "resetOrdered" | "answer" | "planned"> {
  return {
    venue: page.venue,
    log: page.log,
    resetOrdered: page.resetOrdered,
    answer: (c, status, state) => restrictedPageAnswer(page, c, status, state),
    planned: () => readPlannedHandover(page),
  };
}

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
    const view = await readView(deps, c.get("requestId"), download);
    const secure = isSecure(c);
    const passkey = drawsDownloadForm(view, secure);
    return boxPageAnswer(c, renderRestrictedPage(view, locale, secure), status, "no-store", {
      inline: passkey ? [PASSKEY_SCRIPT] : [],
      connectSelf: passkey,
      formSelf: true,
    });
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

import type { KeyRing } from "@waitron/credentials";
import "./errors.js";
import type { Context, Hono } from "hono";
import {
  AppError,
  FALLBACK_LOCALE,
  hasCode,
  isAppError,
  type SupportedLocale,
} from "@waitron/shared";
import {
  withNodeTransaction,
  withTransaction,
  type Database,
  type NodeDatabase,
} from "@waitron/db";
import {
  authorizeManager,
  checkManagerPassword,
  endManagementSession,
  foldedLoginEmail,
  loginManager,
  withInspectorAdmitted,
} from "@waitron/identity";
import { appendHandoverEventTx } from "@waitron/node-db";
import { WAITING_PAGE_WORDS, type CarryOnWords } from "./i18n/waiting-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { NewerBucketMain } from "./stream-host.js";
import type { Logger } from "./logger.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";
import { isSecure } from "./encrypted-connection.js";
import { escapeHtml } from "./html-page.js";
import { renderLogoBoxPage } from "./guide-pages.js";
import { readSuccessor, successorText } from "./restricted-page.js";
import { knownHandoverSuccessor, type StartPeerCheckOutcome } from "./start-peer-check.js";
import {
  failureFields,
  otherBoxPhrase,
  renderWaitingPage,
  pageReturnPath,
  type WaitingPageSection,
} from "./waiting-page.js";

/**
 * What a carry-on finds once any re-ask in flight has settled. A peer's answer wins over the
 * person's statement (Ruling R16): it is signed evidence, and a known handover cannot be undone.
 */
export type CarryOnTurn =
  /** A re-ask answered other than `wait`: the start goes on with that answer. */
  | { kind: "answered"; outcome: StartPeerCheckOutcome }
  /** An earlier carry-on already ended the wait. */
  | { kind: "carried-on" }
  /** The box is stepping down or shutting down. */
  | { kind: "stopped" }
  | {
      kind: "go";
      /**
       * Inside the transaction that records the decision: whether the box still waits. A stepdown
       * or shutdown that began before it refuses the record; one that begins after it wins over
       * `finish`.
       */
      claim: () => Promise<boolean>;
      /**
       * Ends the wait as carried on unless a stepdown or shutdown began after `claim`; says whether
       * it did.
       * The decision is recorded either way.
       */
      finish: () => boolean;
      /** Gives the turn up without ending the wait. */
      abandon: () => void;
    };

export interface CarryOnDeps {
  db: Database;
  node: NodeDatabase;
  nodeId: string;
  /** Unlocks a stored authenticator secret, so a person who has one can sign in. */
  credentialKeyRing: KeyRing;
  /** Whether a request reached the box over HTTPS from this page; tests replace it. */
  secure?: (c: Context) => boolean;
  /** The boxes the latest check waited on. */
  peerNodeIds: () => readonly string[];
  addressesOf: (ids: readonly string[]) => Promise<readonly (string | null)[]>;
  chartTerm: () => Promise<number>;
  /** Takes the one carry-on turn, after any re-ask in flight has settled. */
  beginCarryOn: () => Promise<CarryOnTurn>;
  readNewerMain?: () => Promise<NewerBucketMain | null>;
  /** Shared with any other password form on the page, so one email gets one set of attempts. */
  throttle?: PasswordThrottle;
  log: Logger;
}

type Field = "email" | "password" | "totp" | "switchedOff" | "noOtherRecovery";

interface FormView {
  email: string;
  switchedOff: boolean;
  noOtherRecovery: boolean;
  /** Whether the form asks for the authenticator or a recovery code. */
  askCode: boolean;
  errors: Partial<Record<Field, string>>;
  /** The bottom message: the form's generic sentence, or a refusal that marks no field. */
  message?: string;
}

const BLANK: FormView = {
  email: "",
  switchedOff: false,
  noOtherRecovery: false,
  askCode: false,
  errors: {},
};

class NoLongerWaiting extends Error {}

/** `successor` is HTML, from `successorText`. */
function knownBody(
  successor: string,
  words: CarryOnWords,
  back: boolean,
  destination = "/",
): string {
  const link = back
    ? `<p><a href="${escapeHtml(destination)}">${escapeHtml(words.back)}</a></p>\n`
    : "";
  return `<p role="alert">${escapeHtml(words.knownHandover[0])}${successor}${escapeHtml(words.knownHandover[1])}</p>
${link}`;
}

/** A sign-in form's email field, holding `value`; `invalid` is its error attributes or "". */
export function emailInput(id: string, value: string, invalid: string): string {
  return `<input type="email" id="${escapeHtml(id)}" name="email" autocomplete="username" required value="${escapeHtml(value)}"${invalid}>`;
}

/** A sign-in form's authenticator code field; `invalid` is its error attributes or "". */
export function codeInput(id: string, invalid: string, required = false): string {
  return `<input type="text" id="${escapeHtml(id)}" name="totp" inputmode="numeric" autocomplete="one-time-code"${required ? " required" : ""}${invalid}>`;
}

function formSection(
  view: FormView,
  other: string,
  words: CarryOnWords,
  destination: string,
): string {
  const error = (field: Field) =>
    view.errors[field] === undefined
      ? ""
      : `<p id="carry-on-${field}-error">${escapeHtml(view.errors[field])}</p>\n`;
  const invalid = (field: Field) =>
    view.errors[field] === undefined
      ? ""
      : ` aria-invalid="true" aria-describedby="carry-on-${field}-error"`;
  const checked = (on: boolean) => (on ? " checked" : "");
  const code = view.askCode
    ? `<p><label for="carry-on-totp">${escapeHtml(words.totp)} <span class="required">*</span></label></p>
<p>${codeInput("carry-on-totp", invalid("totp"))}</p>
<p><label for="carry-on-recovery-code">${escapeHtml(words.recoveryCode)}</label></p>
<p><input type="text" id="carry-on-recovery-code" name="recoveryCode" autocomplete="off"${invalid("totp")}></p>
${error("totp")}`
    : "";
  const bottom =
    view.message === undefined
      ? ""
      : `<p id="carry-on-message" role="alert">${escapeHtml(view.message)}</p>\n`;
  // The password is never drawn back, so every drawn form starts with a required field empty.
  return `<h2>${escapeHtml(words.heading)}</h2>
<p>${escapeHtml(words.intro[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(words.intro[1])}</p>
<form method="post" action="/carry-on" id="carry-on" class="box-form">
<input type="hidden" name="returnTo" value="${escapeHtml(destination)}">
<p><label for="carry-on-email">${escapeHtml(words.email)} <span class="required">*</span></label></p>
<p>${emailInput("carry-on-email", view.email, invalid("email"))}</p>
${error("email")}<p><label for="carry-on-password">${escapeHtml(words.password)} <span class="required">*</span></label></p>
<p><input type="password" id="carry-on-password" name="password" autocomplete="current-password" required${invalid("password")}></p>
${error("password")}${code}<p><label><input type="checkbox" id="carry-on-switched-off" name="switchedOff" value="yes" required${checked(view.switchedOff)}${invalid("switchedOff")}> ${escapeHtml(words.switchedOff[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(words.switchedOff[1])} <span class="required">*</span></label></p>
${error("switchedOff")}<p><label><input type="checkbox" id="carry-on-no-other-recovery" name="noOtherRecovery" value="yes" required${checked(view.noOtherRecovery)}${invalid("noOtherRecovery")}> ${escapeHtml(words.noOtherRecovery)} <span class="required">*</span></label></p>
${error("noOtherRecovery")}${bottom}<p><button type="submit" disabled>${escapeHtml(words.action)}</button></p>
</form>
<script>
(() => {
  const form = document.getElementById("carry-on");
  const required = [...form.querySelectorAll("[required]")];
  const codes = [form.elements.totp, form.elements.recoveryCode].filter(Boolean);
  const filled = (field) => (field.type === "checkbox" ? field.checked : field.value.trim() !== "");
  const update = () =>
    (form.querySelector("button").disabled = !(
      required.every(filled) &&
      (codes.length === 0 || codes.some(filled))
    ));
  form.addEventListener("input", update);
  form.addEventListener("change", update);
  update();
})();
</script>
`;
}

function postedSecurely(c: Context): boolean {
  try {
    requireNodeOperationHttps(c);
    return true;
  } catch {
    return false;
  }
}

const refresh = (destination: string) =>
  `<meta http-equiv="refresh" content="5; url=${escapeHtml(destination)}">\n`;

const flowPage = (locale: SupportedLocale, title: string, body: string, head = "") =>
  renderLogoBoxPage(locale, title, `<h1>${escapeHtml(title)}</h1>\n${body}`, "", head);

/**
 * The waiting page's "Carry on as the main box": a person with `node.manage` who states that the
 * other box is switched off and that no other recovery is in progress ends the wait, for this start
 * only. Mounts its POST route and returns what the page draws below its body.
 */
export function mountCarryOn(app: Hono, deps: CarryOnDeps): WaitingPageSection {
  const passwordThrottle = deps.throttle ?? createPasswordThrottle();
  const successorName = async (id: string | null, locale: SupportedLocale) =>
    id === null
      ? `<strong>${escapeHtml(otherBoxPhrase([null], locale))}</strong>`
      : successorText(
          await readSuccessor({ venue: deps.db, node: deps.node, nodeId: deps.nodeId }, id),
          locale,
        );

  app.post("/carry-on", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const other = otherBoxPhrase(
      await deps.addressesOf(deps.peerNodeIds()).catch(() => []),
      locale,
    );
    let destination = "/";
    const page = (section: string, status: 200 | 400 | 401 | 403 | 409 | 429 | 500) =>
      c.html(renderWaitingPage(other, locale, section, destination), status);
    const known = async (successor: string | null) =>
      c.html(
        flowPage(
          locale,
          words.knownTitle,
          knownBody(await successorName(successor, locale), words, true, destination),
        ),
        409,
      );
    const restarting = () =>
      c.html(
        flowPage(locale, words.restartingTitle, `<p>${escapeHtml(words.restarting)}</p>\n`),
        409,
      );
    const carriedOn = () => {
      c.header("Connection", "close");
      return c.html(
        flowPage(
          locale,
          words.carriedOnTitle,
          `<p>${escapeHtml(words.carriedOnBody)}</p>\n`,
          refresh(destination),
        ),
        200,
      );
    };

    const failed = (error: unknown, shown: FormView = BLANK) => {
      deps.log("warn", "waiting_start.carry_on_failed", failureFields(error));
      return page(formSection({ ...shown, message: words.failed }, other, words, destination), 500);
    };

    let form: Awaited<ReturnType<typeof c.req.parseBody>>;
    try {
      form = await c.req.parseBody();
    } catch (error) {
      return failed(error);
    }
    const text = (key: string) => (typeof form[key] === "string" ? form[key] : "");
    destination = pageReturnPath(text("returnTo"));

    let knownBefore: string | null;
    try {
      knownBefore = await knownHandoverSuccessor(deps.node, deps.nodeId);
    } catch (error) {
      return failed(error);
    }
    if (knownBefore !== null) return known(knownBefore);
    if (!(deps.secure ?? postedSecurely)(c))
      return page(`<p role="alert">${escapeHtml(words.insecure)}</p>\n`, 403);

    const view: FormView = {
      ...BLANK,
      email: text("email").trim(),
      switchedOff: form.switchedOff === "yes",
      noOtherRecovery: form.noOtherRecovery === "yes",
      askCode: "totp" in form || "recoveryCode" in form,
      errors: {},
    };
    const password = text("password");
    const totp = text("totp").trim();
    const recoveryCode = text("recoveryCode").trim();
    if (view.email === "") view.errors.email = words.emailMissing;
    if (password === "") view.errors.password = words.passwordMissing;
    if (view.askCode && totp === "" && recoveryCode === "") view.errors.totp = words.totpMissing;
    if (!view.switchedOff) view.errors.switchedOff = words.statementMissing;
    if (!view.noOtherRecovery) view.errors.noOtherRecovery = words.statementMissing;
    if (Object.keys(view.errors).length > 0)
      return page(
        formSection({ ...view, message: words.fixFields }, other, words, destination),
        400,
      );

    const refused = (message: string, status: 401 | 403 | 429, askCode = view.askCode) =>
      page(formSection({ ...view, askCode, message }, other, words, destination), status);

    let personId: string;
    try {
      const finishAttempt = passwordThrottle.begin(foldedLoginEmail(view.email));
      try {
        const checked = await checkManagerPassword(deps.db, { email: view.email }, password);
        personId = await withTransaction(deps.db, async (tx) => {
          const session = await loginManager(tx, {
            email: view.email,
            password,
            ...(totp === "" ? {} : { totp }),
            ...(recoveryCode === "" ? {} : { recoveryCode }),
            totpKeyRing: deps.credentialKeyRing,
            checked,
          });
          const { authorizedBy } = await withInspectorAdmitted(() =>
            authorizeManager(tx, { managementSessionId: session.token, permission: "node.manage" }),
          );
          await endManagementSession(tx, session.token, "operation_finished");
          return authorizedBy;
        });
      } catch (error) {
        finishAttempt(isAppError(error) && error.code === "password.invalid" ? "invalid" : "error");
        throw error;
      }
      finishAttempt("success");
    } catch (error) {
      if (!isAppError(error)) return failed(error, view);
      if (hasCode(error, "totp.required")) return refused(words.totpRequired, 401, true);
      if (hasCode(error, "password.invalid")) return refused(words.signInRefused, 401);
      if (hasCode(error, "authorization.not_permitted")) return refused(words.notPermitted, 403);
      if (hasCode(error, "password.throttled"))
        return refused(words.throttled(Math.ceil(error.params.retryAfterSeconds / 60)), 429);
      return failed(error, view);
    }

    const turn = await deps.beginCarryOn();
    switch (turn.kind) {
      case "stopped":
        return restarting();
      case "carried-on":
        return carriedOn();
      case "answered":
        if (turn.outcome.result === "superseded") return known(turn.outcome.successorNodeId);
        return c.html(
          flowPage(
            locale,
            words.peerAnsweredTitle,
            `<p>${escapeHtml(words.peerAnswered)}</p>\n`,
            refresh(destination),
          ),
          200,
        );
    }
    try {
      const newer = await deps.readNewerMain?.();
      if (newer != null) {
        turn.abandon();
        return page(
          `<p role="alert">${escapeHtml(words.bucketMain)}</p>\n${newer.contactUrl === "" ? "" : `<p><a href="${escapeHtml(newer.contactUrl)}">${escapeHtml(words.openMain)}</a></p>\n`}`,
          409,
        );
      }
      await withNodeTransaction(deps.node, async (tx) => {
        // A stepdown may have recorded a handover since the check above; it wins.
        const since = await knownHandoverSuccessor(tx, deps.nodeId);
        if (since !== null)
          throw new AppError("handover.known_handover", { successorNodeId: since });
        if (!(await turn.claim())) throw new NoLongerWaiting();
        await appendHandoverEventTx(tx, {
          nodeId: deps.nodeId,
          operationId: null,
          kind: "carried_on_without_peer",
          detail: {
            personId,
            peerNodeIds: [...deps.peerNodeIds()],
            chartTerm: await deps.chartTerm(),
          },
        });
      });
    } catch (error) {
      turn.abandon();
      if (isAppError(error) && hasCode(error, "handover.known_handover"))
        return known(error.params.successorNodeId);
      if (error instanceof NoLongerWaiting) return restarting();
      return failed(error, view);
    }
    if (!turn.finish())
      return c.html(
        flowPage(
          locale,
          words.restartingTitle,
          `<p>${escapeHtml(words.restartingAfterRecord)}</p>\n`,
        ),
        409,
      );
    deps.log("info", "waiting_start.carried_on", { peerNodeIds: deps.peerNodeIds() });
    return carriedOn();
  });

  return async (c, other, locale, destination) => {
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    const successor = await knownHandoverSuccessor(deps.node, deps.nodeId);
    if (successor !== null)
      return {
        page: flowPage(
          locale,
          words.knownTitle,
          knownBody(await successorName(successor, locale), words, false),
        ),
      };
    if (!(deps.secure ?? isSecure)(c)) return `<p>${escapeHtml(words.insecure)}</p>\n`;
    return formSection(BLANK, other, words, destination);
  };
}

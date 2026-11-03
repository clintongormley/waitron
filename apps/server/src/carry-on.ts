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
  loginManager,
  type TotpKeyRing,
} from "@waitron/identity";
import { appendHandoverEventTx } from "@waitron/node-db";
import { codeOf } from "@waitron/server-kit";
import { WAITING_PAGE_WORDS, type CarryOnWords } from "./i18n/waiting-page.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { requireNodeOperationHttps } from "./node-operation-https.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { isSecure } from "./recovery-start-again.js";
import { escapeHtml } from "./recovery-surface.js";
import { knownHandoverSuccessor, type StartPeerCheckOutcome } from "./start-peer-check.js";
import {
  otherBoxPhrase,
  renderDocument,
  renderWaitingPage,
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
       * that began before it refuses the record; one that begins after it wins over `finish`.
       */
      claim: () => Promise<boolean>;
      /**
       * Ends the wait as carried on unless a stepdown began after `claim`; says whether it did.
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
  credentialKeyRing: TotpKeyRing;
  /** Whether a request reached the box over HTTPS from this page; tests replace it. */
  secure?: (c: Context) => boolean;
  /** The boxes the latest check waited on. */
  peerNodeIds: () => readonly string[];
  namesOf: (ids: readonly string[]) => Promise<readonly (string | null)[]>;
  chartTerm: () => Promise<number>;
  /** Takes the one carry-on turn, after any re-ask in flight has settled. */
  beginCarryOn: () => Promise<CarryOnTurn>;
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

function knownBody(successor: string, words: CarryOnWords, back: boolean): string {
  const link = back ? `<p><a href="/">${escapeHtml(words.back)}</a></p>\n` : "";
  return `<p role="alert">${escapeHtml(words.knownHandover[0])}<strong>${escapeHtml(successor)}</strong>${escapeHtml(words.knownHandover[1])}</p>
${link}`;
}

function formSection(view: FormView, other: string, words: CarryOnWords): string {
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
    ? `<p><label for="carry-on-totp">${escapeHtml(words.totp)} *</label></p>
<p><input type="text" id="carry-on-totp" name="totp" inputmode="numeric" autocomplete="one-time-code"${invalid("totp")}></p>
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
<form method="post" action="/carry-on" id="carry-on">
<p><label for="carry-on-email">${escapeHtml(words.email)} *</label></p>
<p><input type="email" id="carry-on-email" name="email" autocomplete="username" required value="${escapeHtml(view.email)}"${invalid("email")}></p>
${error("email")}<p><label for="carry-on-password">${escapeHtml(words.password)} *</label></p>
<p><input type="password" id="carry-on-password" name="password" autocomplete="current-password" required${invalid("password")}></p>
${error("password")}${code}<p><label><input type="checkbox" id="carry-on-switched-off" name="switchedOff" value="yes" required${checked(view.switchedOff)}${invalid("switchedOff")}> ${escapeHtml(words.switchedOff[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(words.switchedOff[1])} *</label></p>
${error("switchedOff")}<p><label><input type="checkbox" id="carry-on-no-other-recovery" name="noOtherRecovery" value="yes" required${checked(view.noOtherRecovery)}${invalid("noOtherRecovery")}> ${escapeHtml(words.noOtherRecovery)} *</label></p>
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

const REFRESH = '<meta http-equiv="refresh" content="5; url=/">\n';

/**
 * The waiting page's "Carry on as the main box": a person with `node.promote` who states that the
 * other box is switched off and that no other recovery is in progress ends the wait, for this start
 * only. Mounts its POST route and returns what the page draws below its body.
 */
export function mountCarryOn(app: Hono, deps: CarryOnDeps): WaitingPageSection {
  const passwordThrottle = createPasswordThrottle();
  const successorName = async (id: string | null, locale: SupportedLocale) =>
    otherBoxPhrase(id === null ? [null] : await deps.namesOf([id]), locale);

  app.post("/carry-on", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const other = otherBoxPhrase(await deps.namesOf(deps.peerNodeIds()).catch(() => []), locale);
    const page = (section: string, status: 200 | 400 | 401 | 403 | 409 | 429 | 500) =>
      c.html(renderWaitingPage(other, locale, section), status);
    const known = async (successor: string | null) =>
      c.html(
        renderDocument(
          locale,
          words.knownTitle,
          knownBody(await successorName(successor, locale), words, true),
        ),
        409,
      );
    const restarting = () =>
      c.html(
        renderDocument(locale, words.restartingTitle, `<p>${escapeHtml(words.restarting)}</p>\n`),
        409,
      );
    const carriedOn = () => {
      c.header("Connection", "close");
      return c.html(
        renderDocument(
          locale,
          words.carriedOnTitle,
          `<p>${escapeHtml(words.carriedOnBody)}</p>\n`,
          REFRESH,
        ),
        200,
      );
    };

    const knownBefore = await knownHandoverSuccessor(deps.node, deps.nodeId);
    if (knownBefore !== null) return known(knownBefore);
    if (!(deps.secure ?? postedSecurely)(c))
      return page(`<p role="alert">${escapeHtml(words.insecure)}</p>\n`, 403);

    const form = await c.req.parseBody();
    const text = (key: string) => (typeof form[key] === "string" ? form[key] : "");
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
      return page(formSection({ ...view, message: words.fixFields }, other, words), 400);

    const refused = (message: string, status: 401 | 403 | 429 | 500, askCode = view.askCode) =>
      page(formSection({ ...view, askCode, message }, other, words), status);
    const failed = (error: unknown) => {
      deps.log("warn", "waiting_start.carry_on_failed", { errorCode: codeOf(error) });
      return refused(words.failed, 500);
    };

    let personId: string;
    try {
      const finishAttempt = passwordThrottle.begin(view.email);
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
          const { authorizedBy } = await authorizeManager(tx, {
            managementSessionId: session.token,
            permission: "node.promote",
          });
          await endManagementSession(tx, session.token);
          return authorizedBy;
        });
      } catch (error) {
        finishAttempt(isAppError(error) && error.code === "password.invalid" ? "invalid" : "error");
        throw error;
      }
      finishAttempt("success");
    } catch (error) {
      if (!isAppError(error)) return failed(error);
      if (hasCode(error, "totp.required")) return refused(words.totpRequired, 401, true);
      if (hasCode(error, "password.invalid")) return refused(words.signInRefused, 401);
      if (hasCode(error, "authorization.not_permitted")) return refused(words.notPermitted, 403);
      if (hasCode(error, "password.throttled"))
        return refused(words.throttled(Math.ceil(error.params.retryAfterSeconds / 60)), 429);
      return failed(error);
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
          renderDocument(
            locale,
            words.peerAnsweredTitle,
            `<p>${escapeHtml(words.peerAnswered)}</p>\n`,
            REFRESH,
          ),
          200,
        );
    }
    try {
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
      return failed(error);
    }
    if (!turn.finish())
      return c.html(
        renderDocument(
          locale,
          words.restartingTitle,
          `<p>${escapeHtml(words.restartingAfterRecord)}</p>\n`,
        ),
        409,
      );
    deps.log("info", "waiting_start.carried_on", { peerNodeIds: deps.peerNodeIds() });
    return carriedOn();
  });

  return async (c, other, locale) => {
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    const successor = await knownHandoverSuccessor(deps.node, deps.nodeId);
    if (successor !== null)
      return {
        page: renderDocument(
          locale,
          words.knownTitle,
          knownBody(await successorName(successor, locale), words, false),
        ),
      };
    if (!(deps.secure ?? isSecure)(c)) return `<p>${escapeHtml(words.insecure)}</p>\n`;
    return formSection(BLANK, other, words);
  };
}

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
import { knownHandoverSuccessor } from "./start-peer-check.js";
import {
  otherBoxPhrase,
  renderDocument,
  renderWaitingPage,
  type WaitingPageSection,
} from "./waiting-page.js";

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
  /** Ends the wait; called once the answer has been sent. */
  carryOn: () => Promise<void>;
  log: Logger;
}

type Field = "email" | "password" | "totp" | "switchedOff" | "noOtherRecovery";

interface FormView {
  email: string;
  switchedOff: boolean;
  noOtherRecovery: boolean;
  askTotp: boolean;
  errors: Partial<Record<Field, string>>;
  /** The bottom message: the form's generic sentence, or a refusal that marks no field. */
  message?: string;
}

const BLANK: FormView = {
  email: "",
  switchedOff: false,
  noOtherRecovery: false,
  askTotp: false,
  errors: {},
};

function knownSection(successor: string, words: CarryOnWords, back: boolean): string {
  const link = back ? `<p><a href="/">${escapeHtml(words.back)}</a></p>\n` : "";
  return `<h2>${escapeHtml(words.heading)}</h2>
<p role="alert">${escapeHtml(words.knownHandover[0])}<strong>${escapeHtml(successor)}</strong>${escapeHtml(words.knownHandover[1])}</p>
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
  const totp = view.askTotp
    ? `<p><label for="carry-on-totp">${escapeHtml(words.totp)} *</label></p>
<p><input type="text" id="carry-on-totp" name="totp" inputmode="numeric" autocomplete="one-time-code" required${invalid("totp")}></p>
${error("totp")}`
    : "";
  const bottom =
    view.message === undefined
      ? ""
      : `<p id="carry-on-message" role="alert">${escapeHtml(view.message)}</p>\n`;
  const ready = view.switchedOff && view.noOtherRecovery;
  return `<h2>${escapeHtml(words.heading)}</h2>
<p>${escapeHtml(words.intro[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(words.intro[1])}</p>
<form method="post" action="/carry-on" id="carry-on">
<p><label for="carry-on-email">${escapeHtml(words.email)} *</label></p>
<p><input type="email" id="carry-on-email" name="email" autocomplete="username" required value="${escapeHtml(view.email)}"${invalid("email")}></p>
${error("email")}<p><label for="carry-on-password">${escapeHtml(words.password)} *</label></p>
<p><input type="password" id="carry-on-password" name="password" autocomplete="current-password" required${invalid("password")}></p>
${error("password")}${totp}<p><label><input type="checkbox" id="carry-on-switched-off" name="switchedOff" value="yes" required${checked(view.switchedOff)}${invalid("switchedOff")}> ${escapeHtml(words.switchedOff[0])}<strong>${escapeHtml(other)}</strong>${escapeHtml(words.switchedOff[1])} *</label></p>
${error("switchedOff")}<p><label><input type="checkbox" id="carry-on-no-other-recovery" name="noOtherRecovery" value="yes" required${checked(view.noOtherRecovery)}${invalid("noOtherRecovery")}> ${escapeHtml(words.noOtherRecovery)} *</label></p>
${error("noOtherRecovery")}${bottom}<p><button type="submit"${ready ? "" : " disabled"}>${escapeHtml(words.action)}</button></p>
</form>
<script>
(() => {
  const form = document.getElementById("carry-on");
  const statements = [form.elements.switchedOff, form.elements.noOtherRecovery];
  const update = () => (form.querySelector("button").disabled = !statements.every((s) => s.checked));
  for (const statement of statements) statement.addEventListener("change", update);
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

/**
 * The waiting page's "Carry on as the main box": a person with `node.promote` who states that the
 * other box is switched off and that no other recovery is in progress ends the wait, for this start
 * only. Mounts its POST route and returns what the page draws below its body.
 */
export function mountCarryOn(app: Hono, deps: CarryOnDeps): WaitingPageSection {
  const passwordThrottle = createPasswordThrottle();
  const successorName = async (id: string, locale: SupportedLocale) =>
    otherBoxPhrase(await deps.namesOf([id]), locale);

  app.post("/carry-on", async (c) => {
    const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    c.header("Cache-Control", "no-store");
    c.header("Vary", "Accept-Language");
    const other = otherBoxPhrase(await deps.namesOf(deps.peerNodeIds()).catch(() => []), locale);
    const page = (section: string, status: 200 | 400 | 401 | 403 | 409 | 429 | 500) =>
      c.html(renderWaitingPage(other, locale, section), status);

    const known = await knownHandoverSuccessor(deps.node, deps.nodeId);
    if (known !== null)
      return page(knownSection(await successorName(known, locale), words, true), 409);
    if (!(deps.secure ?? postedSecurely)(c))
      return page(`<p role="alert">${escapeHtml(words.insecure)}</p>\n`, 403);

    const form = await c.req.parseBody();
    const text = (key: string) => (typeof form[key] === "string" ? form[key] : "");
    const view: FormView = {
      ...BLANK,
      email: text("email").trim(),
      switchedOff: form.switchedOff === "yes",
      noOtherRecovery: form.noOtherRecovery === "yes",
      askTotp: "totp" in form,
      errors: {},
    };
    const password = text("password");
    const totp = text("totp").trim();
    if (view.email === "") view.errors.email = words.emailMissing;
    if (password === "") view.errors.password = words.passwordMissing;
    if (view.askTotp && totp === "") view.errors.totp = words.totpMissing;
    if (!view.switchedOff) view.errors.switchedOff = words.statementMissing;
    if (!view.noOtherRecovery) view.errors.noOtherRecovery = words.statementMissing;
    if (Object.keys(view.errors).length > 0)
      return page(formSection({ ...view, message: words.fixFields }, other, words), 400);

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
      await withNodeTransaction(deps.node, async (tx) => {
        // A stepdown may have recorded a handover since the check above; it wins.
        const since = await knownHandoverSuccessor(tx, deps.nodeId);
        if (since !== null)
          throw new AppError("handover.known_handover", { successorNodeId: since });
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
      const refused = (message: string, status: 401 | 403 | 429 | 500, askTotp = view.askTotp) =>
        page(formSection({ ...view, askTotp, message }, other, words), status);
      if (!isAppError(error)) {
        deps.log("warn", "waiting_start.carry_on_failed", { errorCode: codeOf(error) });
        return refused(words.failed, 500);
      }
      if (hasCode(error, "handover.known_handover"))
        return page(
          knownSection(await successorName(error.params.successorNodeId, locale), words, true),
          409,
        );
      if (hasCode(error, "totp.required")) return refused(words.totpRequired, 401, true);
      if (hasCode(error, "password.invalid")) return refused(words.signInRefused, 401);
      if (hasCode(error, "authorization.not_permitted")) return refused(words.notPermitted, 403);
      if (hasCode(error, "password.throttled"))
        return refused(words.throttled(Math.ceil(error.params.retryAfterSeconds / 60)), 429);
      deps.log("warn", "waiting_start.carry_on_failed", { errorCode: codeOf(error) });
      return refused(words.failed, 500);
    }

    deps.log("info", "waiting_start.carried_on", { peerNodeIds: deps.peerNodeIds() });
    // After the answer: ending the wait closes the listener this answer is sent on.
    setImmediate(() => void deps.carryOn());
    c.header("Connection", "close");
    return c.html(
      renderDocument(
        locale,
        words.carriedOnTitle,
        `<p>${escapeHtml(words.carriedOnBody)}</p>\n`,
        '<meta http-equiv="refresh" content="5; url=/">\n',
      ),
      200,
    );
  });

  return async (c, other, locale) => {
    const words = WAITING_PAGE_WORDS[locale].carryOn;
    const known = await knownHandoverSuccessor(deps.node, deps.nodeId);
    if (known !== null) return knownSection(await successorName(known, locale), words, false);
    if (!(deps.secure ?? isSecure)(c)) return `<p>${escapeHtml(words.insecure)}</p>\n`;
    return formSection(BLANK, other, words);
  };
}

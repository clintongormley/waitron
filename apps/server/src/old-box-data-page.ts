import type { Context, Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import { liveBackupQuery, type Database } from "@waitron/db";
import {
  checkPasswordInCopy,
  foldedLoginEmail,
  holdsInCopy,
  verifyPasskeyAssertion,
} from "@waitron/identity";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { AppError, FALLBACK_LOCALE, hasCode, isAppError } from "@waitron/shared";
import { ownContactUrl } from "./box-name.js";
import { isSecure } from "./encrypted-connection.js";
import { challengeOf, createSwitchChallenges } from "./handover-switch-proof.js";
import { resolveLoginLocale } from "./login-locale.js";
import type { Logger } from "./logger.js";
import { sinceRule, type SinceRule } from "./old-box-data-since.js";
import { makeOldBoxWorkbook, type OldBoxWorkbook } from "./old-box-data-workbook.js";
import type { HeardCopy, HeardHoldings } from "./old-box-holdings.js";
import { sentFromThisOrigin } from "./own-page.js";
import { formBody } from "./recovery-start-again.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";
import type { OldBoxDownloadRefusal, OldBoxDownloadState } from "./restricted-page.js";
import { workbookDownloadHeaders } from "./xlsx-workbook.js";

export interface OldBoxDataDeps {
  /** Only read. */
  venue: Database;
  log: Logger;
  /** Whether this box has saved a reset the main box ordered, so it restarts shortly. */
  resetOrdered?: () => boolean;
  /** The page this route answers again on a refusal, its download section showing `state`. */
  answer: (
    c: Context,
    status: RefusalStatus,
    state: OldBoxDownloadState,
  ) => Response | Promise<Response>;
  /** Whether a request reached the box over HTTPS; tests replace it. */
  secure?: (c: Context) => boolean;
  modules: readonly WaitronModule[];
  totpKeyRing: KeyRing;
  /** Offers the passkey sign-in; without it the route has no passkey path. */
  passkey?: {
    /** The venue's passkey name, which a passkey made on the dashboard is bound to. */
    rpId: string;
    /** The dashboard's origin; a passkey answer may come from there or from this box's own name. */
    managementOrigin: string;
    nodeId: string;
  };
  throttle?: PasswordThrottle;
  /** The main box's summary the reset-order duty last heard. */
  mainHoldings?: () => HeardHoldings | null;
  /** The copy time the reset-order duty last heard; it sets where the "since" tabs start. */
  mainCopy?: () => HeardCopy | null;
  /** Whether this box handed over in a planned handover, which leaves out the "since" tabs. */
  planned: () => Promise<boolean>;
}

/**
 * A passkey answer with WebAuthn's longest passkey id (1,023 bytes), a 4096-bit RS256 signature, a
 * user handle and a 253-character host name encodes to 4,317 bytes (the "judges an answer over
 * 4 KiB" test); this leaves room for more.
 */
const MAX_FORM_BYTES = 16 * 1024;

type RefusalStatus = 400 | 401 | 403 | 409 | 429 | 500;

/** The page's answer to a sign-in refusal; undefined for a code that is a fault, not a refusal. */
function signInRefusal(
  error: AppError,
):
  | { status: RefusalStatus; refusal: OldBoxDownloadRefusal; retryAfterSeconds?: number }
  | undefined {
  if (hasCode(error, "password.throttled"))
    return {
      status: 429,
      refusal: "throttled",
      retryAfterSeconds: error.params.retryAfterSeconds,
    };
  if (hasCode(error, "totp.required")) return { status: 401, refusal: "totpRequired" };
  if (hasCode(error, "password.invalid")) return { status: 401, refusal: "signInRefused" };
  if (hasCode(error, "passkey.not_registered") || hasCode(error, "passkey.verification_failed"))
    return { status: 401, refusal: "passkeyRefused" };
  if (hasCode(error, "passkey.challenge_expired"))
    return { status: 401, refusal: "passkeyExpired" };
  if (hasCode(error, "authorization.not_permitted"))
    return { status: 403, refusal: "notPermitted" };
  return undefined;
}

/**
 * This box's data download, on its restricted or waiting page: a person holding `node.manage` signs
 * in and gets a workbook of its invoice records, those the main box lacks when `mainHoldings` has
 * heard the main box's summary, otherwise every one it holds, and, unless `planned`, the "since"
 * tabs. Nothing here writes to the venue
 * database: the sign-in and the workbook only read it, and the attempt limit and the one-at-a-time
 * turn are kept in memory.
 */
export function oldBoxDataRoute(deps: OldBoxDataDeps): (app: Hono) => void {
  const throttle = deps.throttle ?? createPasswordThrottle();
  const challenges = createSwitchChallenges();
  // Not the other boxes' names `venuePasskeyOrigins` adds: the answer is posted from this page,
  // and `sentFromThisOrigin` refuses a browser's post from another box's.
  const offered = deps.passkey;
  const origins =
    offered === undefined
      ? []
      : [
          ...new Set([
            offered.managementOrigin,
            ownContactUrl(offered.managementOrigin, offered.nodeId),
          ]),
        ];
  const { log } = deps;
  let making = false;

  const checkPasswordSignIn = async (
    email: string,
    password: string,
    totp: string,
  ): Promise<string> => {
    const finishAttempt = throttle.begin(foldedLoginEmail(email));
    let outcome: "success" | "invalid" | "error" = "error";
    try {
      const { personId } = await checkPasswordInCopy(
        liveBackupQuery(deps.venue),
        { email, password, ...(totp === "" ? {} : { totp }) },
        { permission: "node.manage", totpKeyRing: deps.totpKeyRing },
      );
      outcome = "success";
      return personId;
    } catch (error) {
      if (isAppError(error) && hasCode(error, "password.invalid")) outcome = "invalid";
      throw error;
    } finally {
      finishAttempt(outcome);
    }
  };

  const checkPasskeySignIn = async (rpId: string, text: string): Promise<string> => {
    let response: AuthenticationResponseJSON;
    try {
      response = JSON.parse(text) as AuthenticationResponseJSON;
    } catch {
      throw new AppError("passkey.verification_failed", {});
    }
    const challenge = challengeOf(response);
    if (challenge === undefined) throw new AppError("passkey.verification_failed", {});
    if (challenges.take(challenge) === undefined)
      throw new AppError("passkey.challenge_expired", {});
    // On the handle, not in `withTransaction`, whose `change_log` drain would write.
    const { personId } = await verifyPasskeyAssertion(deps.venue, {
      challenge,
      response,
      rpId,
      origin: origins,
    });
    if (!(await holdsInCopy(liveBackupQuery(deps.venue), personId, "node.manage")))
      throw new AppError("authorization.not_permitted", { permission: "node.manage" });
    return personId;
  };

  return (app) => {
    if (offered !== undefined)
      app.post("/old-box-data/passkey-options", async (c) => {
        // The page's script reads only the status: 409 has it fetch the page again.
        if (!(deps.secure ?? isSecure)(c) || !sentFromThisOrigin(c)) return c.body(null, 403);
        if (deps.resetOrdered?.() === true) return c.body(null, 409);
        c.header("Cache-Control", "no-store");
        return c.json(await challenges.make(offered.rpId));
      });

    app.post("/old-box-data", async (c) => {
      const requestId = c.get("requestId");
      // Whether the refused form held the code field, so the page keeps drawing it.
      let askCode = false;
      let returnTo: string | null = null;
      let email = "";
      let fromPasskey = false;
      const refuse = (
        status: RefusalStatus,
        refusal: OldBoxDownloadRefusal,
        retryAfterSeconds?: number,
      ) =>
        deps.answer(c, status, {
          refusal,
          email,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          ...(askCode ? { askCode } : {}),
          ...(returnTo === null ? {} : { returnTo }),
          ...(fromPasskey ? { passkey: true as const } : {}),
        });
      if (!(deps.secure ?? isSecure)(c)) return refuse(403, "insecure");
      if (!sentFromThisOrigin(c)) return refuse(403, "otherPage");
      if (deps.resetOrdered?.() === true) return refuse(409, "wipeUnderWay");
      let form: URLSearchParams;
      try {
        form = new URLSearchParams(await formBody(c, MAX_FORM_BYTES));
      } catch {
        return refuse(400, "fieldsMissing");
      }
      returnTo = form.get("returnTo");
      // A route without `passkey` reads the form as the password form, whatever it holds.
      const passkey = offered === undefined ? null : form.get("passkey");
      fromPasskey = passkey !== null;
      const password = form.get("password") ?? "";
      if (passkey === null) {
        askCode = form.has("totp");
        email = (form.get("email") ?? "").trim();
        if (email === "" || password === "") return refuse(400, "fieldsMissing");
      }
      let personId: string;
      try {
        personId =
          passkey === null || offered === undefined
            ? await checkPasswordSignIn(email, password, (form.get("totp") ?? "").trim())
            : await checkPasskeySignIn(offered.rpId, passkey);
      } catch (error) {
        const fields = {
          errorCode: codeOf(error),
          requestId,
          ...(isAppError(error) && error.reason !== undefined ? { reason: error.reason } : {}),
        };
        const refusal = isAppError(error) ? signInRefusal(error) : undefined;
        if (refusal === undefined) {
          log("error", "old_box_data.failed", fields);
          return refuse(500, "failed");
        }
        log("warn", "old_box_data.refused", fields);
        if (refusal.retryAfterSeconds !== undefined)
          c.header("Retry-After", String(refusal.retryAfterSeconds));
        return refuse(refusal.status, refusal.refusal, refusal.retryAfterSeconds);
      }
      if (deps.resetOrdered?.() === true) return refuse(409, "wipeUnderWay");
      if (making) return refuse(409, "busy");
      making = true;
      try {
        const madeAt = new Date();
        const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
        let made: OldBoxWorkbook;
        let since: SinceRule | undefined;
        try {
          if (!(await deps.planned()))
            since = await sinceRule(deps.venue, deps.mainCopy?.() ?? null);
          made = await makeOldBoxWorkbook({
            db: deps.venue,
            modules: deps.modules,
            mainHoldings: deps.mainHoldings?.() ?? null,
            madeAt,
            language: locale === "es-ES" ? "es" : "en",
            ...(since === undefined ? {} : { since }),
          });
        } catch (error) {
          log("error", "old_box_data.failed", { errorCode: codeOf(error), requestId, personId });
          return refuse(500, "failed");
        }
        log("info", "old_box_data.downloaded", {
          personId,
          bytes: made.bytes.byteLength,
          ...(since === undefined ? {} : { since: since.kind }),
          ...made.counts,
          requestId,
        });
        return c.body(
          made.bytes,
          200,
          workbookDownloadHeaders(`waitron-old-main-box-${made.madeOn}.xlsx`),
        );
      } finally {
        making = false;
      }
    });
  };
}

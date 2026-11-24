import type { Context, Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import { liveBackupQuery, type Database } from "@waitron/db";
import { checkPasswordInCopy, foldedLoginEmail } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { FALLBACK_LOCALE, hasCode, isAppError, type AppError } from "@waitron/shared";
import { isSecure } from "./encrypted-connection.js";
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
  throttle?: PasswordThrottle;
  /** The main box's summary the reset-order duty last heard. */
  mainHoldings?: () => HeardHoldings | null;
  /** The copy time the reset-order duty last heard; it sets where the "since" tabs start. */
  mainCopy?: () => HeardCopy | null;
  /** Whether this box handed over in a planned handover, which leaves out the "since" tabs. */
  planned: () => Promise<boolean>;
}

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
  const { log } = deps;
  let making = false;
  return (app) => {
    app.post("/old-box-data", async (c) => {
      const requestId = c.get("requestId");
      // Whether the refused form held the code field, so the page keeps drawing it.
      let askCode = false;
      let returnTo: string | null = null;
      const refuse = (
        status: RefusalStatus,
        refusal: OldBoxDownloadRefusal,
        email = "",
        retryAfterSeconds?: number,
      ) =>
        deps.answer(c, status, {
          refusal,
          email,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          ...(askCode ? { askCode } : {}),
          ...(returnTo === null ? {} : { returnTo }),
        });
      if (!(deps.secure ?? isSecure)(c)) return refuse(403, "insecure");
      if (!sentFromThisOrigin(c)) return refuse(403, "otherPage");
      if (deps.resetOrdered?.() === true) return refuse(409, "wipeUnderWay");
      let form: URLSearchParams;
      try {
        form = new URLSearchParams(await formBody(c));
      } catch {
        return refuse(400, "fieldsMissing");
      }
      askCode = form.has("totp");
      returnTo = form.get("returnTo");
      const text = (key: string) => form.get(key) ?? "";
      const email = text("email").trim();
      const password = text("password");
      const totp = text("totp").trim();
      if (email === "" || password === "") return refuse(400, "fieldsMissing", email);
      let personId: string;
      try {
        const finishAttempt = throttle.begin(foldedLoginEmail(email));
        let outcome: "success" | "invalid" | "error" = "error";
        try {
          ({ personId } = await checkPasswordInCopy(
            liveBackupQuery(deps.venue),
            { email, password, ...(totp === "" ? {} : { totp }) },
            { permission: "node.manage", totpKeyRing: deps.totpKeyRing },
          ));
          outcome = "success";
        } catch (error) {
          if (isAppError(error) && hasCode(error, "password.invalid")) outcome = "invalid";
          throw error;
        } finally {
          finishAttempt(outcome);
        }
      } catch (error) {
        const fields = {
          errorCode: codeOf(error),
          requestId,
          ...(isAppError(error) && error.reason !== undefined ? { reason: error.reason } : {}),
        };
        const refusal = isAppError(error) ? signInRefusal(error) : undefined;
        if (refusal === undefined) {
          log("error", "old_box_data.failed", fields);
          return refuse(500, "failed", email);
        }
        log("warn", "old_box_data.refused", fields);
        if (refusal.retryAfterSeconds !== undefined)
          c.header("Retry-After", String(refusal.retryAfterSeconds));
        return refuse(refusal.status, refusal.refusal, email, refusal.retryAfterSeconds);
      }
      if (deps.resetOrdered?.() === true) return refuse(409, "wipeUnderWay", email);
      if (making) return refuse(409, "busy", email);
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
          return refuse(500, "failed", email);
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

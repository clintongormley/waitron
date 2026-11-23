import type { Hono } from "hono";
import type { KeyRing } from "@waitron/credentials";
import { liveBackupQuery } from "@waitron/db";
import { checkPasswordInCopy, foldedLoginEmail } from "@waitron/identity";
import type { WaitronModule } from "@waitron/module";
import { codeOf } from "@waitron/server-kit";
import { FALLBACK_LOCALE, hasCode, isAppError, type AppError } from "@waitron/shared";
import { isSecure } from "./encrypted-connection.js";
import { resolveLoginLocale } from "./login-locale.js";
import { buildOldBoxWorkbook } from "./old-box-data-workbook.js";
import { sentFromThisOrigin } from "./own-page.js";
import { formBody } from "./recovery-start-again.js";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";
import {
  restrictedPageAnswer,
  type OldBoxDownloadRefusal,
  type RestrictedPageDeps,
} from "./restricted-page.js";
import { workbookDownloadHeaders } from "./xlsx-workbook.js";

export interface OldBoxDataDeps {
  /** The restricted page this route answers again on a refusal; its `venue` is only read. */
  page: RestrictedPageDeps;
  modules: readonly WaitronModule[];
  totpKeyRing: KeyRing;
  throttle?: PasswordThrottle;
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
 * The replaced main box's download: a person holding `node.manage` signs in on this box's own page
 * and gets a workbook of the invoice records the main box lacks. Nothing here writes to the venue
 * database: the sign-in and the workbook only read it, and the attempt limit and the one-at-a-time
 * turn are kept in memory.
 */
export function oldBoxDataRoute(deps: OldBoxDataDeps): (app: Hono) => void {
  const throttle = deps.throttle ?? createPasswordThrottle();
  const log = deps.page.log;
  let making = false;
  return (app) => {
    app.post("/old-box-data", async (c) => {
      const requestId = c.get("requestId");
      // Whether the refused form held the code field, so the page keeps drawing it.
      let askCode = false;
      const refuse = (
        status: RefusalStatus,
        refusal: OldBoxDownloadRefusal,
        email = "",
        retryAfterSeconds?: number,
      ) =>
        restrictedPageAnswer(deps.page, c, status, {
          refusal,
          email,
          ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
          ...(askCode ? { askCode } : {}),
        });
      if (!isSecure(c)) return refuse(403, "insecure");
      if (!sentFromThisOrigin(c)) return refuse(403, "otherPage");
      if (deps.page.resetOrdered?.() === true) return refuse(409, "wipeUnderWay");
      let form: URLSearchParams;
      try {
        form = new URLSearchParams(await formBody(c));
      } catch {
        return refuse(400, "fieldsMissing");
      }
      askCode = form.has("totp");
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
            liveBackupQuery(deps.page.venue),
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
      if (deps.page.resetOrdered?.() === true) return refuse(409, "wipeUnderWay", email);
      if (making) return refuse(409, "busy", email);
      making = true;
      try {
        const madeAt = new Date();
        const locale = resolveLoginLocale(c.req.header("Accept-Language"), FALLBACK_LOCALE);
        let bytes: Uint8Array<ArrayBuffer>;
        try {
          bytes = await buildOldBoxWorkbook({
            db: deps.page.venue,
            modules: deps.modules,
            // The main box's summary from the reset-order answer is not passed yet.
            mainHoldings: null,
            madeAt,
            language: locale === "es-ES" ? "es" : "en",
          });
        } catch (error) {
          log("error", "old_box_data.failed", { errorCode: codeOf(error), requestId, personId });
          return refuse(500, "failed", email);
        }
        log("info", "old_box_data.downloaded", { personId, bytes: bytes.byteLength, requestId });
        return c.body(
          bytes,
          200,
          workbookDownloadHeaders(`waitron-old-main-box-${madeAt.toISOString().slice(0, 10)}.xlsx`),
        );
      } finally {
        making = false;
      }
    });
  };
}

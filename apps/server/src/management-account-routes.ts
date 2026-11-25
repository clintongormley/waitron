import type { KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import {
  readOwnProfile,
  listActiveStaff,
  checkManagerPassword,
  loginManager,
  shouldOfferPasskey,
  queueAccountRecovery,
  inspectAccountAction,
  completeAccountAction,
  endManagementSession,
} from "@waitron/identity";
import type { PasswordThrottle } from "@waitron/provisioning";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  setManagementCookie,
  codeOf,
  clearManagementCookie,
  readManagementSessionToken,
} from "@waitron/server-kit";
import { AppError, isAppError, isUuid } from "@waitron/shared";
import type { Hono, Context } from "hono";
import type { AccountActionRateLimiter } from "./account-rate-limit.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run } from "./management-api-errors.js";
import { type managementSite, isRemoteStaffRequest } from "./request-from-box.js";

export function mountManagementAccountRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
  recoveries: Set<Promise<void>>,
  credentialKeyRing: KeyRing,
  passkeySite: (c: Context) => ReturnType<typeof managementSite>,
  secureCookie: (c: Context) => boolean,
  passwordThrottle: PasswordThrottle,
  acceptPasswordReset: (email: string) => boolean,
  passwordResetRateLimiter: AccountActionRateLimiter,
  completionRateLimiter: AccountActionRateLimiter,
): void {
  app.get("/management-api/staff-roster", (c) =>
    run(c, log, async () => {
      const roster = await withTransaction(deps.db, async (tx) => {
        if (isRemoteStaffRequest(c))
          await readOwnProfile(tx, { managementSessionId: requireManagementSession(c) });
        return listActiveStaff(tx);
      });
      return c.json(roster);
    }),
  );

  // A malformed body is refused as `password.invalid`, the same code `loginManager` gives an unknown
  // email or a wrong password, so the response does not say which field failed.
  app.post("/management-api/session", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        email?: string;
        password?: string;
        totp?: string;
        recoveryCode?: string;
      }>(c);
      if (
        typeof body.email !== "string" ||
        body.email.trim() === "" ||
        typeof body.password !== "string" ||
        (body.totp !== undefined && typeof body.totp !== "string") ||
        (body.recoveryCode !== undefined && typeof body.recoveryCode !== "string")
      ) {
        throw new AppError("password.invalid", {}, { reason: "malformed" });
      }
      const { email, password, totp, recoveryCode } = body;
      const finishAttempt = passwordThrottle.begin(email);
      let session;
      try {
        const checked = await checkManagerPassword(deps.db, { email }, password);
        session = await withTransaction(deps.db, async (tx) => {
          const opened = await loginManager(tx, {
            email,
            password,
            totp,
            recoveryCode,
            totpKeyRing: credentialKeyRing,
            checked,
          });
          // Deliberately in the sign-in's transaction: if this read throws, the sign-in fails with
          // it rather than leaving a session half open. Read only after the sign-in succeeded, so the
          // offer says nothing to an unauthenticated caller.
          return {
            ...opened,
            offerPasskey: await shouldOfferPasskey(tx, {
              personId: opened.personId,
            }),
          };
        });
      } catch (error) {
        finishAttempt(isAppError(error) && error.code === "password.invalid" ? "invalid" : "error");
        throw error;
      }
      finishAttempt("success");
      setManagementCookie(c, session.token, secureCookie(c));
      return c.json({ personId: session.personId, offerPasskey: session.offerPasskey });
    }),
  );

  // Past the rate limit, the answer is 202 whether or not the address has an account.
  app.post("/management-api/password-reset", (c) =>
    run(c, log, async () => {
      await deps.assertAccountMailPrimary?.();
      const body = await readJsonBody<{ email?: unknown }>(c);
      passwordResetRateLimiter.check(
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "invalid-email",
      );
      if (typeof body.email === "string" && !acceptPasswordReset(body.email)) {
        return c.body(null, 202);
      }
      if (typeof body.email === "string") {
        // Answered before the lookup, so a known address answers as fast as an unknown one.
        // Shutdown waits for the write through `settle`, not for the email.
        const email = body.email;
        const recovery: Promise<void> = new Promise<void>((resolve) => setImmediate(resolve))
          .then(() =>
            withTransaction(deps.db, async (tx) => {
              const mode = (await deps.accountMailMode?.(tx)) ?? "unconfigured";
              if (mode === "unconfigured") {
                log("warn", "account_mail.unconfigured", {});
                return;
              }
              await queueAccountRecovery(tx, { email, origin: passkeySite(c).origin });
            }),
          )
          .catch((error) => {
            log("error", "account_action.request_failed", { errorCode: codeOf(error) });
          })
          .catch(() => {})
          .finally(() => recoveries.delete(recovery));
        recoveries.add(recovery);
      }
      return c.body(null, 202);
    }),
  );

  // Inspection validates the emailed token without consuming it.
  app.post("/management-api/account-actions/inspect", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        token?: unknown;
        purpose?: unknown;
      }>(c);
      completionRateLimiter.check(typeof body.token === "string" ? body.token : "invalid-token");
      if (
        typeof body.token !== "string" ||
        (body.purpose !== "invitation" && body.purpose !== "password_reset")
      ) {
        throw new AppError("account_action.invalid", {});
      }
      const purpose = body.purpose;
      const inspection = await withTransaction(deps.db, async (tx) => {
        return inspectAccountAction(tx, {
          token: body.token as string,
          purpose,
        });
      });
      return c.json(inspection);
    }),
  );

  // A scanner-safe action link: GET merely loads the SPA; only this explicit POST consumes the token.
  app.post("/management-api/account-actions/complete", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{
        token?: unknown;
        purpose?: unknown;
        password?: unknown;
        pin?: unknown;
      }>(c);
      completionRateLimiter.check(typeof body.token === "string" ? body.token : "invalid-token");
      if (
        typeof body.token !== "string" ||
        (body.purpose !== "invitation" && body.purpose !== "password_reset") ||
        typeof body.password !== "string" ||
        (body.purpose === "invitation" && typeof body.pin !== "string")
      ) {
        throw new AppError("account_action.invalid", {});
      }
      const purpose: "invitation" | "password_reset" = body.purpose;
      const password = body.password;
      const completion = await withTransaction(deps.db, async (tx) => {
        const common = {
          purpose,
          password,
          ...(purpose === "invitation" ? { pin: body.pin as string } : {}),
        };
        return completeAccountAction(tx, { ...common, token: body.token as string });
      });
      if (completion.session === null) clearManagementCookie(c);
      else setManagementCookie(c, completion.session.token, secureCookie(c));
      return c.json({ personId: completion.personId, authenticated: completion.session !== null });
    }),
  );

  // Idempotent: with no cookie, or one naming no session, it still clears the cookie and answers 204.
  app.delete("/management-api/session", (c) =>
    run(c, log, async () => {
      const token = readManagementSessionToken(c);
      if (token !== null && isUuid(token)) {
        await withTransaction(deps.db, async (tx) => {
          await endManagementSession(tx, token, "signed_out");
        });
      }
      clearManagementCookie(c);
      return c.body(null, 204);
    }),
  );
}

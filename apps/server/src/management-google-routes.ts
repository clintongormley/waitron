import type { KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import {
  beginGoogleLogin,
  beginGoogleLink,
  claimGoogleState,
  completeGoogleLink,
  loginWithGoogle,
} from "@waitron/identity";
import { readPrivacyContact } from "@waitron/provisioning";
import {
  type Logger,
  requireManagementSession,
  readJsonBody,
  setManagementCookie,
} from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import type { Hono, Context } from "hono";
import { getCookie, deleteCookie } from "hono/cookie";
import type { exchangeGoogleCode } from "./google-oidc.js";
import { admitsInspector } from "./inspector-admission.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run } from "./management-api-errors.js";
import type { ownPasswordChanges } from "./own-password-ahead.js";
import type { managementSite } from "./request-from-box.js";

export function mountManagementGoogleRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
  credentialKeyRing: KeyRing,
  passkeySite: (c: Context) => ReturnType<typeof managementSite>,
  secureCookie: (c: Context) => boolean,
  googleRedirect: (c: Context) => string,
  googleCodeExchange: typeof exchangeGoogleCode,
  googleFlowCookie: string,
  withCredentialChange: ReturnType<typeof ownPasswordChanges>,
  bindGoogleFlow: (c: Context, state: string) => void,
): void {
  app.get("/management-api/google/config", (c) =>
    run(c, log, async () => {
      const privacy = await withTransaction(deps.db, readPrivacyContact);
      const privacyNoticeUrl = privacy?.privacyNoticeUrl ?? null;
      return c.json({
        configured: deps.googleOidc !== undefined,
        ...(privacyNoticeUrl === null ? {} : { privacyNoticeUrl }),
      });
    }),
  );

  app.post("/management-api/google/login", (c) =>
    run(c, log, async () => {
      if (deps.googleOidc === undefined) throw new AppError("google.invalid", {});
      const out = await withTransaction(deps.db, async (tx) => {
        return beginGoogleLogin(tx, {
          clientId: deps.googleOidc!.clientId,
          redirectUri: googleRedirect(c),
        });
      });
      bindGoogleFlow(c, out.state);
      return c.json({ authorizationUrl: out.authorizationUrl });
    }),
  );

  app.post("/management-api/session/me/google", admitsInspector, (c) =>
    run(c, log, async () => {
      if (deps.googleOidc === undefined) throw new AppError("google.invalid", {});
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const out = await withCredentialChange(
        sessionId,
        () => ({
          ...(typeof body.totp === "string" ? { totp: body.totp } : {}),
          keyRing: credentialKeyRing,
          clientId: deps.googleOidc!.clientId,
          redirectUri: googleRedirect(c),
        }),
        beginGoogleLink,
      );
      bindGoogleFlow(c, out.state);
      return c.json({ authorizationUrl: out.authorizationUrl });
    }),
  );

  app.get("/management-api/google/callback", (c) =>
    run(c, log, async () => {
      if (deps.googleOidc === undefined) throw new AppError("google.invalid", {});
      const state = c.req.query("state");
      const code = c.req.query("code");
      if (typeof state !== "string" || state === "" || typeof code !== "string" || code === "") {
        throw new AppError("google.invalid", {});
      }
      const boundState = getCookie(c, googleFlowCookie);
      deleteCookie(c, googleFlowCookie, { path: "/management-api/google/callback" });
      if (boundState !== state) throw new AppError("google.invalid", {});
      const claimed = await withTransaction(deps.db, async (tx) => {
        return claimGoogleState(tx, { state });
      });
      // The provider exchange is a network call, so it sits between the one-time state claim and
      // the account/session write instead of holding a database transaction open across the network.
      let subject: string;
      try {
        ({ subject } = await googleCodeExchange(
          { ...deps.googleOidc, redirectUri: googleRedirect(c) },
          {
            code,
            verifier: claimed.verifier,
            nonce: claimed.nonce,
          },
        ));
      } catch {
        throw new AppError("google.invalid", {});
      }
      if (claimed.mode === "link") {
        if (claimed.personId === null) throw new AppError("google.invalid", {});
        await withTransaction(deps.db, async (tx) => {
          await completeGoogleLink(tx, {
            personId: claimed.personId!,
            subject,
          });
        });
        return c.redirect(`${passkeySite(c).origin}/profile?google=linked`);
      }
      const completion = await withTransaction(deps.db, async (tx) => {
        return loginWithGoogle(tx, { subject });
      });
      setManagementCookie(c, completion.token, secureCookie(c));
      return c.redirect(`${passkeySite(c).origin}/?login=google`);
    }),
  );
}

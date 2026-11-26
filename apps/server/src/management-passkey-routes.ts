import type { KeyRing } from "@waitron/credentials";
import { withTransaction } from "@waitron/db";
import {
  verifyOwnCredentials,
  beginPasskeyRegistration,
  readOwnProfile,
  finishPasskeyRegistration,
  readPasskeySignals,
  beginPasskeyAuthentication,
  finishPasskeyAuthentication,
} from "@waitron/identity";
import {
  readJsonBody,
  type Logger,
  requireManagementSession,
  setManagementCookie,
} from "@waitron/server-kit";
import { isUuid, AppError } from "@waitron/shared";
import type { Context, Hono } from "hono";
import { admitsInspector } from "./inspector-admission.js";
import type { ManagementApiDeps } from "./management-api-deps.js";
import { run } from "./management-api-errors.js";
import type { ownPasswordChanges } from "./own-password-ahead.js";
import { type venuePasskeyOrigins, passkeyVerifySite } from "./passkey-origins.js";
import type { managementSite } from "./request-from-box.js";

/** A malformed challenge handle would just miss in the `text` id column, so it is refused here. */
async function parsePasskeyVerifyBody(
  c: Context,
): Promise<{ challengeHandle: string; response: object }> {
  const body = await readJsonBody<{ challengeHandle?: string; response?: unknown }>(c);
  if (typeof body.challengeHandle !== "string" || !isUuid(body.challengeHandle)) {
    throw new AppError("management.request_invalid", { field: "challengeHandle" });
  }
  if (typeof body.response !== "object" || body.response === null) {
    throw new AppError("management.request_invalid", { field: "response" });
  }
  return { challengeHandle: body.challengeHandle, response: body.response };
}

export function mountManagementPasskeyRoutes(
  app: Hono,
  deps: ManagementApiDeps,
  log: Logger,
  credentialKeyRing: KeyRing,
  passkeySite: (c: Context) => ReturnType<typeof managementSite>,
  passkeyOrigins: ReturnType<typeof venuePasskeyOrigins>,
  secureCookie: (c: Context) => boolean,
  withCredentialChange: ReturnType<typeof ownPasswordChanges>,
): void {
  // ── Passkeys ──
  // Registration enrols a passkey for the signed-in person, resolved from the session, never a
  // client-supplied id. Authentication is ungated because it IS the login.
  app.post("/management-api/passkey/register/options", admitsInspector, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const out = await withCredentialChange(
        sessionId,
        () => ({
          ...(typeof body.totp === "string" ? { totp: body.totp } : {}),
          keyRing: credentialKeyRing,
        }),
        async (tx, credentials) => {
          await verifyOwnCredentials(tx, credentials);
          return beginPasskeyRegistration(tx, {
            managementSessionId: sessionId,
            rpId: passkeySite(c).rpId,
            rpName: "Waitron",
          });
        },
      );
      return c.json(out);
    }),
  );

  app.post("/management-api/passkey/register/verify", admitsInspector, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { challengeHandle, response } = await parsePasskeyVerifyBody(c);
      const site = await passkeyVerifySite(c, deps, passkeyOrigins);
      const out = await withTransaction(deps.db, async (tx) => {
        await readOwnProfile(tx, { managementSessionId: sessionId });
        return finishPasskeyRegistration(tx, {
          managementSessionId: sessionId,
          challengeHandle,
          response: response as never,
          ...site,
        });
      });
      return c.json(out);
    }),
  );

  app.get("/management-api/passkey/signals", admitsInspector, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const out = await withTransaction(deps.db, (tx) =>
        readPasskeySignals(tx, { managementSessionId: sessionId }),
      );
      return c.json({ rpId: passkeySite(c).rpId, ...out });
    }),
  );

  app.post("/management-api/passkey/auth/options", (c) =>
    run(c, log, async () => {
      const out = await withTransaction(deps.db, async (tx) => {
        return beginPasskeyAuthentication(tx, { rpId: passkeySite(c).rpId });
      });
      return c.json(out);
    }),
  );

  app.post("/management-api/passkey/auth/verify", (c) =>
    run(c, log, async () => {
      const { challengeHandle, response } = await parsePasskeyVerifyBody(c);
      const site = await passkeyVerifySite(c, deps, passkeyOrigins);
      const session = await withTransaction(deps.db, async (tx) => {
        return finishPasskeyAuthentication(tx, {
          challengeHandle,
          response: response as never,
          ...site,
        });
      });
      setManagementCookie(c, session.token, secureCookie(c));
      return c.json({ personId: session.personId });
    }),
  );
}

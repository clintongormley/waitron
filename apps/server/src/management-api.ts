// Side-effect only: registers host codes this file throws (`zone.not_found`, …).
import "./errors.js";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError, isAppError } from "@waitron/shared";
import { createPasswordThrottle, type PasswordThrottle } from "./password-throttle.js";
import {
  fireControlMode,
  readNodeMembership,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import {
  authorizeManager,
  beginGoogleLink,
  beginGoogleLogin,
  beginPasskeyAuthentication,
  beginPasskeyRegistration,
  clearPersonPin,
  claimGoogleState,
  completeAccountAction,
  completeGoogleLink,
  deactivatePerson,
  endManagementSession,
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  inspectAccountAction,
  listActiveStaff,
  listPersons,
  loginManager,
  loginManagerById,
  loginWithGoogle,
  issueAccountAction,
  invitePerson,
  reactivatePersonForInvitation,
  resolveManagementSession,
  resetPersonLogin,
  shouldOfferPasskey,
  requestAccountRecoveryAction,
  readOwnProfile,
  updatePersonDetails,
  verifyOwnCredentials,
  type PersonRoleValue,
  type TotpKeyRing,
} from "@waitron/identity";
import type { IssuedAccountAction } from "@waitron/identity";
import {
  FORM_FACTORS,
  createCanvas,
  createDeviceProfile,
  deleteCanvas,
  deleteDeviceProfile,
  getReceipt,
  getCanvas,
  getDeviceProfile,
  getTenantTheme,
  listCanvases,
  listDeviceProfiles,
  putReceipt,
  putTenantTheme,
  updateCanvas,
  updateDeviceProfile,
} from "@waitron/layouts";
import {
  clearPlacement,
  createStatus,
  createTable,
  createZone,
  deactivateStatus,
  deactivateTable,
  deactivateZone,
  type FloorTableShape,
  listStatuses,
  listTables,
  listZones,
  setTablePlacement,
  updateStatus,
  updateTable,
  updateZone,
} from "./tables.js";
import {
  createCourse,
  createStation,
  deactivateCourse,
  deactivateStation,
  getFireControl,
  listCourses,
  listStations,
  setBumpMode,
  setCategoryStation,
  setDefaultStation,
  setFireControl,
  setProductCourse,
  setProductStation,
  updateCourse,
  updateStation,
  type BumpMode,
  type FireControl,
} from "./kitchen.js";
import type { TillConfig } from "./till-config.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireBodyUuid, requireEnum } from "@waitron/server-kit";
import {
  clearManagementCookie,
  readManagementSessionToken,
  requireManagementSession,
  setManagementCookie,
} from "@waitron/server-kit";
import { isUuid } from "./till-session.js";
import type { Logger } from "./logger.js";
import type { AccountEmailSender } from "./account-email.js";
import { exchangeGoogleCode, type GoogleOidcConfig } from "./google-oidc.js";
import {
  createAccountActionRateLimiter,
  createPasswordResetCooldown,
  type AccountActionRateLimiter,
} from "./account-rate-limit.js";

/**
 * Everything the dashboard's management HTTP routes need. Unlike `TillApiDeps` it wires no fiscal
 * backend, clock or card provider.
 */
export interface ManagementApiDeps {
  db: Database;
  cfg: { nodeId: string };
  /**
   * The venue config whose location the zone, table, station and course routes are scoped to — the
   * same value `mountTillApi` receives. Optional so harnesses that never reach those routes can omit
   * it; a request that does reach one without it fails closed (`requireVenueCfg`).
   */
  venueCfg?: TillConfig;
  secureCookies: boolean;
  /** The WebAuthn Relying Party ID passkeys are bound to (`config.ts`'s `managementRpId`). */
  rpId: string;
  /** The exact served origin, scheme and port included, that each ceremony's response is verified
   * against. */
  origin: string;
  /** Venue default used when the recipient has not chosen their own UI language. */
  venueLocale?: string;
  privacyNoticeUrl?: string;
  /** Outbound delivery for invitation and password-reset links. Omitted in harnesses and when an
   * on-prem installation has not configured SMTP yet. */
  sendAccountEmail?: AccountEmailSender;
  passwordThrottle?: PasswordThrottle;
  accountActionRateLimiters?: {
    passwordReset: AccountActionRateLimiter;
    completion: AccountActionRateLimiter;
  };
  accountActionCodeKey?: Buffer;
  credentialKeyRing?: TotpKeyRing;
  googleOidc?: GoogleOidcConfig;
  googleCodeExchange?: typeof exchangeGoogleCode;
}

async function deliverAccountAction(
  deps: ManagementApiDeps,
  log: Logger,
  issued: IssuedAccountAction,
): Promise<boolean> {
  if (deps.sendAccountEmail === undefined) return false;
  const actionUrl = new URL("/manage/account", deps.origin);
  actionUrl.searchParams.set("token", issued.token);
  actionUrl.searchParams.set("purpose", issued.purpose);
  // Keep the email out of the action query. The SPA reads this fragment and supplies the semantic
  // username alongside the new-password fields for password managers.
  actionUrl.hash = new URLSearchParams({ email: issued.email }).toString();
  try {
    await deps.sendAccountEmail({
      purpose: issued.purpose,
      email: issued.email,
      displayName: issued.displayName,
      actionUrl: actionUrl.toString(),
      code: issued.code,
      codeExpiresAt: issued.codeExpiresAt,
      expiresAt: issued.expiresAt,
      locale: issued.locale ?? deps.venueLocale ?? "en-GB",
      privacyNoticeUrl: deps.privacyNoticeUrl,
    });
    return true;
  } catch {
    // Do not log the mailer error: SMTP connection URLs can contain credentials, and provider
    // errors sometimes echo them. The purpose/person id are enough for an operator to retry.
    log("error", "account_email.send_failed", {
      purpose: issued.purpose,
      personId: issued.personId,
    });
    return false;
  }
}

/**
 * Every AppError code the management API answers, and its HTTP status. Client faults only: a
 * non-AppError becomes a 500. A code absent from this table answers 400.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "management_session.required": 401,
  "management_session.expired": 401,
  "password.invalid": 401,
  "password.throttled": 429,
  "totp.invalid": 401,
  "totp.required": 401,
  "google.invalid": 401,
  "google.already_linked": 409,
  "google.second_factor_required": 401,
  "account_action.invalid": 400,
  "account_action.rate_limited": 429,
  // The passkey login is a credential check, so its failures are 401 like `password.invalid`; an
  // expired challenge is a retryable timing fault, not a rejected credential.
  "passkey.not_registered": 401,
  "passkey.verification_failed": 401,
  "passkey.challenge_expired": 400,
  "passkey.already_registered": 409,
  "person.suspended": 403,
  "person.self_deactivation": 403,
  "person.not_found": 404,
  "person.email_invalid": 400,
  "person.telephone_invalid": 400,
  "person.email_taken": 409,
  "profile.invalid": 400,
  "person.display_name_taken": 409,
  "person.last_admin": 409,
  "person.transition_invalid": 409,
  "authorization.not_permitted": 403,
  "pin.too_short": 400,
  "password.too_short": 400,
  "management.request_invalid": 400,
  "receipt.invalid": 400,
  "canvas.not_found": 404,
  "canvas.name_taken": 409,
  "canvas.in_use": 409,
  "canvas.invalid": 400,
  "theme.invalid": 400,
  "shared.invalid_id": 400,
  "status.not_found": 404,
  "status.label_taken": 409,
  "zone.not_found": 404,
  "zone.name_taken": 409,
  "table.not_found": 404,
  "table.label_taken": 409,
  "placement.invalid": 400,
  "station.not_found": 404,
  "station.name_taken": 409,
  "course.not_found": 404,
  "course.name_taken": 409,
  "device_profile.not_found": 404,
  "device_profile.name_taken": 409,
  "device_profile.in_use": 409,
  "device_profile.invalid": 400,
};

const run = createErrorBoundary(STATUS, "management.failed");

/**
 * The `require*Id` screens below refuse a malformed path id as the resource's own not-found code. Id
 * columns are plain `text`, so a malformed id would otherwise reach the query and match nothing.
 * They screen shape only; the verb reports a well-formed id that names no row.
 */
function requirePersonId(id: string): string {
  if (!isUuid(id)) throw new AppError("person.not_found", { personId: id });
  return id;
}

function requireStatusId(id: string): string {
  if (!isUuid(id)) throw new AppError("status.not_found", { statusId: id });
  return id;
}

function requireZoneId(id: string): string {
  if (!isUuid(id)) throw new AppError("zone.not_found", { zoneId: id });
  return id;
}

function requireTableId(id: string): string {
  if (!isUuid(id)) throw new AppError("table.not_found", { tableId: id });
  return id;
}

function requireStationId(id: string): string {
  if (!isUuid(id)) throw new AppError("station.not_found", { stationId: id });
  return id;
}

function requireCourseId(id: string): string {
  if (!isUuid(id)) throw new AppError("course.not_found", { courseId: id });
  return id;
}

function requireCanvasId(id: string): string {
  if (!isUuid(id)) throw new AppError("canvas.not_found", {});
  return id;
}

function requireDeviceProfileId(id: string): string {
  if (!isUuid(id)) throw new AppError("device_profile.not_found", {});
  return id;
}

function requireVenueCfg(deps: ManagementApiDeps): TillConfig {
  /* v8 ignore start -- boot always threads venueCfg; only a harness that omits it AND hits a zone/table
     route reaches this, which no suite does — a config error, surfaced as an opaque 500 by `run`. */
  if (deps.venueCfg === undefined) {
    throw new Error("mountManagementApi: venueCfg is required for the zone/table config routes");
  }
  /* v8 ignore stop */
  return deps.venueCfg;
}

/** Runs `fn` in one transaction after confirming the session holds `venue.configure`. */
function withVenueAuth<T>(
  deps: ManagementApiDeps,
  sessionId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withTransaction(deps.db, async (tx) => {
    await authorizeManager(tx, { managementSessionId: sessionId, permission: "venue.configure" });
    return fn(tx);
  });
}

/**
 * An absent `displayOrder` stays `undefined`; a present one must be an integer number in int4 range,
 * never coerced, so an explicit `null` is refused rather than stored as 0. The range check is the
 * only bound: SQLite's INTEGER is 64-bit (`packages/db/src/schema/columns.ts`).
 */
function parseDisplayOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  )
    throw new AppError("management.request_invalid", { field: "displayOrder" });
  return value;
}

/** `parseDisplayOrder`'s rule for a table's `capacity`, which must also be non-negative. */
function parseCapacity(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_147_483_647)
    throw new AppError("management.request_invalid", { field: "capacity" });
  return value;
}

/**
 * `parseDisplayOrder`'s rule for one KDS timing threshold, which must be at least one minute. The
 * ordering across the three thresholds is the caller's check.
 */
function parseThresholdMinutes(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647)
    throw new AppError("management.request_invalid", { field });
  return value;
}

/**
 * Shape only: absent or `null` is `null`; otherwise an integer number in int4 range. The domain rule
 * is `validateInactivityTimeout`'s (`@waitron/layouts`), which the store applies.
 */
function parseInactivityTimeoutSeconds(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -2_147_483_648 ||
    value > 2_147_483_647
  )
    throw new AppError("management.request_invalid", { field: "inactivityTimeoutSeconds" });
  return value;
}

/** A malformed challenge handle would just miss in the `text` id column, so it is refused here. */
async function parsePasskeyVerifyBody(
  c: Context,
): Promise<{ challengeHandle: string; response: object; name?: unknown }> {
  const body = await readJsonBody<{ challengeHandle?: string; response?: unknown; name?: unknown }>(
    c,
  );
  if (typeof body.challengeHandle !== "string" || !isUuid(body.challengeHandle)) {
    throw new AppError("management.request_invalid", { field: "challengeHandle" });
  }
  if (typeof body.response !== "object" || body.response === null) {
    throw new AppError("management.request_invalid", { field: "response" });
  }
  return { challengeHandle: body.challengeHandle, response: body.response, name: body.name };
}

export function mountManagementApi(app: Hono, deps: ManagementApiDeps, log: Logger): void {
  const accountActionCodeKey = deps.accountActionCodeKey ?? randomBytes(32);
  const credentialKeyRing = deps.credentialKeyRing ?? {
    current: { version: 1, key: accountActionCodeKey },
  };
  const passwordThrottle = deps.passwordThrottle ?? createPasswordThrottle();
  const credentialChangeThrottle = createPasswordThrottle();
  const acceptPasswordReset = createPasswordResetCooldown();
  const acceptInvitation = createPasswordResetCooldown();
  const passwordResetRateLimiter =
    deps.accountActionRateLimiters?.passwordReset ?? createAccountActionRateLimiter();
  const completionRateLimiter =
    deps.accountActionRateLimiters?.completion ?? createAccountActionRateLimiter();
  const googleCodeExchange = deps.googleCodeExchange ?? exchangeGoogleCode;
  const googleFlowCookie = "waitron_google_flow";
  const withCredentialChange = <T>(
    sessionId: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      const { personId } = await resolveManagementSession(tx, sessionId);
      const finish = credentialChangeThrottle.begin(personId);
      try {
        const result = await fn(tx);
        finish("success");
        return result;
      } catch (error) {
        finish(
          isAppError(error) && (error.code === "password.invalid" || error.code === "totp.invalid")
            ? "invalid"
            : "error",
        );
        throw error;
      }
    });
  const bindGoogleFlow = (c: Context, state: string): void => {
    setCookie(c, googleFlowCookie, state, {
      httpOnly: true,
      sameSite: "Lax",
      secure: deps.secureCookies,
      path: "/management-api/google/callback",
      maxAge: 10 * 60,
    });
  };

  app.get("/management-api/google/config", (c) =>
    c.json({ configured: deps.googleOidc !== undefined, privacyNoticeUrl: deps.privacyNoticeUrl }),
  );

  app.post("/management-api/google/login", (c) =>
    run(c, log, async () => {
      if (deps.googleOidc === undefined) throw new AppError("google.invalid", {});
      const out = await withTransaction(deps.db, async (tx) => {
        return beginGoogleLogin(tx, {
          clientId: deps.googleOidc!.clientId,
          redirectUri: deps.googleOidc!.redirectUri,
        });
      });
      bindGoogleFlow(c, out.state);
      return c.json({ authorizationUrl: out.authorizationUrl });
    }),
  );

  app.post("/management-api/session/me/google", (c) =>
    run(c, log, async () => {
      if (deps.googleOidc === undefined) throw new AppError("google.invalid", {});
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const out = await withCredentialChange(sessionId, async (tx) => {
        return beginGoogleLink(tx, {
          managementSessionId: sessionId,
          ...(typeof body.currentPassword === "string"
            ? { currentPassword: body.currentPassword }
            : {}),
          ...(typeof body.totp === "string" ? { totp: body.totp } : {}),
          keyRing: credentialKeyRing,
          clientId: deps.googleOidc!.clientId,
          redirectUri: deps.googleOidc!.redirectUri,
        });
      });
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
        ({ subject } = await googleCodeExchange(deps.googleOidc, {
          code,
          verifier: claimed.verifier,
          nonce: claimed.nonce,
        }));
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
        return c.redirect(`${deps.origin}/manage/profile?google=linked`);
      }
      const completion = await withTransaction(deps.db, async (tx) => {
        return loginWithGoogle(tx, { subject });
      });
      setManagementCookie(c, completion.token, deps.secureCookies);
      return c.redirect(`${deps.origin}/manage/?login=google`);
    }),
  );
  // Deliberately unauthenticated: `listActiveStaff` returns only `{ personId, displayName }`.
  app.get("/management-api/staff-roster", (c) =>
    run(c, log, async () => {
      const roster = await withTransaction(deps.db, async (tx) => {
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
        throw new AppError("password.invalid", {});
      }
      const { email, password, totp, recoveryCode } = body;
      const finishAttempt = passwordThrottle.begin(email);
      let session;
      try {
        session = await withTransaction(deps.db, async (tx) => {
          const opened = await loginManager(tx, {
            email,
            password,
            totp,
            recoveryCode,
            totpKeyRing: credentialKeyRing,
          });
          // Deliberately in the sign-in's transaction: if this read throws, the sign-in fails with
          // it rather than leaving a session half open.
          return {
            ...opened,
            offerPasskey: await shouldOfferPasskey(tx, {
              personId: opened.personId,
            }),
          };
        });
      } catch (error) {
        finishAttempt(
          isAppError(error) && (error.code === "password.invalid" || error.code === "totp.invalid")
            ? "invalid"
            : "error",
        );
        throw error;
      }
      finishAttempt("success");
      setManagementCookie(c, session.token, deps.secureCookies);
      return c.json({ personId: session.personId, offerPasskey: session.offerPasskey });
    }),
  );

  // Past the rate limit, the answer is 202 whether or not the address has an account.
  app.post("/management-api/password-reset", (c) =>
    run(c, log, async () => {
      const body = await readJsonBody<{ email?: unknown }>(c);
      passwordResetRateLimiter.check(
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "invalid-email",
      );
      if (typeof body.email === "string" && !acceptPasswordReset(body.email)) {
        return c.body(null, 202);
      }
      if (typeof body.email === "string") {
        const issued = await withTransaction(deps.db, async (tx) => {
          return requestAccountRecoveryAction(tx, {
            email: body.email as string,
          });
        });
        // Not awaited, so a known address does not wait on SMTP while an unknown one returns at once.
        // `deliverAccountAction` catches its own failure.
        if (issued !== null) void deliverAccountAction(deps, log, issued);
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
      else setManagementCookie(c, completion.session.token, deps.secureCookies);
      return c.json({ personId: completion.personId, authenticated: completion.session !== null });
    }),
  );

  // Idempotent: with no cookie, or one naming no session, it still clears the cookie and answers 204.
  app.delete("/management-api/session", (c) =>
    run(c, log, async () => {
      const token = readManagementSessionToken(c);
      if (token !== null && isUuid(token)) {
        await withTransaction(deps.db, async (tx) => {
          await endManagementSession(tx, token);
        });
      }
      clearManagementCookie(c);
      return c.body(null, 204);
    }),
  );

  // A peer fetches this node's signed membership chart (`null` when none was adopted). The caller
  // re-verifies the signature regardless; the credential keeps the chart off arbitrary readers. It
  // rides in a header because a GET carries no body. Every malformed credential is `password.invalid`,
  // so the response does not say which field failed. The session authorizes this read alone and is
  // ended in the same transaction; no cookie is set.
  app.get("/management-api/membership", (c) =>
    run(c, log, async () => {
      const raw = c.req.header("x-waitron-peer-credential");
      let credential: { personId?: string; password?: string; totp?: string } = {};
      if (raw !== undefined) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new AppError("password.invalid", {});
        }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          throw new AppError("password.invalid", {});
        }
        credential = parsed as { personId?: string; password?: string; totp?: string };
      }
      if (
        typeof credential.personId !== "string" ||
        !isUuid(credential.personId) ||
        typeof credential.password !== "string" ||
        (credential.totp !== undefined && typeof credential.totp !== "string")
      ) {
        throw new AppError("password.invalid", {});
      }
      const { personId, password, totp } = credential;
      await withTransaction(deps.db, async (tx) => {
        const session = await loginManagerById(tx, {
          personId,
          password,
          totp,
        });
        await authorizeManager(tx, {
          managementSessionId: session.token,
          permission: "mirror.create",
        });
        await endManagementSession(tx, session.token);
      });
      const document = await readNodeMembership(deps.db);
      return c.json({ document });
    }),
  );

  app.get("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const people = await withTransaction(deps.db, async (tx) => {
        return listPersons(tx, { managementSessionId: sessionId });
      });
      return c.json(people);
    }),
  );

  // Creates a pending person and issues their invitation in one transaction.
  app.post("/management-api/staff", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        displayName?: string;
        firstNames?: string;
        lastNames?: string;
        telephone?: string | null;
        role?: PersonRoleValue;
        email?: string;
      }>(c);
      if (
        typeof body.displayName !== "string" ||
        typeof body.firstNames !== "string" ||
        typeof body.lastNames !== "string" ||
        typeof body.role !== "string" ||
        (body.telephone !== undefined &&
          body.telephone !== null &&
          typeof body.telephone !== "string")
      ) {
        throw new AppError("management.request_invalid", {
          field: "displayName|firstNames|lastNames|role|telephone",
        });
      }
      if (typeof body.email !== "string") {
        throw new AppError("management.request_invalid", { field: "email" });
      }
      const { displayName, firstNames, lastNames, telephone = null, role, email } = body;
      const { created, issued } = await withTransaction(deps.db, async (tx) => {
        const created = await invitePerson(tx, {
          managementSessionId: sessionId,
          displayName,
          firstNames,
          lastNames,
          telephone,
          role,
          email,
        });
        const issued = await issueAccountAction(tx, {
          personId: created.id,
          purpose: "invitation",
        });
        return { created, issued };
      });
      const invitationSent = await deliverAccountAction(deps, log, issued);
      return c.json({ ...created, invitationSent }, 201);
    }),
  );

  app.post("/management-api/staff/:id/invitation", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "person.manage",
        });
      });
      if (!acceptInvitation(personId)) {
        return c.json({ invitationSent: false });
      }
      const issued = await withTransaction(deps.db, async (tx) => {
        return issueAccountAction(tx, {
          personId,
          purpose: "invitation",
        });
      });
      return c.json({ invitationSent: await deliverAccountAction(deps, log, issued) });
    }),
  );

  app.put("/management-api/staff/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      const body = await readJsonBody<{
        displayName?: unknown;
        firstNames?: unknown;
        lastNames?: unknown;
        telephone?: unknown;
        email?: unknown;
        role?: unknown;
        status?: unknown;
      }>(c);
      for (const field of ["displayName", "firstNames", "lastNames", "email"] as const) {
        if (typeof body[field] !== "string") {
          throw new AppError("management.request_invalid", { field });
        }
      }
      if (body.telephone !== null && typeof body.telephone !== "string") {
        throw new AppError("management.request_invalid", { field: "telephone" });
      }
      const role = requireEnum(body.role, "role", ["staff", "supervisor", "manager", "admin"]);
      const status = requireEnum(body.status, "status", ["pending", "active", "suspended"]);
      await withTransaction(deps.db, async (tx) => {
        await updatePersonDetails(tx, {
          managementSessionId: sessionId,
          personId,
          displayName: body.displayName as string,
          firstNames: body.firstNames as string,
          lastNames: body.lastNames as string,
          telephone: body.telephone as string | null,
          email: body.email as string,
          role,
          status,
        });
      });
      return c.body(null, 204);
    }),
  );

  // The person chooses the replacement PIN in their own profile; an administrator never handles it.
  app.post("/management-api/staff/:id/reset-pin", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await clearPersonPin(tx, { managementSessionId: sessionId, personId: id });
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/staff/:id/deactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await deactivatePerson(tx, { managementSessionId: sessionId, personId });
      });
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/staff/:id/reset-login", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "person.manage",
        });
      });
      if (!acceptInvitation(personId)) {
        return c.json({ invitationSent: false });
      }
      const issued = await withTransaction(deps.db, async (tx) => {
        await resetPersonLogin(tx, { managementSessionId: sessionId, personId });
        return issueAccountAction(tx, {
          personId,
          purpose: "invitation",
        });
      });
      return c.json({ invitationSent: await deliverAccountAction(deps, log, issued) });
    }),
  );

  app.post("/management-api/staff/:id/reactivate", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const personId = requirePersonId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "person.manage",
        });
      });
      if (!acceptInvitation(personId)) {
        return c.json({ invitationSent: false });
      }
      const issued = await withTransaction(deps.db, async (tx) => {
        await reactivatePersonForInvitation(tx, { managementSessionId: sessionId, personId });
        return issueAccountAction(tx, {
          personId,
          purpose: "invitation",
        });
      });
      return c.json({ invitationSent: await deliverAccountAction(deps, log, issued) });
    }),
  );

  // `getReceipt` does not authorize (the till's unauthenticated boot read shares it), so this route
  // carries its own gate.
  app.get("/management-api/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const receipt = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return getReceipt(tx);
      });
      return c.json({ receipt });
    }),
  );

  app.put("/management-api/receipt", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ receipt?: unknown }>(c);
      if (
        typeof body !== "object" ||
        body === null ||
        Array.isArray(body) ||
        !("receipt" in body)
      ) {
        throw new AppError("management.request_invalid", { field: "receipt" });
      }
      const { receipt } = body;
      await withTransaction(deps.db, async (tx) => {
        await putReceipt(tx, {
          managementSessionId: sessionId,
          receipt,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Canvases and theme ──
  // The layouts READ functions do not authorize, so each read route carries its own gate; the write
  // functions authorize themselves.
  app.get("/management-api/canvases", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const canvases = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return listCanvases(tx);
      });
      return c.json({ canvases });
    }),
  );

  app.get("/management-api/canvases/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCanvasId(c.req.param("id"));
      const canvas = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return getCanvas(tx, id);
      });
      if (canvas === undefined) throw new AppError("canvas.not_found", {});
      return c.json(canvas);
    }),
  );

  app.post("/management-api/canvases", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ name?: unknown; definition?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      if (!("definition" in body)) {
        throw new AppError("management.request_invalid", { field: "definition" });
      }
      const { name, definition } = body;
      const result = await withTransaction(deps.db, async (tx) => {
        return createCanvas(tx, {
          managementSessionId: sessionId,
          name,
          definition,
        });
      });
      return c.json(result, 201);
    }),
  );

  app.put("/management-api/canvases/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCanvasId(c.req.param("id"));
      const body = await readJsonBody<{ name?: unknown; definition?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      if (!("definition" in body)) {
        throw new AppError("management.request_invalid", { field: "definition" });
      }
      const { name, definition } = body;
      await withTransaction(deps.db, async (tx) => {
        await updateCanvas(tx, {
          managementSessionId: sessionId,
          id,
          name,
          definition,
        });
      });
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/canvases/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCanvasId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await deleteCanvas(tx, {
          managementSessionId: sessionId,
          id,
        });
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/theme", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const theme = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return getTenantTheme(tx);
      });
      return c.json({ theme: theme ?? null });
    }),
  );

  app.put("/management-api/theme", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ theme?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body) || !("theme" in body)) {
        throw new AppError("management.request_invalid", { field: "theme" });
      }
      const { theme } = body;
      await withTransaction(deps.db, async (tx) => {
        await putTenantTheme(tx, {
          managementSessionId: sessionId,
          theme,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Device profiles ──
  // Gated like the canvases: each read route carries its own gate, the write functions authorize
  // themselves.
  app.get("/management-api/device-profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const deviceProfiles = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return listDeviceProfiles(tx);
      });
      return c.json({ deviceProfiles });
    }),
  );

  app.get("/management-api/device-profiles/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      const profile = await withTransaction(deps.db, async (tx) => {
        await authorizeManager(tx, {
          managementSessionId: sessionId,
          permission: "layout.configure",
        });
        return getDeviceProfile(tx, id);
      });
      if (profile === undefined) throw new AppError("device_profile.not_found", {});
      return c.json(profile);
    }),
  );

  app.post("/management-api/device-profiles", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{
        name?: unknown;
        formFactor?: unknown;
        canvasId?: unknown;
        capabilities?: unknown;
        inactivityTimeoutSeconds?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      if (!("capabilities" in body)) {
        throw new AppError("management.request_invalid", { field: "capabilities" });
      }
      const { name, capabilities } = body;
      const canvasId =
        body.canvasId === undefined || body.canvasId === null
          ? null
          : requireBodyUuid(body.canvasId, "canvasId");
      const inactivityTimeoutSeconds = parseInactivityTimeoutSeconds(body.inactivityTimeoutSeconds);
      const formFactor = requireEnum(body.formFactor, "formFactor", FORM_FACTORS);
      const result = await withTransaction(deps.db, async (tx) => {
        return createDeviceProfile(tx, {
          managementSessionId: sessionId,
          name,
          formFactor,
          canvasId,
          capabilities,
          inactivityTimeoutSeconds,
        });
      });
      return c.json(result, 201);
    }),
  );

  // Full replacement: an omitted `canvasId` or `inactivityTimeoutSeconds` stores null.
  app.put("/management-api/device-profiles/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      const body = await readJsonBody<{
        name?: unknown;
        formFactor?: unknown;
        canvasId?: unknown;
        capabilities?: unknown;
        inactivityTimeoutSeconds?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string") {
        throw new AppError("management.request_invalid", { field: "name" });
      }
      if (!("capabilities" in body)) {
        throw new AppError("management.request_invalid", { field: "capabilities" });
      }
      const { name, capabilities } = body;
      const canvasId =
        body.canvasId === undefined || body.canvasId === null
          ? null
          : requireBodyUuid(body.canvasId, "canvasId");
      const inactivityTimeoutSeconds = parseInactivityTimeoutSeconds(body.inactivityTimeoutSeconds);
      const formFactor = requireEnum(body.formFactor, "formFactor", FORM_FACTORS);
      const result = await withTransaction(deps.db, async (tx) => {
        return updateDeviceProfile(tx, {
          managementSessionId: sessionId,
          id,
          name,
          formFactor,
          canvasId,
          capabilities,
          inactivityTimeoutSeconds,
        });
      });
      return c.json(result);
    }),
  );

  app.delete("/management-api/device-profiles/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireDeviceProfileId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await deleteDeviceProfile(tx, {
          managementSessionId: sessionId,
          id,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Service statuses ──
  // Each status verb authorizes `venue.configure` itself.
  app.post("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ label?: unknown; color?: unknown; displayOrder?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.label !== "string")
        throw new AppError("management.request_invalid", { field: "label" });
      if (typeof body.color !== "string")
        throw new AppError("management.request_invalid", { field: "color" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const { label, color } = body;
      const result = await withTransaction(deps.db, async (tx) => {
        return createStatus(tx, {
          managementSessionId: sessionId,
          label,
          color,
          displayOrder,
        });
      });
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/service-statuses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const statuses = await withTransaction(deps.db, async (tx) => {
        return listStatuses(tx, { managementSessionId: sessionId });
      });
      return c.json(statuses);
    }),
  );

  app.patch("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStatusId(c.req.param("id"));
      const body = await readJsonBody<{
        label?: unknown;
        color?: unknown;
        displayOrder?: unknown;
        active?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: {
        managementSessionId: string;
        id: string;
        label?: string;
        color?: string;
        displayOrder?: number;
        active?: boolean;
      } = {
        managementSessionId: sessionId,
        id,
      };
      if (body.label !== undefined) {
        if (typeof body.label !== "string")
          throw new AppError("management.request_invalid", { field: "label" });
        patch.label = body.label;
      }
      if (body.color !== undefined) {
        if (typeof body.color !== "string")
          throw new AppError("management.request_invalid", { field: "color" });
        patch.color = body.color;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      // An empty patch is a 204 no-op: Drizzle refuses an empty `.set()` ("No values to set"), which
      // would answer 500. The zone, table, station and course PATCH routes do the same.
      if (
        patch.label === undefined &&
        patch.color === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withTransaction(deps.db, async (tx) => {
        await updateStatus(tx, patch);
      });
      return c.body(null, 204);
    }),
  );

  // DELETE deactivates; the verb is the whole guard (`tables.ts`'s `deactivateTable` note).
  app.delete("/management-api/service-statuses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStatusId(c.req.param("id"));
      await withTransaction(deps.db, async (tx) => {
        await deactivateStatus(tx, {
          managementSessionId: sessionId,
          id,
        });
      });
      return c.body(null, 204);
    }),
  );

  // ── Zones and tables ──
  // Unlike the status verbs, the zone, table, station and course verbs do not authorize, so these
  // routes gate through `withVenueAuth`.
  app.post("/management-api/zones", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const { name } = body;
      const result = await withVenueAuth(deps, sessionId, (tx) =>
        createZone(tx, cfg, { name, displayOrder }),
      );
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/zones", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const zones = await withVenueAuth(deps, sessionId, (tx) => listZones(tx, cfg));
      return c.json(zones);
    }),
  );

  app.patch("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { name?: string; displayOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, sessionId, (tx) => updateZone(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // DELETE deactivates; the verb is the whole guard (`tables.ts`'s `deactivateTable` note).
  app.delete("/management-api/zones/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireZoneId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => deactivateZone(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/tables", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ label?: unknown; zoneId?: unknown; capacity?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.label !== "string")
        throw new AppError("management.request_invalid", { field: "label" });
      let zoneId: string | undefined;
      if (body.zoneId !== undefined) {
        if (typeof body.zoneId !== "string")
          throw new AppError("management.request_invalid", { field: "zoneId" });
        // A malformed zoneId gets the same `zone.not_found` a well-formed missing one does.
        if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
        zoneId = body.zoneId;
      }
      const capacity = parseCapacity(body.capacity);
      const { label } = body;
      const result = await withVenueAuth(deps, sessionId, (tx) =>
        createTable(tx, cfg, { label, zoneId, capacity }),
      );
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/tables", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const tables = await withVenueAuth(deps, sessionId, (tx) => listTables(tx, cfg));
      return c.json(tables);
    }),
  );

  app.patch("/management-api/tables/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ label?: unknown; zoneId?: unknown; capacity?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { label?: string; zoneId?: string; capacity?: number } = {};
      if (body.label !== undefined) {
        if (typeof body.label !== "string")
          throw new AppError("management.request_invalid", { field: "label" });
        patch.label = body.label;
      }
      if (body.zoneId !== undefined) {
        if (typeof body.zoneId !== "string")
          throw new AppError("management.request_invalid", { field: "zoneId" });
        if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
        patch.zoneId = body.zoneId;
      }
      if (body.capacity !== undefined) {
        patch.capacity = parseCapacity(body.capacity);
      }
      if (patch.label === undefined && patch.zoneId === undefined && patch.capacity === undefined) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, sessionId, (tx) => updateTable(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // DELETE deactivates; the verb is the whole guard (`tables.ts`'s `deactivateTable` note).
  app.delete("/management-api/tables/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => deactivateTable(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Table placement ──
  // The route screens types; the verb owns the value ranges (`placement.invalid`).
  app.put("/management-api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{
        zoneId?: unknown;
        posX?: unknown;
        posY?: unknown;
        shape?: unknown;
        rotation?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.zoneId !== "string")
        throw new AppError("management.request_invalid", { field: "zoneId" });
      if (!isUuid(body.zoneId)) throw new AppError("zone.not_found", { zoneId: body.zoneId });
      if (typeof body.posX !== "number")
        throw new AppError("management.request_invalid", { field: "posX" });
      if (typeof body.posY !== "number")
        throw new AppError("management.request_invalid", { field: "posY" });
      if (typeof body.shape !== "string")
        throw new AppError("management.request_invalid", { field: "shape" });
      if (typeof body.rotation !== "number")
        throw new AppError("management.request_invalid", { field: "rotation" });
      // The verb re-checks `shape`'s membership, so the cast asserts nothing it does not check.
      const { zoneId, posX, posY, rotation } = body;
      const shape = body.shape as FloorTableShape;
      await withVenueAuth(deps, sessionId, (tx) =>
        setTablePlacement(tx, cfg, id, { zoneId, posX, posY, shape, rotation }),
      );
      return c.body(null, 204);
    }),
  );

  app.delete("/management-api/tables/:id/placement", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireTableId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => clearPlacement(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // ── Kitchen stations and routing ──
  app.post("/management-api/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        isDefault?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      let isDefault: boolean | undefined;
      if (body.isDefault !== undefined) {
        if (typeof body.isDefault !== "boolean")
          throw new AppError("management.request_invalid", { field: "isDefault" });
        isDefault = body.isDefault;
      }
      const { name } = body;
      const result = await withVenueAuth(deps, sessionId, (tx) =>
        createStation(tx, cfg, { name, displayOrder, isDefault }),
      );
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/stations", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const stations = await withVenueAuth(deps, sessionId, (tx) => listStations(tx, cfg));
      return c.json(stations);
    }),
  );

  // The three timing thresholds travel together: if any is present, all three must be, strictly
  // ordered `warm < overdue < forgotten` (the `kitchen_stations_thresholds_ordered` CHECK). A partial
  // set could be ordering-checked only by reading the row, which this route deliberately does not do.
  app.patch("/management-api/stations/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{
        name?: unknown;
        displayOrder?: unknown;
        active?: unknown;
        warmAfterMinutes?: unknown;
        overdueAfterMinutes?: unknown;
        forgottenAfterMinutes?: unknown;
      }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: {
        name?: string;
        displayOrder?: number;
        active?: boolean;
        warmAfterMinutes?: number;
        overdueAfterMinutes?: number;
        forgottenAfterMinutes?: number;
      } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      const warmAfterMinutes = parseThresholdMinutes(body.warmAfterMinutes, "warmAfterMinutes");
      const overdueAfterMinutes = parseThresholdMinutes(
        body.overdueAfterMinutes,
        "overdueAfterMinutes",
      );
      const forgottenAfterMinutes = parseThresholdMinutes(
        body.forgottenAfterMinutes,
        "forgottenAfterMinutes",
      );
      if (
        warmAfterMinutes !== undefined ||
        overdueAfterMinutes !== undefined ||
        forgottenAfterMinutes !== undefined
      ) {
        if (
          warmAfterMinutes === undefined ||
          overdueAfterMinutes === undefined ||
          forgottenAfterMinutes === undefined ||
          warmAfterMinutes >= overdueAfterMinutes ||
          overdueAfterMinutes >= forgottenAfterMinutes
        ) {
          throw new AppError("management.request_invalid", {
            field: "warmAfterMinutes|overdueAfterMinutes|forgottenAfterMinutes",
          });
        }
        patch.warmAfterMinutes = warmAfterMinutes;
        patch.overdueAfterMinutes = overdueAfterMinutes;
        patch.forgottenAfterMinutes = forgottenAfterMinutes;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined &&
        // The all-or-nothing validation above never leaves warmAfterMinutes undefined while the other
        // two thresholds are set, so this alone correctly proxies "no threshold field in this patch".
        patch.warmAfterMinutes === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, sessionId, (tx) => updateStation(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // DELETE deactivates; the verb is the whole guard (`tables.ts`'s `deactivateTable` note).
  app.delete("/management-api/stations/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => deactivateStation(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  app.post("/management-api/stations/:id/default", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireStationId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => setDefaultStation(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // Routes a category, or a product (which overrides its category), to a station; `null` clears it.
  // A malformed `:id` gets the verb's unknown-id no-op, inside `withVenueAuth` so the gate still runs.
  const registerStationRoute = (
    segment: string,
    setStation: (
      tx: Transaction,
      cfg: TillConfig,
      id: string,
      stationId: string | null,
    ) => Promise<void>,
  ): void => {
    app.put(`/management-api/${segment}/:id/station`, (c) =>
      run(c, log, async () => {
        const sessionId = requireManagementSession(c);
        const cfg = requireVenueCfg(deps);
        const id = c.req.param("id");
        const body = await readJsonBody<{ stationId?: unknown }>(c);
        if (typeof body.stationId !== "string" && body.stationId !== null) {
          throw new AppError("management.request_invalid", { field: "stationId" });
        }
        const stationId = body.stationId;
        if (stationId !== null && !isUuid(stationId)) {
          throw new AppError("station.not_found", { stationId });
        }
        await withVenueAuth(deps, sessionId, async (tx) => {
          if (!isUuid(id)) return;
          await setStation(tx, cfg, id, stationId);
        });
        return c.body(null, 204);
      }),
    );
  };
  registerStationRoute("categories", setCategoryStation);
  registerStationRoute("products", setProductStation);

  app.put("/management-api/bump-mode", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ mode?: unknown }>(c);
      if (body.mode !== "line" && body.mode !== "ticket") {
        throw new AppError("management.request_invalid", { field: "mode" });
      }
      const mode: BumpMode = body.mode;
      await withVenueAuth(deps, sessionId, (tx) => setBumpMode(tx, cfg, mode));
      return c.body(null, 204);
    }),
  );

  // ── Kitchen courses and fire control ──
  app.post("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown }>(c);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      if (typeof body.name !== "string")
        throw new AppError("management.request_invalid", { field: "name" });
      const displayOrder = parseDisplayOrder(body.displayOrder);
      const { name } = body;
      const result = await withVenueAuth(deps, sessionId, (tx) =>
        createCourse(tx, cfg, { name, displayOrder }),
      );
      return c.json(result, 201);
    }),
  );

  app.get("/management-api/courses", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const courses = await withVenueAuth(deps, sessionId, (tx) => listCourses(tx, cfg));
      return c.json(courses);
    }),
  );

  app.patch("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ name?: unknown; displayOrder?: unknown; active?: unknown }>(
        c,
      );
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new AppError("management.request_invalid", { field: "body" });
      }
      const patch: { name?: string; displayOrder?: number; active?: boolean } = {};
      if (body.name !== undefined) {
        if (typeof body.name !== "string")
          throw new AppError("management.request_invalid", { field: "name" });
        patch.name = body.name;
      }
      if (body.displayOrder !== undefined) {
        patch.displayOrder = parseDisplayOrder(body.displayOrder);
      }
      if (body.active !== undefined) {
        if (typeof body.active !== "boolean")
          throw new AppError("management.request_invalid", { field: "active" });
        patch.active = body.active;
      }
      if (
        patch.name === undefined &&
        patch.displayOrder === undefined &&
        patch.active === undefined
      ) {
        return c.body(null, 204);
      }
      await withVenueAuth(deps, sessionId, (tx) => updateCourse(tx, cfg, id, patch));
      return c.body(null, 204);
    }),
  );

  // DELETE deactivates; the verb is the whole guard (`tables.ts`'s `deactivateTable` note).
  app.delete("/management-api/courses/:id", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const id = requireCourseId(c.req.param("id"));
      const cfg = requireVenueCfg(deps);
      await withVenueAuth(deps, sessionId, (tx) => deactivateCourse(tx, cfg, id));
      return c.body(null, 204);
    }),
  );

  // `null` clears the product's course. A malformed `:id` is handled as in `registerStationRoute`.
  app.put("/management-api/products/:id/course", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const id = c.req.param("id");
      const body = await readJsonBody<{ courseId?: unknown }>(c);
      if (typeof body.courseId !== "string" && body.courseId !== null) {
        throw new AppError("management.request_invalid", { field: "courseId" });
      }
      const courseId = body.courseId;
      if (courseId !== null && !isUuid(courseId)) {
        throw new AppError("course.not_found", { courseId });
      }
      await withVenueAuth(deps, sessionId, async (tx) => {
        if (!isUuid(id)) return;
        await setProductCourse(tx, cfg, id, courseId);
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/fire-control", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const mode = await withVenueAuth(deps, sessionId, (tx) => getFireControl(tx, cfg));
      return c.json({ mode });
    }),
  );

  // The valid set is read from the schema's `fireControlMode.enumValues`, not a literal list: a stale
  // list missing a member would refuse a valid mode, and the type check cannot catch a missing member.
  app.put("/management-api/fire-control", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const cfg = requireVenueCfg(deps);
      const body = await readJsonBody<{ mode?: unknown }>(c);
      if (
        typeof body.mode !== "string" ||
        !(fireControlMode.enumValues as readonly string[]).includes(body.mode)
      ) {
        throw new AppError("management.request_invalid", { field: "mode" });
      }
      const mode = body.mode as FireControl;
      await withVenueAuth(deps, sessionId, (tx) => setFireControl(tx, cfg, mode));
      return c.body(null, 204);
    }),
  );

  // ── Passkeys ──
  // Registration enrols a passkey for the signed-in person, resolved from the session, never a
  // client-supplied id. Authentication is ungated because it IS the login.
  app.post("/management-api/passkey/register/options", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      if (typeof body.currentPassword !== "string") {
        throw new AppError("management.request_invalid", { field: "currentPassword" });
      }
      const out = await withCredentialChange(sessionId, async (tx) => {
        await verifyOwnCredentials(tx, {
          managementSessionId: sessionId,
          currentPassword: body.currentPassword as string,
          ...(typeof body.totp === "string" ? { totp: body.totp } : {}),
          keyRing: credentialKeyRing,
        });
        return beginPasskeyRegistration(tx, {
          managementSessionId: sessionId,
          rpId: deps.rpId,
          rpName: "Waitron",
        });
      });
      return c.json(out);
    }),
  );

  app.post("/management-api/passkey/register/verify", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { challengeHandle, response, name } = await parsePasskeyVerifyBody(c);
      const out = await withTransaction(deps.db, async (tx) => {
        await readOwnProfile(tx, { managementSessionId: sessionId });
        return finishPasskeyRegistration(tx, {
          managementSessionId: sessionId,
          challengeHandle,
          response: response as never,
          name,
          rpId: deps.rpId,
          origin: deps.origin,
        });
      });
      return c.json(out);
    }),
  );

  app.post("/management-api/passkey/auth/options", (c) =>
    run(c, log, async () => {
      const out = await withTransaction(deps.db, async (tx) => {
        return beginPasskeyAuthentication(tx, { rpId: deps.rpId });
      });
      return c.json(out);
    }),
  );

  // `finishPasskeyAuthentication` answers a bad assertion, an unknown credential and a non-active
  // owner with the same `passkey.verification_failed`; a non-string response id is
  // `passkey.not_registered`.
  app.post("/management-api/passkey/auth/verify", (c) =>
    run(c, log, async () => {
      const { challengeHandle, response } = await parsePasskeyVerifyBody(c);
      const session = await withTransaction(deps.db, async (tx) => {
        return finishPasskeyAuthentication(tx, {
          challengeHandle,
          response: response as never,
          rpId: deps.rpId,
          origin: deps.origin,
        });
      });
      setManagementCookie(c, session.token, deps.secureCookies);
      return c.json({ personId: session.personId });
    }),
  );
}

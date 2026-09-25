import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readTenant, withTransaction, type Database, type Transaction } from "@waitron/db";
import {
  acceptSwap,
  createAbsence,
  listAbsencesForPerson,
  listShiftsForPerson,
  listSwapsForPerson,
  requestSwap,
  absenceKind,
} from "@waitron/workforce";
import {
  permissionsForRole,
  IDLE_TIMEOUT_MS,
  markPasskeyOffered,
  resolveManagementSession,
  setPersonLocale,
  readOwnProfile,
  saveOwnProfile,
  confirmOwnEmailChange,
  changeOwnPassword,
  changeOwnPin,
  removeOwnPasskey,
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  regenerateOwnRecoveryCodes,
  disableOwnTotp,
  unlinkOwnGoogle,
  type TotpKeyRing,
} from "@waitron/identity";
import { SUPPORTED_LOCALES, AppError, isAppError } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import { createPasswordThrottle } from "./password-throttle.js";
import "./errors.js";
import { createErrorBoundary } from "@waitron/server-kit";
import { readJsonBody } from "@waitron/server-kit";
import { requireManagementSession } from "@waitron/server-kit";
import {
  requireBodyUuid,
  requireEnum,
  requireNullableBodyUuid,
  requireNullableString,
  requirePeriod,
  requireUuidParam,
} from "@waitron/server-kit";
import type { Logger } from "./logger.js";
import type { OnboardingIntent } from "./trading-config.js";
import type { AccountEmailSender } from "./account-email.js";

export interface MeApiDeps {
  db: Database;
  cfg: { nodeId: string };
  /** The language the dashboard defaults to before a signed-in person's own preference is known. */
  venueLocale: string;
  /** The setup journey that created this installation, shown persistently by the dashboard. */
  onboardingIntent?: OnboardingIntent;
  /** The enabled module names, `core` included. */
  modules: string[];
  credentialKeyRing?: TotpKeyRing;
  accountActionCodeKey?: Buffer;
  accountActionBaseUrl?: string;
  privacyNoticeUrl?: string;
  sendAccountEmail?: AccountEmailSender;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "password.too_short": 400,
  "password.throttled": 429,
  "totp.invalid": 401,
  "pin.too_short": 400,
  "passkey.not_registered": 404,
  "person.email_taken": 409,
  "person.email_invalid": 400,
  "person.telephone_invalid": 400,
  "person.display_name_taken": 409,
  "profile.invalid": 400,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "locale.unsupported": 400,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "absence.invalid": 400,
  "shift.not_found": 404,
  "swap.not_found": 404,
  "swap.not_permitted": 403,
  "swap.not_acceptable": 409,
  "absence.overlaps": 409,
};

const run = createErrorBoundary(STATUS, "me.failed");

/**
 * Staff self-service routes. Every route acts as the person its management session names, never
 * one the request body names. Deliberately role-blind — never `authorizeManager`: a `staff` person
 * holds an empty permission set, so that gate would refuse every staff member.
 */
export function mountMeApi(app: Hono, deps: MeApiDeps, log: Logger): void {
  const credentialKeyRing = deps.credentialKeyRing ?? {
    current: { version: 1, key: randomBytes(32) },
  };
  const accountActionCodeKey = deps.accountActionCodeKey ?? randomBytes(32);
  const profileThrottle = createPasswordThrottle();
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      return fn(tx);
    });

  const updateProfile = async <T>(
    sessionId: string,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> => {
    return asStaff(async (tx) => {
      const { personId } = await resolveManagementSession(tx, sessionId);
      const finish = profileThrottle.begin(personId);
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
  };
  const textField = (body: Record<string, unknown>, field: string): string => {
    if (typeof body[field] !== "string")
      throw new AppError("management.request_invalid", { field });
    return body[field];
  };
  const credentials = (body: Record<string, unknown>) => ({
    currentPassword:
      body.currentPassword === undefined ? undefined : textField(body, "currentPassword"),
    totp: body.totp === undefined ? undefined : textField(body, "totp"),
    keyRing: credentialKeyRing,
  });

  app.get("/management-api/session/me/profile", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      return c.json(await asStaff((tx) => readOwnProfile(tx, { managementSessionId })));
    }),
  );
  app.put("/management-api/session/me/profile", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        displayName: textField(body, "displayName"),
        firstNames: textField(body, "firstNames"),
        lastNames: textField(body, "lastNames"),
        telephone: body.telephone === null ? null : textField(body, "telephone"),
        email: textField(body, "email"),
        locale: textField(body, "locale"),
        ...credentials(body),
      };
      const issued = await updateProfile(managementSessionId, (tx) =>
        saveOwnProfile(tx, { ...input, emailCodeKey: accountActionCodeKey }),
      );
      let emailVerificationSent = false;
      if (issued !== null && deps.sendAccountEmail !== undefined) {
        try {
          await deps.sendAccountEmail({
            ...issued,
            actionUrl: deps.accountActionBaseUrl ?? "/",
            locale: issued.locale ?? deps.venueLocale,
            privacyNoticeUrl: deps.privacyNoticeUrl,
          });
          emailVerificationSent = true;
        } catch (error) {
          log("error", "account_email.send_failed", {
            purpose: issued.purpose,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return c.json({ emailVerificationSent });
    }),
  );
  app.post("/management-api/session/me/profile/email/confirm", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const email = await asStaff((tx) =>
        confirmOwnEmailChange(tx, {
          managementSessionId,
          code: textField(body, "code"),
          codeKey: accountActionCodeKey,
        }),
      );
      if (email === null) throw new AppError("account_action.invalid", {});
      return c.json({ email });
    }),
  );
  app.put("/management-api/session/me/password", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        password: textField(body, "password"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, (tx) => changeOwnPassword(tx, input));
      return c.body(null, 204);
    }),
  );
  app.put("/management-api/session/me/pin", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        pin: textField(body, "pin"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, (tx) => changeOwnPin(tx, input));
      return c.body(null, 204);
    }),
  );
  app.delete("/management-api/session/me/passkeys/:id", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        id: requireUuidParam(c.req.param("id"), "passkey"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, (tx) => removeOwnPasskey(tx, input));
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/session/me/totp/begin", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      return c.json(
        await updateProfile(managementSessionId, (tx) =>
          beginOwnTotpEnrollment(tx, {
            managementSessionId,
            ...credentials(body),
          }),
        ),
      );
    }),
  );
  app.post("/management-api/session/me/totp/finish", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const result = await updateProfile(managementSessionId, (tx) =>
        finishOwnTotpEnrollment(tx, {
          managementSessionId,
          enrollmentId: requireBodyUuid(body.enrollmentId, "enrollmentId"),
          code: textField(body, "code"),
          keyRing: credentialKeyRing,
        }),
      );
      return c.json(result);
    }),
  );
  app.post("/management-api/session/me/recovery-codes", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      return c.json(
        await updateProfile(managementSessionId, (tx) =>
          regenerateOwnRecoveryCodes(tx, {
            managementSessionId,
            ...credentials(body),
          }),
        ),
      );
    }),
  );
  app.delete("/management-api/session/me/totp", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await updateProfile(managementSessionId, (tx) =>
        disableOwnTotp(tx, {
          managementSessionId,
          ...credentials(body),
        }),
      );
      return c.body(null, 204);
    }),
  );
  app.delete("/management-api/session/me/google", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await updateProfile(managementSessionId, (tx) =>
        unlinkOwnGoogle(tx, {
          managementSessionId,
          ...credentials(body),
        }),
      );
      return c.body(null, 204);
    }),
  );

  const readVenueName = async (tx: Transaction): Promise<string> => {
    const venue = await readTenant(tx);
    if (venue === null) throw new Error("Configured tenant does not exist");
    return venue.legalName;
  };

  // No session is required: this exposes only public identity and languages.
  app.get("/management-api/locales", (c) =>
    run(c, log, async () => {
      const venueName = await asStaff(readVenueName);
      c.header("Vary", "Accept-Language");
      return c.json({
        locales: SUPPORTED_LOCALES,
        venueDefault: deps.venueLocale,
        loginDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        venueName,
        onboardingIntent: deps.onboardingIntent,
      });
    }),
  );

  // Role-blind, so a staff session answers `{ role: "staff" }` rather than 403: the dashboard shell
  // probes this to decide between the staff view and the manager screens. `sessionDefault` is
  // derived per request and never stored; an explicit `locale` still wins.
  app.get("/management-api/session/me", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, role, email, locale, venueName, expiresAt } = await asStaff(async (tx) => ({
        ...(await resolveManagementSession(tx, sessionId, { touch: false })),
        venueName: await readVenueName(tx),
      }));
      // This body describes ONE person in ONE browser: it turns on the session cookie AND on
      // Accept-Language, so no cache may keep a copy, and any cache that ignores `no-store` must at
      // least key on the language it varies by.
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      // `permissions` and `modules` are a client-side hint, never a substitute for each route's own
      // gate.
      return c.json({
        personId,
        role,
        email,
        locale,
        venueLocale: deps.venueLocale,
        sessionDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        venueName,
        onboardingIntent: deps.onboardingIntent,
        permissions: permissionsForRole(role),
        modules: deps.modules,
        sessionExpiresInSeconds: Math.min(
          IDLE_TIMEOUT_MS / 1000,
          Math.max(0, Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000)),
        ),
        sessionIdleTimeoutSeconds: IDLE_TIMEOUT_MS / 1000,
      });
    }),
  );

  // A missing or non-string `locale` becomes `""`, which `setPersonLocale` refuses as
  // `locale.unsupported`: the one rejection path.
  app.put("/management-api/session/me/locale", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        await setPersonLocale(tx, { personId, locale });
      });
      return c.body(null, 204);
    }),
  );

  // The passkey offer was settled (added or skipped), so it is never made again. The body is not
  // read.
  app.post("/management-api/session/me/passkey-offer", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        await markPasskeyOffered(tx, { personId });
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/me/schedule/shifts", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listShiftsForPerson(tx, { personId, from, to });
      });
      return c.json(rows);
    }),
  );

  app.get("/management-api/me/schedule/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listSwapsForPerson(tx, { personId });
      });
      return c.json(rows);
    }),
  );

  // `toShiftId` null is a one-sided give-away.
  app.post("/management-api/me/schedule/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const fromShiftId = requireBodyUuid(body.fromShiftId, "fromShiftId");
      const toPersonId = requireBodyUuid(body.toPersonId, "toPersonId");
      const toShiftId = requireNullableBodyUuid(body.toShiftId, "toShiftId");
      const swapId = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return requestSwap(tx, {
          requestedByPersonId: personId,
          fromShiftId,
          toPersonId,
          toShiftId,
        });
      });
      return c.json({ swapId }, 201);
    }),
  );

  app.post("/management-api/me/schedule/swaps/:swapId/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return acceptSwap(tx, { swapId, acceptingPersonId: personId });
      });
      return c.body(null, 204);
    }),
  );

  app.get("/management-api/me/schedule/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listAbsencesForPerson(tx, { personId });
      });
      return c.json(rows);
    }),
  );

  app.post("/management-api/me/schedule/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const kind = requireEnum(body.kind, "kind", absenceKind.enumValues);
      const startsOn = requirePeriod(body.startsOn, "startsOn");
      const endsOn = requirePeriod(body.endsOn, "endsOn");
      const note = requireNullableString(body.note, "note");
      const absenceId = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return createAbsence(tx, {
          personId,
          kind,
          startsOn,
          endsOn,
          note,
        });
      });
      return c.json({ absenceId }, 201);
    }),
  );
}

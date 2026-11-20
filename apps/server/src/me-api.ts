import type { KeyRing } from "@waitron/credentials";
import { admitsInspector } from "./inspector-admission.js";
import type { WaitronModule } from "@waitron/module";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { readTaxpayer, withTransaction, type Database, type Transaction } from "@waitron/db";
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
  beginOwnPasskeyCheck,
  IDLE_TIMEOUT_MS,
  markPasskeyOffered,
  resolveManagementSession,
  setPersonLocale,
  readOwnProfile,
  readPasskeySignals,
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
} from "@waitron/identity";
import { SUPPORTED_LOCALES, AppError } from "@waitron/shared";
import { resolveLoginLocale } from "./login-locale.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { confirmFreshSignIn } from "./fresh-sign-in.js";
import { managementSite } from "./request-from-box.js";
import { passkeyVerifySite, venuePasskeyOrigins } from "./passkey-origins.js";
import { ownPasswordChanges } from "./own-password-ahead.js";
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
import type { TradingAdmissionView } from "./trading-admission.js";
import type { OnboardingIntent } from "./trading-config.js";
import type { EmailDelivery } from "./email-delivery.js";

export interface MeApiDeps {
  db: Database;
  readTradingAdmission?: () => TradingAdmissionView;
  describeShifts?: WaitronModule["describeShifts"];
  /** The language the dashboard defaults to before a signed-in person's own preference is known. */
  venueLocale: string;
  /** The setup journey that created this installation, shown persistently by the dashboard. */
  onboardingIntent?: OnboardingIntent;
  simulatedCardPayments?: boolean;
  /** The enabled module names, `core` included. */
  modules: string[];
  credentialKeyRing: KeyRing;
  rpId?: string;
  origin?: string;
  accountMailMode?: (tx: Transaction) => Promise<EmailDelivery["mode"] | "cloud">;
  assertAccountMailPrimary?: () => Promise<void>;
}

const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "password.too_short": 400,
  "password.throttled": 429,
  "totp.invalid": 401,
  "pin.too_short": 400,
  "passkey.not_registered": 404,
  "person.email_taken": 409,
  "person.last_admin": 409,
  "person.email_invalid": 400,
  "person.telephone_invalid": 400,
  "person.display_name_taken": 409,
  "profile.invalid": 400,
  "node.read_only": 403,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  "locale.unsupported": 400,
  "management.request_invalid": 400,
  "shared.invalid_id": 400,
  "absence.invalid": 400,
  // Raised here only by requestSwap, for a shift id the request body names.
  "shift.not_found": 400,
  "swap.not_found": 404,
  "swap.not_permitted": 403,
  "swap.return_shift_not_owned": 400,
  "swap.not_acceptable": 409,
  "absence.overlaps": 409,
};

const run = createErrorBoundary(STATUS, "me.failed");
// This route names no passkey, so a person holding none clashes with their stored record: 409.
// The shared 404 stays for DELETE /passkeys/:id, whose path names one.
const runPasskeyOptions = createErrorBoundary(
  { ...STATUS, "passkey.not_registered": 409 },
  "me.failed",
);

/**
 * Staff self-service routes. Every route acts as the person its management session names, never
 * one the request body names. Never `authorizeManager`: a `staff` person
 * holds none of the permissions the management routes ask for, so that gate would refuse every
 * staff member.
 */
export function mountMeApi(app: Hono, deps: MeApiDeps, log: Logger): void {
  const credentialKeyRing = deps.credentialKeyRing;
  const profileThrottle = createPasswordThrottle();
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTransaction(deps.db, async (tx) => {
      return fn(tx);
    });

  const proofThrottle = createPasswordThrottle();
  const proofSite = { rpId: deps.rpId ?? "localhost", origin: deps.origin ?? "http://localhost" };
  const passkeyOrigins = venuePasskeyOrigins(deps.db, proofSite.origin);
  app.post("/management-api/session/me/fresh-sign-in", admitsInspector, (c) =>
    run(c, log, async () => {
      const token = requireManagementSession(c);
      await confirmFreshSignIn(
        {
          db: deps.db,
          throttle: proofThrottle,
          keyRing: credentialKeyRing,
          passkeySite: () => passkeyVerifySite(c, proofSite, passkeyOrigins),
        },
        token,
        await readJsonBody<unknown>(c),
      );
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/session/me/fresh-sign-in/passkey-options", admitsInspector, (c) =>
    runPasskeyOptions(c, log, async () => {
      const token = requireManagementSession(c);
      const result = await asStaff((tx) =>
        beginOwnPasskeyCheck(tx, {
          managementSessionId: token,
          rpId: managementSite(c, proofSite).rpId,
        }),
      );
      return c.json(result);
    }),
  );

  const changeAccount = ownPasswordChanges(deps.db, profileThrottle);
  const updateProfile: typeof changeAccount = (token, input, change) =>
    changeAccount(token, input, change, false);
  const textField = (body: Record<string, unknown>, field: string): string => {
    if (typeof body[field] !== "string")
      throw new AppError("management.request_invalid", { field });
    return body[field];
  };
  const credentials = (body: Record<string, unknown>) => ({
    totp: body.totp === undefined ? undefined : textField(body, "totp"),
    keyRing: credentialKeyRing,
  });

  app.get("/management-api/session/me/profile", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const profile = await asStaff(async (tx) => {
        const profile = await readOwnProfile(tx, { managementSessionId });
        const signals = await readPasskeySignals(tx, { managementSessionId });
        return {
          ...profile,
          passkeySignals: { rpId: managementSite(c, proofSite).rpId, ...signals },
        };
      });
      return c.json(profile);
    }),
  );
  app.put("/management-api/session/me/profile", admitsInspector, (c) =>
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
      const { changed, mode } = await updateProfile(
        managementSessionId,
        () => input,
        async (tx, change) => {
          const person = await resolveManagementSession(tx, managementSessionId, { touch: false });
          if (change.email.trim().toLowerCase() !== person.email)
            await deps.assertAccountMailPrimary?.();
          const mode = (await deps.accountMailMode?.(tx)) ?? "unconfigured";
          const changed = await saveOwnProfile(tx, {
            ...change,
            queueEmailChange: mode !== "unconfigured",
          });
          return { changed, mode };
        },
      );
      if (changed === null) return c.json({ emailVerificationSent: false });
      if (mode === "unconfigured")
        return c.json({
          emailVerificationSent: false,
          problem: "email.unconfigured",
          uncertain: false,
        });
      return c.json({
        emailVerificationSent: true,
        delivery: mode === "local_capture" ? "captured" : "queued",
      });
    }),
  );
  app.post("/management-api/session/me/profile/email/confirm", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const email = await asStaff((tx) =>
        confirmOwnEmailChange(tx, {
          managementSessionId,
          code: textField(body, "code"),
          keyRing: deps.credentialKeyRing,
        }),
      );
      if (email === null) throw new AppError("account_action.invalid", {});
      return c.json({ email });
    }),
  );
  app.put("/management-api/session/me/password", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        password: textField(body, "password"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, () => input, changeOwnPassword);
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
      await updateProfile(managementSessionId, () => input, changeOwnPin);
      return c.body(null, 204);
    }),
  );
  app.delete("/management-api/session/me/passkeys/:id", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        managementSessionId,
        id: requireUuidParam(c.req.param("id"), "passkey"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, () => input, removeOwnPasskey);
      return c.body(null, 204);
    }),
  );
  app.post("/management-api/session/me/totp/begin", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      return c.json(
        await updateProfile(managementSessionId, () => credentials(body), beginOwnTotpEnrollment),
      );
    }),
  );
  app.post("/management-api/session/me/totp/finish", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const result = await updateProfile(
        managementSessionId,
        () => ({
          enrollmentId: requireBodyUuid(body.enrollmentId, "enrollmentId"),
          code: textField(body, "code"),
          keyRing: credentialKeyRing,
        }),
        finishOwnTotpEnrollment,
      );
      return c.json(result);
    }),
  );
  app.post("/management-api/session/me/recovery-codes", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      return c.json(
        await updateProfile(
          managementSessionId,
          () => credentials(body),
          regenerateOwnRecoveryCodes,
        ),
      );
    }),
  );
  app.delete("/management-api/session/me/totp", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await updateProfile(managementSessionId, () => credentials(body), disableOwnTotp);
      return c.body(null, 204);
    }),
  );
  app.delete("/management-api/session/me/google", admitsInspector, (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      await updateProfile(managementSessionId, () => credentials(body), unlinkOwnGoogle);
      return c.body(null, 204);
    }),
  );

  const readVenueName = async (tx: Transaction): Promise<string> => {
    const venue = await readTaxpayer(tx);
    if (venue === null) throw new Error("Configured taxpayer does not exist");
    return venue.legalName;
  };

  // No session is required: this exposes only public identity and languages.
  app.get("/management-api/locales", (c) =>
    run(c, log, async () => {
      const venueName = await deps.db.withWriteLock(() => readVenueName(deps.db));
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

  app.get("/management-api/session/me", admitsInspector, (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, authority, email, locale, venueName, expiresAt } =
        await deps.db.withWriteLock(async () => {
          const tx = deps.db;
          const session = await resolveManagementSession(tx, sessionId, { touch: false });
          return {
            ...session,
            venueName: await readVenueName(tx),
          };
        });
      // This body describes ONE person in ONE browser: it turns on the session cookie AND on
      // Accept-Language, so no cache may keep a copy, and any cache that ignores `no-store` must at
      // least key on the language it varies by.
      c.header("Cache-Control", "no-store");
      c.header("Vary", "Accept-Language");
      // `permissions` and `modules` are a client-side hint, never a substitute for each route's own
      // gate.
      return c.json({
        ...(deps.readTradingAdmission === undefined
          ? {}
          : { tradingAdmission: deps.readTradingAdmission() }),
        personId,
        roleIds: authority.roleIds,
        email,
        locale,
        venueLocale: deps.venueLocale,
        sessionDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
        venueName,
        onboardingIntent: deps.onboardingIntent,
        simulatedCardPayments: deps.simulatedCardPayments === true,
        permissions: [...authority.permissions],
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
  app.put("/management-api/session/me/locale", admitsInspector, (c) =>
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
  app.post("/management-api/session/me/passkey-offer", admitsInspector, (c) =>
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
        const shifts = await listShiftsForPerson(tx, { personId, from, to });
        const descriptions = await deps.describeShifts?.(
          tx,
          shifts.map((shift) => shift.id),
        );
        return shifts.map((shift) => ({
          ...shift,
          description: descriptions?.get(shift.id) ?? null,
        }));
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

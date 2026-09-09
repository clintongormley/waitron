import type { Hono } from "hono";
import { randomBytes } from "node:crypto";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { eq } from "drizzle-orm";
import { asAppUser, tenants, withTenant, type Database, type Transaction } from "@waitron/db";
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
  resolveManagementSession,
  IDLE_TIMEOUT_MS,
  setPersonLocale,
  readOwnProfile,
  saveOwnProfile,
  changeOwnPassword,
  changeOwnPin,
  removeOwnPasskey,
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  regenerateOwnRecoveryCodes,
} from "@waitron/identity";
import { SUPPORTED_LOCALES, AppError, isAppError } from "@waitron/shared";
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

/**
 * The deployment holds one tenant per database. The deps the "me" API needs — the SAME minimal
 * shape `mountScheduleApi` takes: no fiscal backend, clock or card provider, because these routes
 * touch only the identity session (`management_sessions`) and the planning tables
 * (`shifts`/`shift_swaps`/`absences`). `cfg.tenantId` is this venue's tenant, scoping every
 * `withTenant` below.
 */
export interface MeApiDeps {
  db: Database;
  /**
   * `tenantId` scopes every `withTenant` below. `nodeId` is this node's id, carried on the uniform
   * write-path `cfg` shape every mounted API takes; it no longer stamps a capture origin (the
   * application outbox and its capture triggers were removed).
   */
  cfg: { tenantId: string; nodeId: string };
  /**
   * The venue's DEFAULT UI locale, derived ONCE at boot (`readVenueLocale`, boot.ts). Surfaced by the
   * public `GET /management-api/locales` as `venueDefault` — the language the dashboard defaults to
   * before a signed-in person's own preference is known.
   */
  venueLocale: string;
  /** The setup journey that created this installation, shown persistently by the dashboard. */
  onboardingIntent?: OnboardingIntent;
  /**
   * The ENABLED module names on this node — boot's `setsToMigrate.map(m => m.name)`, which includes the
   * always-on `core` (harmlessly: the dashboard's browser registry only matches UI-bearing ids).
   * Surfaced by `GET /session/me` as `modules` so the dashboard shows a module's nav/screen only when
   * the module is enabled AND the signed-in person holds its permission — the two runtime gates.
   */
  modules: string[];
  credentialKey?: Buffer;
}

/**
 * Every AppError code the me API answers, and its HTTP status — the management-session twin of
 * `schedule-api.ts`'s `STATUS`, differing only in the session family: this surface is gated by a
 * MANAGEMENT session, so a missing/forged cookie or a session naming no live row is
 * `management_session.required` (401), an idled-out one `management_session.expired` (401), and a
 * mid-session suspension `person.suspended` (403) — the three faults `requireManagementSession` +
 * `resolveManagementSession` raise (identity's own codes). The request-shape and swap/absence domain
 * codes are identical to the till schedule surface (the shared `request-screens.ts` screens and the
 * #90 verbs), so their statuses match: a malformed body/query field is `management.request_invalid`
 * 400 and a malformed path `:swapId` is `shared.invalid_id` 400; an inverted absence range is
 * `absence.invalid` 400; `swap.not_permitted` is 403, `swap.not_acceptable`/`absence.overlaps` 409,
 * the `not_found` pair 404. A registered code absent here defaults to 400; the client codes are
 * enumerated anyway so this map is the surface's whole 4xx contract.
 */
const STATUS: Record<string, ContentfulStatusCode> = {
  "password.invalid": 401,
  "password.throttled": 429,
  "totp.invalid": 401,
  "passkey.not_registered": 404,
  "person.email_taken": 409,
  "management_session.required": 401,
  "management_session.expired": 401,
  "person.suspended": 403,
  // The signed-in person picked an unsupported UI language on `PUT /management-api/session/me/locale`
  // — a request-shape fault, 400. Thrown by `setPersonLocale`'s `assertSupportedLocale` (identity).
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
 * Mounts the STAFF SELF-SERVICE routes on the management dashboard's HTTP surface (prefixes
 * `/management-api/session/me` and `/management-api/me/schedule`) — the browser twin of
 * `apps/till`'s till-PIN-gated `mountScheduleApi`. Every route resolves the requester from the
 * MANAGEMENT SESSION (`requireManagementSession` → `resolveManagementSession` → `personId`) FIRST
 * and passes THAT `personId` into the #90 verb; the request body is NEVER trusted for identity
 * (the crux of this surface — a staff member acts only as themselves). It is deliberately
 * ROLE-BLIND: it calls `resolveManagementSession` (which returns `personId` + `role` but gates
 * only on idle-timeout + suspension), NEVER `authorizeManager` — a `staff`-role person holds an
 * EMPTY permission set, so an `authorizeManager` gate would 403 every staff person, defeating the
 * whole surface. The verb then runs on the app role under this venue's tenant (`withTenant` +
 * `asAppUser`), in the database holding this tenant. The explicit `person_id` predicate scopes
 * the operation to the requester.
 */
export function mountMeApi(app: Hono, deps: MeApiDeps, log: Logger): void {
  const credentialKey = deps.credentialKey ?? randomBytes(32);
  const profileThrottle = createPasswordThrottle();
  /** Run `fn` on the app role under this venue's tenant — the one place the withTenant/asAppUser pair
   * is expressed, so no route re-implements it. */
  const asStaff = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> =>
    withTenant(deps.db, deps.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      return fn(tx);
    });

  const updateProfile = async (
    sessionId: string,
    fn: (tx: Transaction) => Promise<void>,
  ): Promise<void> => {
    const finish = profileThrottle.begin(sessionId);
    try {
      await asStaff(fn);
    } catch (error) {
      finish(
        isAppError(error) && (error.code === "password.invalid" || error.code === "totp.invalid")
          ? "invalid"
          : "error",
      );
      throw error;
    }
    finish("success");
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
  });

  app.get("/management-api/session/me/profile", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      return c.json(
        await asStaff((tx) =>
          readOwnProfile(tx, { tenantId: deps.cfg.tenantId, managementSessionId }),
        ),
      );
    }),
  );
  app.put("/management-api/session/me/profile", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        tenantId: deps.cfg.tenantId,
        managementSessionId,
        displayName: textField(body, "displayName"),
        firstNames: textField(body, "firstNames"),
        lastNames: textField(body, "lastNames"),
        telephone: body.telephone === null ? null : textField(body, "telephone"),
        email: textField(body, "email"),
        locale: textField(body, "locale"),
        ...credentials(body),
      };
      await updateProfile(managementSessionId, (tx) => saveOwnProfile(tx, input));
      return c.body(null, 204);
    }),
  );
  app.put("/management-api/session/me/password", (c) =>
    run(c, log, async () => {
      const managementSessionId = requireManagementSession(c);
      const body = await readJsonBody<Record<string, unknown>>(c);
      const input = {
        tenantId: deps.cfg.tenantId,
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
        tenantId: deps.cfg.tenantId,
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
        tenantId: deps.cfg.tenantId,
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
        await asStaff((tx) =>
          beginOwnTotpEnrollment(tx, {
            tenantId: deps.cfg.tenantId,
            managementSessionId,
            encryptionKey: credentialKey,
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
      const result = await asStaff((tx) =>
        finishOwnTotpEnrollment(tx, {
          tenantId: deps.cfg.tenantId,
          managementSessionId,
          enrollmentId: requireBodyUuid(body.enrollmentId, "enrollmentId"),
          code: textField(body, "code"),
          encryptionKey: credentialKey,
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
        await asStaff((tx) =>
          regenerateOwnRecoveryCodes(tx, {
            tenantId: deps.cfg.tenantId,
            managementSessionId,
            encryptionKey: credentialKey,
            ...credentials(body),
          }),
        ),
      );
    }),
  );

  /** Read the configured tenant's public display identity inside the same tenant-scoped app-role
   * transaction as its caller. A missing row means the boot configuration names no tenant. */
  const readVenueName = async (tx: Transaction): Promise<string> => {
    const [venue] = await tx
      .select({ venueName: tenants.legalName })
      .from(tenants)
      .where(eq(tenants.id, deps.cfg.tenantId));
    if (venue === undefined) throw new Error("Configured tenant does not exist");
    return venue.venueName;
  };

  // The public supported-locale list + the venue's default UI locale. Deliberately UNAUTHENTICATED
  // (the dashboard shell fetches it before login to pick its language and label the installation)
  // and free of secrets — `locales` is the static catalogue, `venueDefault` the geography-derived
  // boot value (`deps.venueLocale`), and `venueName` the tenant's legal name. NO management-session
  // gate, the browser twin of the till's `GET /api/locales`.
  app.get("/management-api/locales", (c) =>
    run(c, log, async () => {
      const venueName = await asStaff(readVenueName);
      return c.json({
        locales: SUPPORTED_LOCALES,
        venueDefault: deps.venueLocale,
        venueName,
        onboardingIntent: deps.onboardingIntent,
      });
    }),
  );

  // The deployment holds one tenant per database. Whoami: who is signed into this browser, with
  // what role and in which language. `requireManagementSession` screens the cookie's SHAPE (401
  // before any DB work), then `resolveManagementSession` re-reads the live session + the person's
  // current role, status and `locale` in this database (a suspended person 403s here).
  // Role-blind: NO `authorizeManager`, so a staff session answers `{ role: "staff" }` rather than
  // 403 — this is the endpoint the dashboard shell probes to decide whether to open the staff
  // view or the manager screens. `locale` is the signed-in person's OWN UI-language preference
  // (`persons.locale`, null when unset); `venueLocale` is the geography-derived boot default
  // (`deps.venueLocale`) the dashboard falls back to when that preference is null — the same
  // value `GET /management-api/locales` echoes as `venueDefault`.
  app.get("/management-api/session/me", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const { personId, role, locale, venueName } = await asStaff(async (tx) => ({
        ...(await resolveManagementSession(tx, sessionId)),
        venueName: await readVenueName(tx),
      }));
      // `permissions` is the signed-in person's EFFECTIVE set (core catalog + registered module
      // permissions, folded through identity's ladder) and `modules` the enabled-module names — a
      // client-side HINT the dashboard gates a module's nav/screen on, NEVER a substitute for the
      // server-side gate each route still enforces.
      return c.json({
        personId,
        role,
        locale,
        venueLocale: deps.venueLocale,
        venueName,
        onboardingIntent: deps.onboardingIntent,
        permissions: permissionsForRole(role),
        modules: deps.modules,
        sessionExpiresInSeconds: IDLE_TIMEOUT_MS / 1000,
      });
    }),
  );

  // Set the SIGNED-IN person's OWN UI-language preference (`persons.locale`) — the dashboard twin of the
  // till's `PUT /api/session/locale`. Identity is the SESSION's person (`resolveManagementSession`'s
  // `personId`, resolved INSIDE `asStaff`), NEVER a body field: the body carries `locale` and nothing
  // else, so a hostile `personId` in it is ignored and a person can only set their own locale. Read via
  // `readJsonBody`, so an empty/malformed/`null` body coerces to `{}` (never an opaque 500); the body
  // then flows through the same `locale` coercion below, so a missing/non-string/unparsable `locale`
  // all coerce to `""`, which `setPersonLocale`'s `assertSupportedLocale` rejects as `locale.unsupported`
  // (400) — the ONE rejection path, no separate request-invalid branch and never an opaque
  // `server.internal` 500. Returns 204 (no body), matching the accept/other 204 verbs on this surface.
  app.put("/management-api/session/me/locale", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        await setPersonLocale(tx, { tenantId: deps.cfg.tenantId, personId, locale });
      });
      return c.body(null, 204);
    }),
  );

  // The requester's OWN shifts over a half-open [from, to) local-date window.
  app.get("/management-api/me/schedule/shifts", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const from = requirePeriod(c.req.query("from"), "from");
      const to = requirePeriod(c.req.query("to"), "to");
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listShiftsForPerson(tx, { tenantId: deps.cfg.tenantId, personId, from, to });
      });
      return c.json(rows);
    }),
  );

  // The swaps the requester is party to (offered to them, or requested by them).
  app.get("/management-api/me/schedule/swaps", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listSwapsForPerson(tx, { tenantId: deps.cfg.tenantId, personId });
      });
      return c.json(rows);
    }),
  );

  // Request a swap: offer one of MY shifts to a colleague (`toShiftId` null = a one-sided give-away).
  // The requester is the session's person — never a body field.
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
          tenantId: deps.cfg.tenantId,
          requestedByPersonId: personId,
          fromShiftId,
          toPersonId,
          toShiftId,
        });
      });
      return c.json({ swapId }, 201);
    }),
  );

  // Accept a swap offered TO me — the acceptor is the session's person, so only the named recipient
  // can accept (acceptSwap's own guard).
  app.post("/management-api/me/schedule/swaps/:swapId/accept", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const swapId = requireUuidParam(c.req.param("swapId"), "SwapId");
      await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return acceptSwap(tx, { tenantId: deps.cfg.tenantId, swapId, acceptingPersonId: personId });
      });
      return c.body(null, 204);
    }),
  );

  // The requester's OWN absences (every status).
  app.get("/management-api/me/schedule/absences", (c) =>
    run(c, log, async () => {
      const sessionId = requireManagementSession(c);
      const rows = await asStaff(async (tx) => {
        const { personId } = await resolveManagementSession(tx, sessionId);
        return listAbsencesForPerson(tx, { tenantId: deps.cfg.tenantId, personId });
      });
      return c.json(rows);
    }),
  );

  // Request an absence for MYSELF — the person is the session's, never a body field.
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
          tenantId: deps.cfg.tenantId,
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

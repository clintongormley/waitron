import { withTransaction, tillSessions, readNodeMembership } from "@waitron/db";
import {
  type PinThrottle,
  loginWithPin,
  endSession,
  setPersonLocale,
  listActiveStaff,
  listStaffAdmittedTo,
} from "@waitron/identity";
import { isSharedDisplay } from "@waitron/layouts";
import { routableServers } from "@waitron/membership";
import { type Logger, readJsonBody } from "@waitron/server-kit";
import { AppError, isAppError, PERSON_HEADER, SUPPORTED_LOCALES } from "@waitron/shared";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import {
  requireDeviceProof,
  assertDeviceStillProven,
  DEV_DEVICE_HEADER,
  tryReadDevice,
} from "./device-session.js";
import { resolveLoginLocale } from "./login-locale.js";
import { inPinTurn, withPinCheckAhead } from "./pin-check-ahead.js";
import { run } from "./till-api-errors.js";
import type { TillApiDeps } from "./till-api-deps.js";
import {
  canonicaliseUuid,
  setSessionCookie,
  readSessionToken,
  openSessionPerson,
  personRefusal,
  clearSessionCookie,
  requireSession,
  assertRequestDevice,
} from "./till-session.js";
import { completeTillSetup, readTillSetup, setupRevisionOf } from "./till-setup.js";

export function mountTillSessionRoutes(
  app: Hono,
  deps: TillApiDeps,
  log: Logger,
  pinThrottle: PinThrottle,
): void {
  // Device-gated: the throttle keys on the authenticated device, so dropping the cookie cannot
  // evade it.
  app.post("/api/session", (c) =>
    run(c, log, async () => {
      const { personId: rawPersonId, pin } = await readJsonBody<{
        personId: string;
        pin?: unknown;
      }>(c);
      // Canonicalised before it keys the throttle and the lookup: the throttle keys on the string,
      // and the `text` id column folds no spellings (`canonicaliseUuid`).
      const personId = canonicaliseUuid(rawPersonId);
      // Not throttled: this id never reaches the lookup, so no PIN is being tried against anyone.
      if (personId === null) throw new AppError("pin.invalid", {}, { reason: "malformed" });
      const proof = await requireDeviceProof(deps, c);
      const { device } = proof;
      pinThrottle.check(device.deviceId, personId);
      const attempts = { throttle: pinThrottle, slot: device.deviceId };
      if (typeof pin !== "string") {
        // In turn, so it is counted after the attempts already being checked, not before them.
        return inPinTurn(attempts, personId, async () => {
          pinThrottle.check(device.deviceId, personId);
          pinThrottle.recordFailure(device.deviceId, personId);
          throw new AppError("pin.invalid", {}, { reason: "malformed" });
        });
      }
      const session = await withPinCheckAhead(
        deps.db,
        { personId, pin },
        attempts,
        async (checked) => {
          pinThrottle.check(device.deviceId, personId);
          try {
            const opened = await withTransaction(deps.db, async (tx) => {
              const current = await assertDeviceStillProven(tx, proof);
              if (isSharedDisplay(device.formFactor) !== isSharedDisplay(current.formFactor))
                throw new AppError("device.forbidden_action", { action: "sign_in" });
              const opened = await loginWithPin(tx, {
                deviceId: device.deviceId,
                personId,
                pin,
                checked,
              });
              if (deps.attendance !== undefined) {
                const [stored] = await tx
                  .select({ openedAt: tillSessions.openedAt })
                  .from(tillSessions)
                  .where(eq(tillSessions.id, opened.id));
                await deps.attendance(tx, {
                  source: "session",
                  key: opened.id,
                  personId: opened.personId,
                  kind: "sign-in",
                  at: stored!.openedAt,
                  offsetMinutes: 0,
                  outcome: "qualified",
                });
              }
              return opened;
            });
            pinThrottle.clear(device.deviceId, personId);
            return opened;
          } catch (err) {
            if (isAppError(err) && err.code === "pin.invalid") {
              pinThrottle.recordFailure(device.deviceId, personId);
            }
            throw err;
          }
        },
      );
      setSessionCookie(c, session.token, deps.secureCookies);
      // Display only: the server checks each permission itself, so a tampered client list grants
      // nothing.
      return c.json({
        personId: session.personId,
        permissions: [...session.authority.permissions],
        locale: session.locale,
      });
    }),
  );

  // A sign-out carrying the person header never clears the cookie: its answer can reach the browser after the
  // next person's sign-in has replaced it.
  app.delete("/api/session", (c) =>
    run(c, log, async () => {
      const carriesPersonHeader = c.req.header(PERSON_HEADER) !== undefined;
      const chosen =
        c.req.header(DEV_DEVICE_HEADER) === undefined
          ? null
          : await requireDeviceProof(deps, c, { passive: true });
      const token = readSessionToken(c);
      if (token !== null)
        await withTransaction(deps.db, async (tx) => {
          const holder = await openSessionPerson(tx, token, chosen?.device.deviceId);
          if (holder === null) return;
          const refusal = personRefusal(c, holder);
          if (refusal !== null) throw refusal;
          await endSession(tx, token);
        });
      if (!carriesPersonHeader) clearSessionCookie(c);
      return c.json({ ok: true });
    }),
  );

  // The session, not the body, names the person, so an operator can set only their own locale. A
  // missing or non-string `locale` becomes "", refused as `locale.unsupported`.
  app.put("/api/session/locale", (c) =>
    run(c, log, async () => {
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const { personId } = session;
      const body = await readJsonBody<{ locale?: unknown }>(c);
      const locale = typeof body.locale === "string" ? body.locale : "";
      await withTransaction(deps.db, async (tx) => {
        await setPersonLocale(tx, { personId, locale });
      });
      return c.body(null, 204);
    }),
  );

  // Deliberately unauthenticated: the lock screen's roster. No PIN material, role or status. A
  // request that identifies a device lists only the people its profile admits, unless it asks for
  // `everyone`, as a roster of colleagues does: that is the list a request with no device gets.
  app.get("/api/staff", (c) =>
    run(c, log, async () => {
      // Resolve the device before this turn: a due sighting takes a turn of its own.
      const device = c.req.query("everyone") === "true" ? null : await tryReadDevice(deps, c);
      const staff = await deps.db.withWriteLock(async () => {
        const tx = deps.db;
        return device === null
          ? listActiveStaff(tx)
          : listStaffAdmittedTo(tx, device.deviceProfileId);
      });
      return c.json(staff);
    }),
  );

  // Unauthenticated boot info the till needs before login; it carries no secrets.
  app.get("/api/till", (c) =>
    run(c, log, async () => {
      // Resolve the device before this turn: a due sighting takes a turn of its own.
      const device = await tryReadDevice(deps, c);
      const held = await readNodeMembership(deps.db);
      const setup = completeTillSetup(
        await deps.db.withWriteLock(() => readTillSetup(deps.db, deps, device)),
        deps.cloudEmergency?.() ?? null,
      );
      return c.json({
        ...setup,
        setupRevision: setupRevisionOf(setup),
        servers: routableServers(held),
        membership: held,
      });
    }),
  );

  // Unauthenticated: the till fetches it before login.
  app.get("/api/locales", (c) =>
    run(c, log, async () => {
      c.header("Vary", "Accept-Language");
      return c.json({
        locales: SUPPORTED_LOCALES,
        venueDefault: deps.venueLocale,
        loginDefault: resolveLoginLocale(c.req.header("Accept-Language"), deps.venueLocale),
      });
    }),
  );
}

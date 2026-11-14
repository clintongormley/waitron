import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { devices, withTransaction, type Database, type Transaction } from "@waitron/db";
import type { ClockAdminConfirm, FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { CLOCK_WITNESS_MARGIN_MS } from "@waitron/fiscal";
import {
  authorize,
  canUseDeviceProfile,
  holds,
  readPersonAuthority,
  type PinAttempts,
} from "@waitron/identity";
import { codeOf, createErrorBoundary, readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { clockSetBody, requiredNameOf } from "./box-health-api.js";
import { clockChallenges } from "./clock-challenges.js";
import {
  EARLIEST_TARGET_MS,
  LATEST_TARGET_MS,
  wallMovedAgainstSteady,
  type ClockSetRefusal,
  type clockCorrection,
} from "./clock-correction.js";
import type { ClockStartUp } from "./clock-start-up.js";
import type { Logger } from "./logger.js";
import type { ChainHeads, StartClockState } from "./start-clock-check.js";
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestAddress, requestFromBox } from "./request-from-box.js";
import { parseOverrideField } from "./till-api.js";
import {
  assertRequestDevice,
  assertStillSignedIn,
  requireSession,
  SESSION_STATUS,
} from "./till-session.js";

export interface TillBoxClockDeps {
  correction: Pick<ReturnType<typeof clockCorrection>, "inTurn" | "set" | "steps">;
  startUp: Pick<ClockStartUp, "noStop" | "admit">;
  /** Times each challenge; never stepped by a change of the wall clock. */
  steady: () => number;
  requestFromBox?: (c: Context) => boolean;
  /** The start's clock check. Until it is confirmed by the internet, staff are admitted whatever
   * the start-up window says (plan A1420 D1). */
  start?: {
    state: Pick<StartClockState, "status" | "confirm" | "mark">;
    heads(tx: Transaction): Promise<ChainHeads>;
  };
}

const run = createErrorBoundary(
  {
    ...SESSION_STATUS,
    "session.not_open": 401,
    "device.unauthorized": 403,
    "device_profile.not_admitted": 403,
    "person.suspended": 403,
    "pin.invalid": 401,
    "pin.throttled": 429,
    "authorization.not_permitted": 403,
    "clock.set_refused": 409,
    "clock.check_expired": 400,
    "clock.set_failed": 502,
    "management.request_invalid": 400,
  },
  "box-clock.failed",
);

type Session = Awaited<ReturnType<typeof requireSession>>;

function refuse(
  reason:
    | Exclude<ClockSetRefusal, "not_admitted" | "refused" | "unverified">
    | "same_machine"
    | "stopped",
): never {
  throw new AppError("clock.set_refused", { reason });
}

/** `keep: true` confirms the box's time as it stands, whatever the till's reading. */
function keepOf(body: unknown): boolean {
  const keep =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as { keep?: unknown }).keep
      : undefined;
  if (keep !== undefined && typeof keep !== "boolean")
    throw new AppError("management.request_invalid", { field: "keep" });
  return keep === true;
}

function overrideOf(body: unknown): { personId: string; pin: string } | undefined {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? parseOverrideField((body as { override?: unknown }).override)
    : undefined;
}

/** "Check the time" on a till: `POST /api/box-clock/challenge` and `POST /api/box-clock/confirm`
 * (plan decision 15). Any staff member the till's profile admits, during the start-up window or
 * until the internet confirms the start; an administrator, signed in or by PIN, while the start
 * waits or the clock reads before 28-10-2024.
 * Refused on the box itself. */
export function mountTillBoxClockApi(
  app: Hono,
  deps: {
    db: Database;
    backend: FiscalBackend;
    clock: TrustedClock;
    devMode: boolean;
    attemptsFor: (deviceId: string) => PinAttempts;
    boxClock: TillBoxClockDeps;
  },
  log: Logger,
): void {
  const { db, backend, clock, boxClock } = deps;
  const correction = boxClock.correction;
  const challenges = clockChallenges({
    steady: boxClock.steady,
    wall: () => clock.now().instant.getTime(),
  });

  // Slice 9's rule: the box's own screen is never a witness to its clock.
  const refuseOnTheBox = (c: Context) => {
    if (!deps.devMode && (boxClock.requestFromBox ?? requestFromBox)(c)) refuse("same_machine");
  };
  const start = boxClock.start;
  const startWaits = () => start?.state.status === "waiting";
  /** Before the internet confirms the start, staff are admitted whatever the window says. */
  const beforeInternet = () => start !== undefined && start.state.status !== "by_internet";
  const admitStaff = () => (beforeInternet() ? null : boxClock.startUp.admit());

  /** The till's label, or `device_profile.not_admitted` when its profile no longer admits the
   * session's person. */
  async function admitted(tx: Transaction, session: Session): Promise<string> {
    await assertStillSignedIn(tx, session);
    const [device] = await tx
      .select({ label: devices.label, profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, session.deviceId));
    if (device === undefined) throw new AppError("device.unauthorized", {});
    if (!(await canUseDeviceProfile(tx, device.profileId, session.personId)))
      throw new AppError("device_profile.not_admitted", {});
    return device.label;
  }

  async function holdsAdmin(tx: Transaction, personId: string): Promise<boolean> {
    return holds(await readPersonAuthority(tx, personId), "system.box_admin");
  }

  function unusableAt(reading: ReturnType<TrustedClock["now"]>): boolean {
    try {
      backend.assertRecordableAt(reading);
      return false;
    } catch (error) {
      if (codeOf(error) === "clock.unusable") return true;
      throw error;
    }
  }

  /** No stop holds: refused, and the start-up window closes for good (plan decision 14). */
  function noStop(): never {
    boxClock.startUp.noStop();
    refuse("not_stopped");
  }

  app.post("/api/box-clock/challenge", (c) =>
    run(c, log, async () => {
      refuseOnTheBox(c);
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      // The PIN is checked by the confirm; here an override only says an administrator is asking.
      const override = overrideOf(await readJsonBody<unknown>(c));
      const keepOffered = await withTransaction(db, async (tx) => {
        await admitted(tx, session);
        const unusable = unusableAt(clock.now());
        // A waiting start is itself what is checked: no stop need hold. A keep cannot lift the
        // clock before 28-10-2024, so it is not offered then.
        if (startWaits()) return !unusable;
        const asAdmin = override !== undefined || (await holdsAdmin(tx, session.personId));
        if (!unusable) noStop();
        if (asAdmin) return false;
        const refusal = admitStaff();
        if (refusal !== null) refuse(refusal);
        return false;
      });
      const { challengeId, boxAt } = challenges.issue(session.sessionId);
      return c.json(
        {
          challengeId,
          boxAt: new Date(boxAt).toISOString(),
          ...(keepOffered ? { keepOffered: true } : {}),
        },
        200,
      );
    }),
  );

  app.post("/api/box-clock/confirm", (c) =>
    run(c, log, async () => {
      refuseOnTheBox(c);
      const session = await requireSession(deps, c);
      await assertRequestDevice(deps, c, session);
      const raw = await readRawJsonBody<unknown>(c);
      const { challengeId, deviceAt } = clockSetBody(raw);
      const override = overrideOf(raw);
      const keep = keepOf(raw);
      const asAdmin = await withTransaction(db, async (tx) => {
        await admitted(tx, session);
        return override !== undefined || (await holdsAdmin(tx, session.personId));
      });
      const attempts = deps.attemptsFor(session.deviceId);
      const toCheck = await overrideToCheck(
        db,
        { sessionId: session.sessionId, permission: "system.box_admin" },
        override,
      );
      const authorizeAdmin = (tx: Transaction, checked: Parameters<typeof withCheck>[1]) =>
        authorize(
          tx,
          {
            sessionId: session.sessionId,
            permission: "system.box_admin",
            override: withCheck(override, checked),
          },
          attempts,
        );

      const stepsSeen = correction.steps();
      const reading = clock.now();
      const steadyMs = boxClock.steady();
      const challenge = challenges.take(session.sessionId, challengeId);
      if (challenge === null) throw new AppError("clock.check_expired", {});
      // The till read its clock at the round trip's midpoint, give or take half of it.
      const halfMs = challenge.elapsedMs / 2;
      const boxAtMs = reading.instant.getTime() - halfMs;
      // A keep uses nothing of the till's time.
      if (!keep && !(deviceAt >= EARLIEST_TARGET_MS && deviceAt < LATEST_TARGET_MS))
        refuse("target_invalid");
      const tillReading = {
        boxAt: new Date(Math.round(boxAtMs)).toISOString(),
        witnessAt: new Date(deviceAt).toISOString(),
        uncertaintyMs: Math.ceil(halfMs),
      };
      const address = requestAddress(c) ?? null;
      const person = (
        personId: string,
        personName: string,
        deviceLabel: string,
      ): ClockAdminConfirm => ({
        personId,
        personName,
        reading: tillReading,
        ...(asAdmin ? {} : { role: "staff" as const }),
        device: { deviceId: session.deviceId, deviceLabel, address },
      });

      const agrees =
        Math.abs(deviceAt - boxAtMs) + tillReading.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS;
      const stale = (now: ReturnType<TrustedClock["now"]>) =>
        correction.steps() !== stepsSeen ||
        wallMovedAgainstSteady(
          { wallMs: reading.instant.getTime(), monoMs: steadyMs },
          { wallMs: now.instant.getTime(), monoMs: boxClock.steady() },
        );

      const startConfirmed = (
        personId: string,
        now: ReturnType<TrustedClock["now"]>,
        heads: ChainHeads,
      ) =>
        log("info", "clock_start.confirmed", {
          source: asAdmin ? "admin" : "staff",
          person: personId,
          device: session.deviceId,
          boxAt: now.instant.toISOString(),
          heads,
        });

      if (keep) {
        // The start's own confirmation by a person: it sets nothing, so it writes no row (D3).
        const confirmed = await withPinCheckAhead(db, toCheck, attempts, (checked) =>
          correction.inTurn(() =>
            withTransaction(db, async (tx) => {
              await admitted(tx, session);
              const now = clock.now();
              // A keep confirms the time the challenge showed, so a move since its issue voids it.
              if (
                stale(now) ||
                wallMovedAgainstSteady(challenge.issuedAt, {
                  wallMs: now.instant.getTime(),
                  monoMs: boxClock.steady(),
                })
              )
                refuse("stale");
              // Judged first, so a stop that holds never reaches `noStop()`, which shuts the window.
              if (unusableAt(now)) refuse("stopped");
              // Keeping the box's time is offered only until the internet confirms the start.
              if (start === undefined || start.state.status === "by_internet") noStop();
              const personId = asAdmin
                ? (await authorizeAdmin(tx, checked)).authorizedBy
                : session.personId;
              const heads = await start.heads(tx);
              start.state.confirm("by_person", heads);
              return { personId, now, heads };
            }),
          ),
        );
        startConfirmed(confirmed.personId, confirmed.now, confirmed.heads);
        return c.json(
          { confirmationId: null, stepMs: 0, confirmedAt: confirmed.now.instant.toISOString() },
          200,
        );
      }

      if (agrees) {
        // A waiting start is confirmed by the person; it sets nothing, so it writes no row (D3).
        const confirmed = await withPinCheckAhead(db, toCheck, attempts, (checked) =>
          // Taken around the whole transaction, never inside it: a set in the turn waits for
          // the write lock a transaction holds.
          correction.inTurn(() =>
            withTransaction(db, async (tx) => {
              await admitted(tx, session);
              const now = clock.now();
              // A set landed, or the wall clock stepped, after the reading: the comparison is void.
              if (stale(now)) refuse("stale");
              if (!startWaits()) noStop();
              const personId = asAdmin
                ? (await authorizeAdmin(tx, checked)).authorizedBy
                : session.personId;
              const heads = await start!.heads(tx);
              start!.state.confirm("by_person", heads);
              return { personId, now, heads };
            }),
          ),
        );
        startConfirmed(confirmed.personId, confirmed.now, confirmed.heads);
        return c.json(
          { confirmationId: null, stepMs: 0, confirmedAt: confirmed.now.instant.toISOString() },
          200,
        );
      }

      // A commented decision: the administrator is authorized in a transaction of its own, before
      // the set and outside the correction's turn, because the set holds no transaction while the
      // host moves the clock. An administrator whose `system.box_admin` is withdrawn between the two is
      // still served; the stop is judged again inside the set's own turn either way.
      const personId = asAdmin
        ? (
            await withPinCheckAhead(db, toCheck, attempts, (checked) =>
              withTransaction(db, (tx) => authorizeAdmin(tx, checked)),
            )
          ).authorizedBy
        : session.personId;
      const { personName, deviceLabel } = await withTransaction(db, async (tx) => ({
        personName: await requiredNameOf(tx, personId),
        deviceLabel: await admitted(tx, session),
      }));
      const answer = await correction.set({
        reason: startWaits() ? "start" : "unusable",
        source: asAdmin ? "admin" : "staff",
        offsetMs: Math.round(deviceAt - boxAtMs),
        measuredAt: { wallMs: boxAtMs, monoMs: steadyMs - halfMs },
        stepsSeen,
        // What set the clock is the till alone, which travels as `admin`.
        witnesses: [],
        admin: person(personId, personName, deviceLabel),
        ...(asAdmin
          ? {}
          : {
              admit: async (tx: Transaction) => {
                try {
                  await admitted(tx, session);
                } catch (error) {
                  if (codeOf(error) === "device_profile.not_admitted") return "not_admitted";
                  throw error;
                }
                return admitStaff();
              },
            }),
        requester: {
          source: asAdmin ? "admin" : "staff",
          person: personId,
          device: session.deviceId,
        },
      });
      if (!answer.set) {
        if (answer.reason === "not_stopped") noStop();
        if (answer.reason === "not_admitted") throw new AppError("device_profile.not_admitted", {});
        if (answer.reason === "refused" || answer.reason === "unverified")
          throw new AppError("clock.set_failed", { reason: answer.reason });
        refuse(answer.reason);
      }
      return c.json(
        {
          confirmationId: answer.confirmationId,
          stepMs: answer.stepMs,
          confirmedAt: answer.confirmedAt,
        },
        200,
      );
    }),
  );
}

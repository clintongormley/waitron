import "./errors.js";
import type { Context, Hono } from "hono";
import { eq } from "drizzle-orm";
import { devices, withTransaction, type Database, type Transaction } from "@waitron/db";
import type {
  BootReading,
  ClockAdminConfirm,
  ClockConfirmation,
  ClockWitness,
  FiscalBackend,
  TrustedClock,
} from "@waitron/fiscal";
import { CLOCK_WITNESS_MARGIN_MS } from "@waitron/fiscal";
import {
  authorize,
  canUseDeviceProfile,
  persons,
  roleHasPermission,
  type PersonRoleValue,
  type PinAttempts,
} from "@waitron/identity";
import { codeOf, createErrorBoundary, readJsonBody, readRawJsonBody } from "@waitron/server-kit";
import { AppError } from "@waitron/shared";
import { confirmBody, requiredNameOf } from "./box-health-api.js";
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
import { overrideToCheck, withCheck, withPinCheckAhead } from "./pin-check-ahead.js";
import { requestAddress, requestFromBox } from "./request-from-box.js";
import { parseOverrideField } from "./till-api.js";
import { assertStillSignedIn, requireSession } from "./till-session.js";

export interface TillBoxClockDeps {
  correction: Pick<ReturnType<typeof clockCorrection>, "inTurn" | "set" | "steps">;
  startUp: Pick<ClockStartUp, "noStop" | "admit">;
  witnesses: () => readonly ClockWitness[];
  /** Empties the witness store once a confirmation has committed. */
  clearWitnesses: () => void;
  readBoot: () => BootReading;
  /** Times each challenge; never stepped by a change of the wall clock. */
  steady: () => number;
  requestFromBox?: (c: Context) => boolean;
  /** Whether the box files records, so could ask AEAT its time. */
  filesRecords: () => boolean;
}

const run = createErrorBoundary(
  {
    "session.required": 401,
    "session.not_open": 401,
    "device.unauthorized": 403,
    "device_profile.not_admitted": 403,
    "person.suspended": 403,
    "pin.invalid": 401,
    "pin.throttled": 429,
    "authorization.not_permitted": 403,
    "clock.set_refused": 409,
    "clock.confirm_refused": 409,
    "clock.check_expired": 400,
    "clock.set_failed": 502,
    "management.request_invalid": 400,
  },
  "box-clock.failed",
);

type Session = Awaited<ReturnType<typeof requireSession>>;

function refuse(
  reason: Exclude<ClockSetRefusal, "not_admitted" | "refused" | "unverified"> | "same_machine",
): never {
  throw new AppError("clock.set_refused", { reason });
}

function overrideOf(body: unknown): { personId: string; pin: string } | undefined {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? parseOverrideField((body as { override?: unknown }).override)
    : undefined;
}

/** "Check the time" on a till: `POST /api/box-clock/challenge` and `POST /api/box-clock/confirm`
 * (plan decision 15). Any staff member the till's profile admits, during the start-up window; an
 * administrator, signed in or by PIN, at any time. Refused on the box itself. */
export function mountTillBoxClockApi(
  app: Hono,
  deps: {
    db: Database;
    backend: FiscalBackend;
    clock: TrustedClock;
    nodeId: string;
    devMode: boolean;
    attemptsFor: (deviceId: string) => PinAttempts;
    boxClock: TillBoxClockDeps;
  },
  log: Logger,
): void {
  const { db, backend, clock, boxClock } = deps;
  const confirmClockStop = backend.confirmClockStop?.bind(backend);
  if (confirmClockStop === undefined) return;
  const correction = boxClock.correction;
  const challenges = clockChallenges({
    steady: boxClock.steady,
    wall: () => clock.now().instant.getTime(),
  });

  // Slice 9's rule: the box's own screen is never a witness to its clock.
  const refuseOnTheBox = (c: Context) => {
    if (!deps.devMode && (boxClock.requestFromBox ?? requestFromBox)(c)) refuse("same_machine");
  };
  const canAskAuthority = () => boxClock.filesRecords() && backend.readAuthorityTime !== undefined;

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
    const [person] = await tx
      .select({ role: persons.role })
      .from(persons)
      .where(eq(persons.id, personId));
    return (
      person !== undefined && roleHasPermission(person.role as PersonRoleValue, "person.admin")
    );
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

  /** Whether a stop holds at the box's reading now, and whether it is the before-28-10-2024 one. */
  async function stopAt(
    tx: Transaction,
    reading: ReturnType<TrustedClock["now"]>,
    witnesses: readonly ClockWitness[],
  ): Promise<{ stopped: boolean; unusable: boolean }> {
    if (unusableAt(reading)) return { stopped: true, unusable: true };
    const state =
      backend.clockStopState === undefined
        ? null
        : await backend.clockStopState(tx, reading, witnesses);
    return { stopped: state !== null && state.proof !== "confirmed", unusable: false };
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
      // The PIN is checked by the confirm; here an override only says an administrator is asking.
      const override = overrideOf(await readJsonBody<unknown>(c));
      await withTransaction(db, async (tx) => {
        await admitted(tx, session);
        const asAdmin = override !== undefined || (await holdsAdmin(tx, session.personId));
        const stop = await stopAt(tx, clock.now(), boxClock.witnesses());
        if (!stop.stopped) noStop();
        if (asAdmin) return;
        const refusal = boxClock.startUp.admit({
          unusable: stop.unusable,
          canAskAuthority: canAskAuthority(),
        });
        if (refusal !== null) refuse(refusal);
      });
      const { challengeId, boxAt } = challenges.issue(session.sessionId);
      return c.json({ challengeId, boxAt: new Date(boxAt).toISOString() }, 200);
    }),
  );

  app.post("/api/box-clock/confirm", (c) =>
    run(c, log, async () => {
      refuseOnTheBox(c);
      const session = await requireSession(deps, c);
      const raw = await readRawJsonBody<unknown>(c);
      const { challengeId, deviceAt } = confirmBody(raw);
      const override = overrideOf(raw);
      const asAdmin = await withTransaction(db, async (tx) => {
        await admitted(tx, session);
        return override !== undefined || (await holdsAdmin(tx, session.personId));
      });
      const attempts = deps.attemptsFor(session.deviceId);
      const toCheck = await overrideToCheck(
        db,
        { sessionId: session.sessionId, permission: "person.admin" },
        override,
      );
      const authorizeAdmin = (tx: Transaction, checked: Parameters<typeof withCheck>[1]) =>
        authorize(
          tx,
          {
            sessionId: session.sessionId,
            permission: "person.admin",
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
      if (!(deviceAt >= EARLIEST_TARGET_MS && deviceAt < LATEST_TARGET_MS))
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

      if (Math.abs(deviceAt - boxAtMs) + tillReading.uncertaintyMs <= CLOCK_WITNESS_MARGIN_MS) {
        const confirmation: ClockConfirmation = await withPinCheckAhead(
          db,
          toCheck,
          attempts,
          (checked) =>
            // Taken around the whole transaction, never inside it: a set in the turn waits for
            // the write lock a transaction holds.
            correction.inTurn(() =>
              withTransaction(db, async (tx) => {
                const deviceLabel = await admitted(tx, session);
                const witnesses = boxClock.witnesses();
                const now = clock.now();
                // A set landed, or the wall clock stepped, after the reading: the comparison is void.
                if (
                  correction.steps() !== stepsSeen ||
                  wallMovedAgainstSteady(
                    { wallMs: reading.instant.getTime(), monoMs: steadyMs },
                    { wallMs: now.instant.getTime(), monoMs: boxClock.steady() },
                  )
                )
                  refuse("stale");
                const stop = await stopAt(tx, now, witnesses);
                if (!stop.stopped) noStop();
                let personId = session.personId;
                if (asAdmin) personId = (await authorizeAdmin(tx, checked)).authorizedBy;
                else {
                  const refusal = boxClock.startUp.admit({
                    unusable: stop.unusable,
                    canAskAuthority: canAskAuthority(),
                  });
                  if (refusal !== null) refuse(refusal);
                }
                const answer = await confirmClockStop(tx, {
                  reading: { instant: now.instant, offsetMinutes: now.offsetMinutes },
                  boot: boxClock.readBoot(),
                  witnesses,
                  nodeId: deps.nodeId,
                  admin: person(personId, await requiredNameOf(tx, personId), deviceLabel),
                });
                // With a person, the seat answers a row or throws.
                return answer.confirmation!;
              }),
            ),
        );
        boxClock.clearWitnesses();
        return c.json(
          { confirmationId: confirmation.id, stepMs: 0, confirmedAt: confirmation.confirmedAt },
          200,
        );
      }

      // A commented decision: the administrator is authorized in a transaction of its own, before
      // the set and outside the correction's turn, because the set holds no transaction while the
      // host moves the clock. An administrator whose `person.admin` is withdrawn between the two is
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
      const unusable = unusableAt(reading);
      const answer = await correction.set({
        reason: unusable ? "unusable" : "behind_chain",
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
                return boxClock.startUp.admit({ unusable, canAskAuthority: canAskAuthority() });
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

import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  checkPin,
  createPinThrottle,
  IDENTITY_MIGRATIONS,
  loginWithPin,
  registerModulePermissions,
} from "@waitron/identity";
import { seedPerson, seedSessionDevice } from "@waitron/identity/test/fixtures.js";
import { VENUE_SERVICE_PERMISSIONS } from "@waitron/venue-service";
import { parseLateSend, withLateSendCheck, type ParsedLateSend } from "./late-send.js";

vi.mock("@waitron/identity", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@waitron/identity")>();
  return { ...actual, checkPin: vi.fn(actual.checkPin) };
});

registerModulePermissions(VENUE_SERVICE_PERMISSIONS);
const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

const MENU = "0a3c9b52-6f1e-4c8a-9d2b-7e4f5a6b8c01";
const OTHER = "1b4d0c63-7a2f-4d9b-8e3c-8f5a6b7c9d12";

async function refusal(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    const { code, params } = error as { code: string; params: unknown };
    return { code, params };
  }
  throw new Error("expected a refusal");
}

/** A shift session for a person of `role`, whose PIN is "1234". */
async function sessionOf(role: "staff" | "manager") {
  const deviceId = await seedSessionDevice(suite.db);
  const personId = await seedPerson(suite.db, role);
  const session = await withTransaction(suite.db, (tx) =>
    loginWithPin(tx, { deviceId, personId, pin: "1234" }),
  );
  return { sessionId: session.id, personId, deviceId };
}

/** Confirms through `withLateSendCheck`, noting how many PIN checks ran before the transaction. */
async function confirmed(
  session: { sessionId: string; personId: string; deviceId: string },
  parsed: ParsedLateSend,
  needsManager: boolean,
) {
  vi.mocked(checkPin).mockClear();
  let checksBeforeTransaction = -1;
  const by = await withLateSendCheck(
    suite.db,
    session,
    createPinThrottle(),
    parsed,
    async (late) => {
      checksBeforeTransaction = vi.mocked(checkPin).mock.calls.length;
      return withTransaction(suite.db, (tx) => late!.confirm(tx, needsManager));
    },
  );
  return { by, checksBeforeTransaction, checks: vi.mocked(checkPin).mock.calls.length };
}

describe("parseLateSend", () => {
  it("answers undefined when the field is absent", () => {
    expect(parseLateSend(undefined)).toBeUndefined();
  });

  it.each([
    ["null", null],
    ["a string", "yes"],
    ["an array", [MENU]],
    ["no menuIds", {}],
    ["menuIds that are not a list", { menuIds: MENU }],
    ["empty menuIds", { menuIds: [] }],
    ["a menu id that is not a UUID", { menuIds: [MENU, "lunch"] }],
    ["a menu id that is not text", { menuIds: [7] }],
  ])("refuses %s as lateSend", async (_label, value) => {
    expect(await refusal(() => parseLateSend(value))).toEqual({
      code: "management.request_invalid",
      params: { field: "lateSend" },
    });
  });

  it.each([
    ["a string", "1234"],
    ["an array", []],
  ])("refuses an override that is %s as override", async (_label, override) => {
    expect(await refusal(() => parseLateSend({ menuIds: [MENU], override }))).toEqual({
      code: "management.request_invalid",
      params: { field: "override" },
    });
  });

  it.each([
    ["a personId that is not a UUID", { personId: "x", pin: "1" }],
    ["a pin that is not text", { personId: OTHER, pin: 1234 }],
  ])("refuses an override with %s as pin.invalid", async (_label, override) => {
    expect(await refusal(() => parseLateSend({ menuIds: [MENU], override }))).toEqual({
      code: "pin.invalid",
      params: {},
    });
  });

  it("lower-cases and de-duplicates the menu ids, and keeps the override", () => {
    expect(
      parseLateSend({
        menuIds: [MENU.toUpperCase(), MENU, OTHER],
        override: { personId: OTHER, pin: "4321" },
      }),
    ).toEqual({ menuIds: [MENU, OTHER], override: { personId: OTHER, pin: "4321" } });
  });

  it("carries no override when none is sent", () => {
    expect(parseLateSend({ menuIds: [MENU] })).toEqual({ menuIds: [MENU] });
  });
});

describe("withLateSendCheck", () => {
  it("runs with no confirmation when the request carries none", async () => {
    const session = await sessionOf("staff");
    const seen = await withLateSendCheck(
      suite.db,
      session,
      createPinThrottle(),
      undefined,
      async (late) => late,
    );
    expect(seen).toBeUndefined();
  });

  it("hands the confirmation the request's menus", async () => {
    const session = await sessionOf("staff");
    const menus = await withLateSendCheck(
      suite.db,
      session,
      createPinThrottle(),
      { menuIds: [MENU, OTHER] },
      async (late) => [...late!.menuIds],
    );
    expect(menus).toEqual([MENU, OTHER]);
  });

  it("answers the signed-in person, deriving no key, when no manager is needed", async () => {
    const session = await sessionOf("staff");

    const result = await confirmed(session, { menuIds: [MENU] }, false);

    expect(result).toEqual({ by: session.personId, checksBeforeTransaction: 0, checks: 0 });
  });

  it("answers the signed-in person when no manager is needed, even with an override sent", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");

    const result = await confirmed(
      session,
      { menuIds: [MENU], override: { personId: manager, pin: "1234" } },
      false,
    );

    // The department's setting is read only inside the transaction, so the PIN is still checked
    // ahead of it; the confirmation then does not ask for it.
    expect(result).toEqual({ by: session.personId, checksBeforeTransaction: 1, checks: 1 });
  });

  it("answers a manager signed in, asking no PIN, when a manager is needed", async () => {
    const session = await sessionOf("manager");

    const result = await confirmed(session, { menuIds: [MENU] }, true);

    expect(result).toEqual({ by: session.personId, checksBeforeTransaction: 0, checks: 0 });
  });

  it("answers the override's manager for staff, the PIN checked before the transaction", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");

    const result = await confirmed(
      session,
      { menuIds: [MENU], override: { personId: manager, pin: "1234" } },
      true,
    );

    expect(result).toEqual({ by: manager, checksBeforeTransaction: 1, checks: 1 });
  });

  it("refuses a wrong manager's PIN as pin.invalid", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");

    expect(
      await refusal(() =>
        confirmed(session, { menuIds: [MENU], override: { personId: manager, pin: "9999" } }, true),
      ),
    ).toMatchObject({ code: "pin.invalid" });
  });

  it("refuses staff with no override as authorization.not_permitted", async () => {
    const session = await sessionOf("staff");

    expect(await refusal(() => confirmed(session, { menuIds: [MENU] }, true))).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "venue_service.manage" },
    });
  });

  /** Confirms with `override` from a staff session, noting each wrong-PIN failure recorded. */
  async function countedFailures(
    pin: string,
    needsManager: boolean | undefined,
  ): Promise<{
    outcome: unknown;
    failures: unknown[][];
    slot: string;
    manager: string;
    staff: string;
  }> {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");
    const throttle = createPinThrottle();
    const failures = vi.spyOn(throttle, "recordFailure");
    const outcome = await withLateSendCheck(
      suite.db,
      session,
      throttle,
      { menuIds: [MENU], override: { personId: manager, pin } },
      (late) =>
        needsManager === undefined
          ? Promise.resolve("nothing late")
          : withTransaction(suite.db, (tx) => late!.confirm(tx, needsManager)),
    ).catch((error: { code: string }) => error.code);
    return {
      outcome,
      failures: failures.mock.calls,
      slot: `override:${session.deviceId}`,
      manager,
      staff: session.personId,
    };
  }

  it("lets a send through with a wrong override PIN when no manager is needed, counting it once", async () => {
    const { outcome, failures, slot, manager, staff } = await countedFailures("9999", false);

    expect(outcome).toBe(staff);
    expect(failures).toEqual([[slot, manager]]);
  });

  it("counts a wrong override PIN once when nothing late asks for a confirmation", async () => {
    const { outcome, failures, slot, manager } = await countedFailures("9999", undefined);

    expect(outcome).toBe("nothing late");
    expect(failures).toEqual([[slot, manager]]);
  });

  it("counts no failure for a right override PIN when no manager is needed", async () => {
    const { failures } = await countedFailures("1234", false);

    expect(failures).toEqual([]);
  });

  it("counts a wrong manager's PIN exactly once when a manager is needed", async () => {
    const { outcome, failures, slot, manager } = await countedFailures("9999", true);

    expect(outcome).toBe("pin.invalid");
    expect(failures).toEqual([[slot, manager]]);
  });

  it("counts a failure even when the send itself fails before any confirmation", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");
    const throttle = createPinThrottle();
    const failures = vi.spyOn(throttle, "recordFailure");

    const outcome = await withLateSendCheck(
      suite.db,
      session,
      throttle,
      { menuIds: [MENU], override: { personId: manager, pin: "9999" } },
      () => Promise.reject(new Error("the send failed")),
    ).catch((error: Error) => error.message);

    expect(outcome).toBe("the send failed");
    expect(failures.mock.calls).toEqual([[`override:${session.deviceId}`, manager]]);
  });

  it("refuses an override from staff, whose PIN is right, as authorization.not_permitted", async () => {
    const session = await sessionOf("staff");
    const colleague = await seedPerson(suite.db, "staff");

    expect(
      await refusal(() =>
        confirmed(
          session,
          { menuIds: [MENU], override: { personId: colleague, pin: "1234" } },
          true,
        ),
      ),
    ).toEqual({
      code: "authorization.not_permitted",
      params: { permission: "venue_service.manage" },
    });
  });

  it("refuses to be asked again with a different setting, accepting no PIN", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");
    const throttle = createPinThrottle();
    const verified = vi.spyOn(throttle, "clear");

    const outcome = await withLateSendCheck(
      suite.db,
      session,
      throttle,
      { menuIds: [MENU], override: { personId: manager, pin: "1234" } },
      (late) =>
        withTransaction(suite.db, async (tx) => {
          const first = await late!.confirm(tx, false);
          expect(() => late!.confirm(tx, true)).toThrow(
            "a late-send confirmation was asked with a different setting",
          );
          return first;
        }),
    );

    expect(outcome).toBe(session.personId);
    expect(verified).not.toHaveBeenCalled();
  });

  it("verifies once when confirmed twice", async () => {
    const session = await sessionOf("staff");
    const manager = await seedPerson(suite.db, "manager");
    vi.mocked(checkPin).mockClear();
    const throttle = createPinThrottle();
    const verified = vi.spyOn(throttle, "clear");

    const result = await withLateSendCheck(
      suite.db,
      session,
      throttle,
      { menuIds: [MENU], override: { personId: manager, pin: "1234" } },
      (late) =>
        withTransaction(suite.db, async (tx) => {
          const first = late!.confirm(tx, true);
          const second = late!.confirm(tx, true);
          return { same: first === second, by: [await first, await second] };
        }),
    );

    expect(result).toEqual({ same: true, by: [manager, manager] });
    expect(vi.mocked(checkPin)).toHaveBeenCalledTimes(1);
    expect(verified).toHaveBeenCalledTimes(1);
  });
});

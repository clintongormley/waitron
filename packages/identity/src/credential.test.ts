import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { verifyThrottledCredential, type PinAttempts } from "./credential.js";
import { createPinThrottle, type PinThrottle } from "./pin-throttle.js";
import { verifyPin } from "./verify-pin.js";
import { codeOf, refusalOf, seedPerson } from "../test/fixtures.js";

// Spy on verifyPin while delegating to the real hash check, so a call that never reaches the PIN
// check is observable.
vi.mock("./verify-pin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify-pin.js")>();
  return { ...actual, verifyPin: vi.fn(actual.verifyPin) };
});

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** A throttle whose every call is recorded, delegating to a real one on a fixed clock. */
function spiedAttempts(slot = "override:till-1"): {
  attempts: PinAttempts;
  throttle: { [K in keyof PinThrottle]: ReturnType<typeof vi.fn> };
} {
  const real = createPinThrottle({ now: () => 1_000_000 });
  const throttle = {
    check: vi.fn(real.check),
    recordFailure: vi.fn(real.recordFailure),
    clear: vi.fn(real.clear),
  };
  return { attempts: { throttle, slot }, throttle };
}

beforeEach(() => {
  vi.mocked(verifyPin).mockClear();
});

describe("verifyThrottledCredential", () => {
  it("answers the person's role for the right PIN and clears their count", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const { attempts, throttle } = spiedAttempts();

    const cred = await run((tx) => verifyThrottledCredential(tx, personId, "1234", attempts));

    expect(cred).toEqual({ role: "supervisor", locale: null });
    expect(throttle.check).toHaveBeenCalledWith("override:till-1", personId);
    expect(throttle.clear).toHaveBeenCalledWith("override:till-1", personId);
    expect(throttle.recordFailure).not.toHaveBeenCalled();
  });

  it("records a wrong PIN as a failure and still answers pin.invalid", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const { attempts, throttle } = spiedAttempts();

    const code = await codeOf(() =>
      run((tx) => verifyThrottledCredential(tx, personId, "9999", attempts)),
    );

    expect(code).toBe("pin.invalid");
    expect(throttle.recordFailure).toHaveBeenCalledWith("override:till-1", personId);
    expect(throttle.clear).not.toHaveBeenCalled();
  });

  it("refuses pin.throttled after four wrong PINs, even the right one, without checking it", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const { attempts } = spiedAttempts();
    for (let i = 0; i < 4; i += 1) {
      expect(
        await codeOf(() => run((tx) => verifyThrottledCredential(tx, personId, "9999", attempts))),
      ).toBe("pin.invalid");
    }
    vi.mocked(verifyPin).mockClear();

    const refusal = await refusalOf(() =>
      run((tx) => verifyThrottledCredential(tx, personId, "1234", attempts)),
    );

    expect(refusal).toMatchObject({ code: "pin.throttled", params: { retryAfterSeconds: 2 } });
    expect(verifyPin).not.toHaveBeenCalled();
  });

  it("starts the count again after a right PIN: three wrong, right, three wrong, right still works", async () => {
    const personId = await seedPerson(suite.db, "supervisor");
    const { attempts } = spiedAttempts();
    const wrongThrice = async () => {
      for (let i = 0; i < 3; i += 1) {
        expect(
          await codeOf(() =>
            run((tx) => verifyThrottledCredential(tx, personId, "9999", attempts)),
          ),
        ).toBe("pin.invalid");
      }
    };

    await wrongThrice();
    await run((tx) => verifyThrottledCredential(tx, personId, "1234", attempts));
    await wrongThrice();
    const cred = await run((tx) => verifyThrottledCredential(tx, personId, "1234", attempts));

    expect(cred.role).toBe("supervisor");
  });

  it("does not count a failure that is not a wrong PIN", async () => {
    const { attempts, throttle } = spiedAttempts();
    const broken = {
      select: () => {
        throw new Error("the database went away");
      },
    } as unknown as Transaction;

    await expect(
      verifyThrottledCredential(broken, crypto.randomUUID(), "1234", attempts),
    ).rejects.toThrow("the database went away");
    expect(throttle.check).toHaveBeenCalledTimes(1);
    expect(throttle.recordFailure).not.toHaveBeenCalled();
    expect(throttle.clear).not.toHaveBeenCalled();
  });
});

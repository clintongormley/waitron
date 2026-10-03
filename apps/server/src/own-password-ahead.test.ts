import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  hashPassword,
  hashSessionToken,
  IDENTITY_MIGRATIONS,
  managementSessions,
  verifyPassword,
} from "@waitron/identity";
import { codeOf, openManagementSession } from "@waitron/identity/test/fixtures.js";
import { AppError } from "@waitron/shared";
import { keysInTurn } from "./attempt-turns.js";
import { ownPasswordChanges } from "./own-password-ahead.js";
import { createPasswordThrottle } from "./password-throttle.js";
import { failingDerivationsOf } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS],
});

/** A password throttle that also records each outcome its attempts finish with. */
function recordingThrottle() {
  const throttle = createPasswordThrottle();
  const outcomes: string[] = [];
  return {
    outcomes,
    throttle: {
      wouldRefuse: (key: string) => throttle.wouldRefuse(key),
      begin: (key: string) => {
        const finish = throttle.begin(key);
        return (outcome: "success" | "invalid" | "error") => {
          outcomes.push(outcome);
          finish(outcome);
        };
      },
    },
  };
}

async function lastSeenAt(token: string): Promise<string | undefined> {
  const [row] = await suite.db
    .select({ lastSeenAt: managementSessions.lastSeenAt })
    .from(managementSessions)
    .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
  return row?.lastSeenAt;
}

describe("ownPasswordChanges", () => {
  it("leaves the session's last-seen time alone when the change it checked the password for is refused", async () => {
    const { personId, token } = await openManagementSession(suite.db);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    await suite.db
      .update(managementSessions)
      .set({ lastSeenAt: tenMinutesAgo })
      .where(eq(managementSessions.tokenHash, hashSessionToken(token)));
    let handed: unknown;

    // Refused, so the transaction's own touch of the session rolls back: only the early check is left
    // to have moved it.
    const code = await codeOf(() =>
      ownPasswordChanges(suite.db, createPasswordThrottle())(
        token,
        () => ({ currentPassword: "correct horse" }),
        async (_tx, input) => {
          handed = input.checked;
          throw new AppError("password.invalid", {});
        },
      ),
    );

    expect(code).toBe("password.invalid");
    expect(handed).toEqual({ personId, matches: true });
    expect(await lastSeenAt(token)).toBe(tenMinutesAgo);
  });

  it("hands the change no check when the early check fails, so the change refuses as it would without one", async () => {
    const { token } = await openManagementSession(suite.db);
    const { throttle, outcomes } = recordingThrottle();
    let handedACheck: boolean | undefined;

    const code = await codeOf(() =>
      failingDerivationsOf("a password whose key cannot be derived", () =>
        ownPasswordChanges(suite.db, throttle)(
          token,
          () => ({ currentPassword: "a password whose key cannot be derived" }),
          async (_tx, input) => {
            handedACheck = "checked" in input;
            throw new AppError("profile.invalid", { field: "displayName" });
          },
        ),
      ),
    );

    expect({ code, handedACheck, outcomes }).toEqual({
      code: "profile.invalid",
      handedACheck: false,
      outcomes: ["error"],
    });
    expect(keysInTurn(throttle)).toBe(0);
  });

  it("still answers with the change's own failure to derive the key once the early check has failed", async () => {
    const { token } = await openManagementSession(suite.db);
    const { throttle, outcomes } = recordingThrottle();

    const failure = await failingDerivationsOf("a password whose key cannot be derived", () =>
      ownPasswordChanges(suite.db, throttle)(
        token,
        () => ({ currentPassword: "a password whose key cannot be derived" }),
        () => verifyPassword("a password whose key cannot be derived", hashPassword("x")),
      ).then(
        () => "resolved",
        (error: unknown) => String(error),
      ),
    );

    expect({ failure, outcomes }).toEqual({
      failure: "Error: scrypt failed (test fault)",
      outcomes: ["error"],
    });
  });
});

/**
 * What each of identity's two translators does with a real `persons` index refusal. Rows are
 * inserted through the table definition, bypassing the write paths' pre-checks, so the refusal is
 * the index's.
 */
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { isAppError } from "@waitron/shared";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { persons } from "./schema/persons.js";
import { hashPin } from "./verify-pin.js";
import { asEmailTaken, asPersonUniqueViolation } from "./staff.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

const PIN = hashPin("1234");

/** Through the table definition: `id` and `created_at` are `$defaultFn` generators that only the
 * insert BUILDER runs. */
function insertPerson(
  db: Database,
  values: {
    id?: string;
    displayName: string;
    email?: string | null;
    pendingEmail?: string | null;
    googleSubject?: string | null;
  },
): Promise<unknown> {
  return withTransaction(db, (tx) => tx.insert(persons).values({ ...values, pinHash: PIN }));
}

/** `captureError` fails the test if the second insert is ACCEPTED. */
async function collision(
  first: Parameters<typeof insertPerson>[1],
  second: Parameters<typeof insertPerson>[1],
): Promise<unknown> {
  await insertPerson(suite.db, first);
  return captureError(() => insertPerson(suite.db, second));
}

/**
 * The DRIVER's message, dug out of the chain Drizzle wraps it in. Drizzle's own message quotes the
 * statement, so a match on it passes whether the index fired or not.
 */
function driverMessage(error: unknown): string {
  let layer: unknown = error;
  while (layer !== null && typeof layer === "object") {
    const { errcode, message } = layer as { errcode?: unknown; message?: unknown };
    if (typeof errcode === "number" && typeof message === "string") return message;
    layer = (layer as { cause?: unknown }).cause;
  }
  throw new Error("no driver refusal in the cause chain", { cause: error });
}

/** What a translator did: the domain code it threw, or the error it re-threw untouched. */
function translated(fn: () => never, error: unknown): string | "RE-THROWN" {
  try {
    fn();
  } catch (thrown) {
    if (thrown === error) return "RE-THROWN";
    return isAppError(thrown) ? thrown.code : `UNEXPECTED: ${String(thrown)}`;
  }
  return "RETURNED WITHOUT THROWING";
}

describe("translating a persons index refusal", () => {
  it("names the login-email index in the engine's own words", async () => {
    const error = await collision(
      { displayName: "A", email: "owner@x.com" },
      { displayName: "B", email: "Owner@X.com" },
    );
    expect(driverMessage(error)).toBe("UNIQUE constraint failed: index 'persons_tenant_email_uq'");
  });

  it("turns a login-email collision into person.email_taken", async () => {
    const error = await collision(
      { displayName: "A", email: "owner@x.com" },
      { displayName: "B", email: "Owner@X.com" },
    );
    expect(translated(() => asEmailTaken(error, "owner@x.com"), error)).toBe("person.email_taken");
    expect(
      translated(
        () => asPersonUniqueViolation(error, { email: "owner@x.com", displayName: "B" }),
        error,
      ),
    ).toBe("person.email_taken");
  });

  it("turns a live display-name collision into person.display_name_taken", async () => {
    const error = await collision(
      { displayName: "Ada Lovelace" },
      { displayName: "  ada lovelace  " },
    );
    expect(
      translated(
        () => asPersonUniqueViolation(error, { email: "b@x.com", displayName: "ada lovelace" }),
        error,
      ),
    ).toBe("person.display_name_taken");
  });

  it("turns a pending-email collision into person.email_taken", async () => {
    const error = await collision(
      { displayName: "A", pendingEmail: "next@x.com" },
      { displayName: "B", pendingEmail: "Next@X.com" },
    );
    expect(
      translated(
        () => asPersonUniqueViolation(error, { email: "next@x.com", displayName: "B" }),
        error,
      ),
    ).toBe("person.email_taken");
  });

  // A pending-email collision is a different index, and its `{ email }` a different address.
  it("re-throws a pending-email collision from asEmailTaken", async () => {
    const error = await collision(
      { displayName: "A", pendingEmail: "next@x.com" },
      { displayName: "B", pendingEmail: "Next@X.com" },
    );
    expect(translated(() => asEmailTaken(error, "next@x.com"), error)).toBe("RE-THROWN");
  });

  // Only when the caller supplied one, so `{ email }` never carries undefined.
  it("re-throws an email collision when the caller supplied no email", async () => {
    const error = await collision(
      { displayName: "A", email: "owner@x.com" },
      { displayName: "B", email: "Owner@X.com" },
    );
    expect(translated(() => asPersonUniqueViolation(error, { displayName: "B" }), error)).toBe(
      "RE-THROWN",
    );
  });

  // The control: a unique violation on `persons` that must come back RAW, so this fails if the
  // translators match any unique violation on the table.
  it("re-throws a google-subject collision from both translators", async () => {
    const error = await collision(
      { displayName: "A", googleSubject: "sub-1" },
      { displayName: "B", googleSubject: "sub-1" },
    );
    expect(driverMessage(error)).toBe("UNIQUE constraint failed: persons.google_subject");
    expect(translated(() => asEmailTaken(error, "owner@x.com"), error)).toBe("RE-THROWN");
    expect(
      translated(
        () => asPersonUniqueViolation(error, { email: "owner@x.com", displayName: "B" }),
        error,
      ),
    ).toBe("RE-THROWN");
  });

  it("re-throws a primary-key collision from both translators", async () => {
    const id = "11111111-2222-4333-8444-555555555555";
    const error = await collision({ id, displayName: "A" }, { id, displayName: "B" });
    expect(translated(() => asEmailTaken(error, "owner@x.com"), error)).toBe("RE-THROWN");
    expect(
      translated(
        () => asPersonUniqueViolation(error, { email: "owner@x.com", displayName: "B" }),
        error,
      ),
    ).toBe("RE-THROWN");
  });
});

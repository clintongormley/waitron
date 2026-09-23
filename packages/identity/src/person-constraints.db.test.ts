/**
 * Which `persons` index refused a write, and what each of identity's two translators does with it,
 * driven against the migrated database rather than a crafted error.
 *
 * Four unique indexes live on `persons` and they are NOT reported alike. Three are over an
 * EXPRESSION — a `case` per index that reads the row's folded column when it has one and falls
 * back to `lower(...)` when it does not (`schema/persons.ts`) — and this engine reports one of
 * those as `UNIQUE constraint failed: index '<the index's name>'`: the
 * index's name, and no columns. The fourth, `persons_tenant_google_subject_uq`, is over a plain
 * column and reports `UNIQUE constraint failed: persons.google_subject` — a table and a key, and
 * no name. That is why the translators ask `indexViolated` (the name) rather than `sameTarget`
 * (the key), and why the google-subject case below is the control that says the question
 * discriminates instead of matching everything: it is a unique violation on `persons` that must
 * come back RAW.
 *
 * The rows are inserted through the table definition, bypassing the write paths' own pre-checks
 * (`assertEmailAvailable`, `assertDisplayNameAvailable`), because the subject here is the INDEX's
 * refusal and the translator that reads it. What the pre-checks do instead is the subject of the
 * end-to-end cases in `staff.email.test.ts` and `staff-lifecycle.test.ts`.
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

/** Insert one `persons` row through the table definition: `id` and `created_at` are `$defaultFn`
 * generators that only the insert BUILDER runs. */
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

/** The refusal a second, colliding insert raised. `captureError` fails the test if the insert is
 * ACCEPTED, so no case below can read an absent refusal as a matching one. */
async function collision(
  first: Parameters<typeof insertPerson>[1],
  second: Parameters<typeof insertPerson>[1],
): Promise<unknown> {
  await insertPerson(suite.db, first);
  return captureError(() => insertPerson(suite.db, second));
}

/**
 * The refusal the DRIVER raised, dug out of the chain Drizzle wraps it in.
 *
 * Asserting on the caught error's own message would prove nothing: Drizzle's wrapper message is
 * `Failed to run the query '<the statement>'`, so a match on any word the statement contains passes
 * whether the index fired or not. The same reason as `persons.email.test.ts`'s `driverRefusal`,
 * but this returns only the message.
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

  // asEmailTaken translates the LOGIN address index and nothing else: a pending-email collision is
  // a different index and the `{ email }` it would carry is a different address.
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

  /**
   * THE CONTROL. `persons_tenant_google_subject_uq` is a unique index on `persons` like the other
   * three, and a collision on it must come back RAW from both translators. It is over a PLAIN
   * COLUMN, so the engine reports the table and the key and no index name at all — which is what
   * makes it the case that fails if the translators go back to matching any unique violation on
   * this table.
   */
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

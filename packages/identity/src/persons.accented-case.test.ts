/**
 * One live display name and one login address across the venue — **whatever case the accented
 * letters are typed in, and whichever way the accent is encoded.**
 *
 * The names this venue employs are José, Begoña, Martín and Nuño. The three unique indexes on
 * `persons` used to fold their case in SQL, and on this engine `lower()` folds ASCII and nothing
 * else. Measured 2026-09-23 on Node v26.7.0, with an ASCII control in the other direction so that
 * the probe discriminates rather than agreeing with itself:
 *
 * ```
 * SQLite lower('JOSÉ GARCÍA') = josÉ garcÍa        <- the É is left alone
 * SQLite lower('ANA LOPEZ')   = ana lopez          <- plain letters do fold
 * ```
 *
 * The second half of the same difference is the ENCODING. `José` can be written with a single
 * precomposed `é` (U+00E9) or with a plain `e` followed by a combining acute (U+0065 U+0301); the
 * two look identical on screen and are different strings. Nothing in SQL brings them together, and
 * neither did PostgreSQL's `lower()` — so that half is a gap this suite closes rather than a
 * regression it reports. macOS hands out the second form where phone keyboards hand out the first,
 * so one venue really can receive both.
 *
 * **What each index can be reached by.** A display name is stored exactly as it was typed, so both
 * halves reach it through `createPerson`. An address does not: `normalizeEmail`
 * (`./email.ts`) already lower-cases in JavaScript, which IS Unicode-aware, so by the time an
 * address reaches the index its case has gone. Its encoding has not — so the email and
 * pending-email cases below are encoding cases, with an ASCII case case beside each as the control
 * that the address path refuses duplicates at all.
 *
 * Every refusal is asserted by its DOMAIN CODE. A unique-index failure also satisfies
 * `toBeInstanceOf(Error)`, so an assertion on the class alone would pass whether the right thing
 * refused or the wrong thing did (`CLAUDE.md` §4).
 */
import { randomUUID } from "node:crypto";
import { CORE_MIGRATIONS, captureError, indexViolated, withTransaction } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./migrations.js";
import { createPerson, setEmail } from "./staff.js";
import { saveOwnProfile } from "./profile.js";
import { openManagementSession, seedManager, seedPerson } from "../test/fixtures.js";
import { foldForUniqueness } from "./fold.js";
import { persons } from "./schema/persons.js";
import { PERSONS_LIVE_DISPLAY_NAME } from "./person-constraints.js";
import { startManagementSession } from "./management-session.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS] });

function run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(suite.db, fn);
}

/** `José García` with both accents PRECOMPOSED — one code point each, the form a phone keyboard
 * produces. */
const PRECOMPOSED = "José García";
/** The same name with both accents DECOMPOSED — a plain letter followed by a combining acute, the
 * form macOS produces. It renders identically to {@link PRECOMPOSED}. */
const DECOMPOSED = "José García";

/** A person created through the gated write path, which is where the duplicate check lives. */
function create(
  token: string,
  displayName: string,
  email = `${randomUUID()}@example.test`,
): Promise<{ id: string }> {
  return run((tx) =>
    createPerson(tx, {
      managementSessionId: token,
      displayName,
      role: "staff",
      pin: "5678",
      email,
    }),
  );
}

describe("a live display name is taken whatever case its accented letters are typed in", () => {
  // Both orders, because only ONE of them was broken and a suite that drove the other would have
  // reported the defect fixed. The duplicate check compares the name the caller sent, folded in
  // JavaScript, against the STORED name folded in SQL; with the mixed-case name stored first, both
  // sides happen to read `josé garcía` and the check fires. Store the SHOUTED name first and SQL
  // leaves its `É` and `Í` alone, so the two sides read `josÉ garcÍa` and `josé garcía`, the check
  // finds nothing, and the index behind it does not fold either.
  for (const [first, second] of [
    ["José García", "JOSÉ GARCÍA"],
    ["JOSÉ GARCÍA", "José García"],
  ] as const) {
    it(`refuses ${second} when ${first} is already employed`, async () => {
      const { token } = await openManagementSession(suite.db, "manager");
      await create(token, first);

      await expect(create(token, second)).rejects.toMatchObject({
        code: "person.display_name_taken",
        params: { displayName: second },
      });
    });
  }

  it("refuses a second person whose name differs only in the case of an ASCII letter", async () => {
    // The control. This case passed before the fix as well: it is here because an ASCII-only probe
    // is exactly the probe that missed the defect above, so the suite states what a PASSING
    // ASCII case proves and what it does not.
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, "ANA LOPEZ");

    await expect(create(token, "Ana Lopez")).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: "Ana Lopez" },
    });
  });

  it("refuses a second person whose name differs only in how the accent is encoded", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, PRECOMPOSED);

    await expect(create(token, DECOMPOSED)).rejects.toMatchObject({
      code: "person.display_name_taken",
      params: { displayName: DECOMPOSED },
    });
  });

  it("accepts a name that differs by an accent rather than by its case", async () => {
    // The control in the other direction, and the reason the fold is a case fold and not an accent
    // stripper: Lopez and López are two people, and this venue must be able to employ both.
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, "Ana Lopez");

    await expect(create(token, "Ana López")).resolves.toMatchObject({ id: expect.any(String) });
  });
});

describe("a login address is taken whichever way its accent is encoded", () => {
  it("refuses a second person whose address differs only in how the accent is encoded", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, "One", "josé@example.test");

    await expect(create(token, "Two", "josé@example.test")).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "josé@example.test" },
    });
  });

  it("refuses a second person whose address differs only in case", async () => {
    // The control: the address path refuses duplicates at all. It passed before the fix, because
    // `normalizeEmail` had already folded the case in JavaScript before the index saw it.
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, "One", "owner@example.test");

    await expect(create(token, "Two", "OWNER@example.test")).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "owner@example.test" },
    });
  });
});

describe("an unproven replacement address is taken whichever way its accent is encoded", () => {
  /** A signed-in person who has asked to move their login address to `requested`, which parks it in
   * `pending_email` until they prove they control it. */
  async function requestAddressChange(requested: string): Promise<void> {
    const personId = await seedManager(suite.db, { email: `${randomUUID()}@example.test` });
    const session = await run((tx) => startManagementSession(tx, { personId }));
    await run((tx) =>
      saveOwnProfile(tx, {
        managementSessionId: session.token,
        displayName: `Owner ${randomUUID()}`,
        email: requested,
        locale: "en-GB",
        currentPassword: "correct horse",
      }),
    );
  }

  it("refuses a new person taking an address that differs only in how the accent is encoded", async () => {
    const { token } = await openManagementSession(suite.db, "manager");
    await requestAddressChange("maría@example.test");

    await expect(create(token, "Someone", "maría@example.test")).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "maría@example.test" },
    });
  });

  it("refuses a new person taking a pending address that differs only in case", async () => {
    // The control, as above: this one passed before the fix.
    const { token } = await openManagementSession(suite.db, "manager");
    await requestAddressChange("pending@example.test");

    await expect(create(token, "Someone", "PENDING@example.test")).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "pending@example.test" },
    });
  });
});

/**
 * The two cases above reach the DATABASE, and the rest of this file does not.
 *
 * Every gated write path pre-checks a name or an address before it writes, so a duplicate is
 * normally refused by a `select` and the index behind it never fires. The pre-check and the index
 * have to agree — they are built from one expression for exactly that reason
 * (`schema/persons.ts`, `foldedKey`) — and these two cases are what holds the index's half of it.
 * Each takes a path with no pre-check in front of it: `setEmail` has none, and the display-name
 * case writes through the table definition the way `person-constraints.db.test.ts` does.
 */
describe("the index itself folds, not only the check in front of it", () => {
  it("refuses setEmail when the address differs only in how the accent is encoded", async () => {
    // `setEmail` writes straight to the row and translates whatever the database refuses, so the
    // refusal here is the index's.
    const { token } = await openManagementSession(suite.db, "manager");
    await create(token, "Held", "mari\u0301a@example.test");
    const target = await seedPerson(suite.db, "staff");

    await expect(
      run((tx) =>
        setEmail(tx, {
          managementSessionId: token,
          personId: target,
          email: "mar\u00eda@example.test",
        }),
      ),
    ).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "mar\u00eda@example.test" },
    });
  });

  it("refuses a second live row whose folded name matches, written through the table", async () => {
    // Both rows carry `display_name_folded`, which is what every write path in this package
    // supplies. `captureError` fails the test if the second insert is ACCEPTED, so this can never
    // read an absent refusal as a matching one.
    const write = (displayName: string): Promise<unknown> =>
      run((tx) =>
        tx.insert(persons).values({
          displayName,
          displayNameFolded: foldForUniqueness(displayName),
        }),
      );
    await write("JOSÉ GARCÍA");

    const error = await captureError(() => write("José García"));

    expect(indexViolated(error, PERSONS_LIVE_DISPLAY_NAME)).toBe(true);
  });
});

/**
 * One live display name and one login address across the venue, whatever case the accented letters
 * are typed in and whichever way the accent is encoded.
 *
 * `normalizeEmail` (`./email.ts`) already lower-cases an address in JavaScript, so the address
 * cases are encoding cases, with an ASCII case-only control beside each.
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
  // Both orders: a fold done in SQL's `lower()` leaves a stored `É` alone, so only the order that
  // stores the shouted name first catches it.
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
    // The control: `lower()` folds ASCII, so this case alone cannot tell the two folds apart.
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
    // The control in the other direction: Lopez and López are two people.
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
    // The control: the address path refuses duplicates at all.
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
    const { token } = await openManagementSession(suite.db, "manager");
    await requestAddressChange("pending@example.test");

    await expect(create(token, "Someone", "PENDING@example.test")).rejects.toMatchObject({
      code: "person.email_taken",
      params: { email: "pending@example.test" },
    });
  });
});

/**
 * Every gated write path pre-checks a name or an address before it writes, so a duplicate is
 * normally refused by a `select` and the index never fires. These two take a path with no
 * pre-check in front of it: `setEmail` has none, and the display-name case writes through the
 * table definition.
 */
describe("the index itself folds, not only the check in front of it", () => {
  it("refuses setEmail when the address differs only in how the accent is encoded", async () => {
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

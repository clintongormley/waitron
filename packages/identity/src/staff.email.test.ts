import { CORE_MIGRATIONS, activityLog, outgoingMail, persons, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { openFreshManagementSession } from "../test/fixtures.js";
import { seedPersons } from "../test/person-rows.js";
import { updatePersonDetails } from "./staff.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
async function fixture(own = false) {
  const actor = await openFreshManagementSession(suite.db, "admin");
  const [target] = own
    ? await suite.db.select().from(persons).where(eq(persons.id, actor.personId))
    : await seedPersons(suite.db, {
        displayName: "Waiter",
        role: "staff",
        email: "old@example.test",
      });
  return {
    actor,
    target: target!,
    input: {
      managementSessionId: actor.token,
      personId: target!.id,
      displayName: target!.displayName,
      firstNames: "First",
      lastNames: "Last",
      telephone: null,
      email: "new@example.test",
      role: own ? ("admin" as const) : ("staff" as const),
      status: "active" as const,
    },
  };
}
it("records the editor without addresses and queues the old-address notice for one day", async () => {
  const { actor, target, input } = await fixture();
  await withTransaction(suite.db, (tx) => updatePersonDetails(tx, input));
  const entries = await suite.db.select().from(activityLog);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    kind: "person.email_changed",
    subjectKind: "person",
    subjectId: target.id,
    personId: actor.personId,
    data: {},
  });
  const [editor] = await suite.db.select().from(persons).where(eq(persons.id, actor.personId));
  const mail = await suite.db.select().from(outgoingMail);
  expect(mail).toHaveLength(1);
  expect(mail[0]).toMatchObject({
    kind: "email_changed",
    dedupeKey: `email-changed:${entries[0]!.id}`,
    subjectId: entries[0]!.id,
    personId: target.id,
    requestedBy: actor.personId,
    params: {
      oldEmail: "old@example.test",
      editorName: editor!.displayName,
      at: entries[0]!.at.toISOString(),
    },
    status: "pending",
  });
  expect(Date.parse(mail[0]!.notAfter) - Date.parse(mail[0]!.queuedAt)).toBe(86400000);
});
it.each(["own", "unchanged"])("queues and records nothing for an %s email", async (mode) => {
  const { target, input } = await fixture(mode === "own");
  await withTransaction(suite.db, (tx) =>
    updatePersonDetails(tx, {
      ...input,
      email: mode === "unchanged" ? target.email! : input.email,
    }),
  );
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});
it("rolls back the email, log and queue together", async () => {
  const { target, input } = await fixture();
  await expect(
    withTransaction(suite.db, async (tx) => {
      await updatePersonDetails(tx, input);
      expect(await tx.select().from(activityLog)).toHaveLength(1);
      expect(await tx.select().from(outgoingMail)).toHaveLength(1);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  const [person] = await suite.db.select().from(persons).where(eq(persons.id, target.id));
  expect(person!.email).toBe("old@example.test");
  expect(await suite.db.select().from(activityLog)).toEqual([]);
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

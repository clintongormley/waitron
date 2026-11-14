import { CORE_MIGRATIONS, outgoingMail, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPersons } from "../test/person-rows.js";
import { expect, it } from "vitest";
import { queueRoleMembershipMail } from "./role-mail.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
const at = new Date("2026-11-13T12:00:00Z");
const notice = {
  activityId: "activity",
  actorId: null,
  change: "added" as const,
  roleId: "role",
  builtInKey: null,
  roleName: "Service lead",
  editorName: "Editor",
  at,
};

it.each(["active", "suspended"] as const)(
  "queues for a %s person with an email, deduplicated by activity for one day",
  async (status) => {
    const [person] = await seedPersons(suite.db, {
      displayName: "Waiter",
      email: "waiter@example.test",
      status,
    });
    await withTransaction(suite.db, async (tx) => {
      await queueRoleMembershipMail(tx, { ...notice, personId: person!.id });
      await queueRoleMembershipMail(tx, { ...notice, personId: person!.id });
    });
    const mail = await suite.db.select().from(outgoingMail);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({
      kind: "role_membership_changed",
      personId: person!.id,
      requestedBy: null,
      subjectId: "activity",
      dedupeKey: "role-membership:activity",
      queuedAt: at.toISOString(),
      notAfter: "2026-11-14T12:00:00.000Z",
    });
    expect(mail[0]!.params).toEqual({
      change: "added",
      builtInKey: null,
      roleName: "Service lead",
      editorName: "Editor",
      at: at.toISOString(),
    });
  },
);

it("queues nothing for a person who has not accepted their invitation", async () => {
  const [person] = await seedPersons(suite.db, {
    displayName: "Waiter",
    email: "waiter@example.test",
    status: "pending",
  });
  await withTransaction(suite.db, (tx) =>
    queueRoleMembershipMail(tx, { ...notice, personId: person!.id }),
  );
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("queues nothing without an email", async () => {
  const [person] = await seedPersons(suite.db, { displayName: "Waiter" });
  await withTransaction(suite.db, (tx) =>
    queueRoleMembershipMail(tx, { ...notice, personId: person!.id }),
  );
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

it("backs out a queued notice with its transaction", async () => {
  const [person] = await seedPersons(suite.db, {
    displayName: "Waiter",
    email: "waiter@example.test",
  });
  await expect(
    withTransaction(suite.db, async (tx) => {
      await queueRoleMembershipMail(tx, { ...notice, personId: person!.id });
      expect(await tx.select().from(outgoingMail)).toHaveLength(1);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await suite.db.select().from(outgoingMail)).toEqual([]);
});

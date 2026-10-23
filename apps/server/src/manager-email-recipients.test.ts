import { beforeEach, describe, expect, it } from "vitest";
import { withTransaction } from "@waitron/db";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { readManagerEmailRecipients } from "./manager-email-recipients.js";

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

async function person(
  displayName: string,
  values: Partial<typeof persons.$inferInsert>,
): Promise<string> {
  const [row] = await suite.db
    .insert(persons)
    .values({ displayName, ...values })
    .returning({ id: persons.id });
  return row!.id;
}

beforeEach(async () => {
  await seedTenant(suite.db);
});

describe("readManagerEmailRecipients", () => {
  it("names every active manager and admin with an address, trimmed, in their own language or the venue's", async () => {
    const admin = await person("Admin", {
      role: "admin",
      email: "  ana@example.test ",
      locale: "es-ES",
    });
    const manager = await person("Manager", {
      role: "manager",
      email: "manager@example.test",
      locale: "en-GB",
    });
    const plain = await person("Plain", { role: "manager", email: "plain@example.test" });
    await person("Staff", { role: "staff", email: "staff@example.test" });
    await person("Gone", { role: "manager", status: "suspended", email: "gone@example.test" });
    await person("Blank", { role: "manager", email: "   " });

    const recipients = await withTransaction(suite.db, (tx) =>
      readManagerEmailRecipients(tx, "es"),
    );

    expect([...recipients].sort((a, b) => a.email.localeCompare(b.email))).toEqual([
      { personId: admin, email: "ana@example.test", language: "es" },
      { personId: manager, email: "manager@example.test", language: "en" },
      { personId: plain, email: "plain@example.test", language: "es" },
    ]);
  });
});

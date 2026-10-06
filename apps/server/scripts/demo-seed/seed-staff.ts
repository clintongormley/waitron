// Inserts directly: a seed script has no management session.

import type { Transaction } from "@waitron/db";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { DEMO_PIN } from "./staff.js";
import type { DemoDataSet } from "./data-set.js";

export async function seedStaff(
  tx: Transaction,
  { dataSet }: { dataSet: DemoDataSet },
): Promise<void> {
  const pinHash = hashPin(DEMO_PIN);
  for (const person of dataSet.staff) {
    const passwordHash = person.password !== undefined ? hashPassword(person.password) : null;
    await tx.insert(persons).values({
      displayName: person.displayName,
      pinHash,
      passwordHash,
      email: person.email,
      role: person.role,
    });
  }
}
